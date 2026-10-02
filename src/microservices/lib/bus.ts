import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Logger } from '@nestjs/common';
import { connect, nanos, type NatsConnection } from '@nats-io/transport-node';
import {
  AckPolicy,
  StorageType,
  jetstream,
  jetstreamManager,
  type JetStreamClient,
  type JetStreamManager,
  type JsMsg,
} from '@nats-io/jetstream';
import { tx, type Pool, type Queryable } from '../../shared/db.js';

const STREAM = 'EVENTS';
const logger = new Logger('Bus');

export interface Envelope<T = any> {
  id: string;
  type: string;
  orderId: string;
  data: T;
  at: string;
}

export const MESSAGING_DDL = `
  CREATE SCHEMA IF NOT EXISTS messaging;
  CREATE TABLE IF NOT EXISTS messaging.outbox (
    id uuid PRIMARY KEY,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    published_at timestamptz
  );
  CREATE INDEX IF NOT EXISTS outbox_pending_idx ON messaging.outbox (created_at) WHERE published_at IS NULL;
  CREATE TABLE IF NOT EXISTS messaging.inbox (
    event_id uuid PRIMARY KEY,
    processed_at timestamptz NOT NULL DEFAULT clock_timestamp()
  );
`;

export interface Bus {
  nc: NatsConnection;
  js: JetStreamClient;
  jsm: JetStreamManager;
}

export async function connectBus(servers: string): Promise<Bus> {
  const nc = await connect({ servers, maxReconnectAttempts: -1 });
  const jsm = await jetstreamManager(nc);
  try {
    await jsm.streams.info(STREAM);
  } catch {
    await jsm.streams
      .add({
        name: STREAM,
        subjects: ['events.>'],
        storage: StorageType.File,
        duplicate_window: nanos(120_000),
      })
      .catch(() => {}); // another service created it first
  }
  return { nc, js: jetstream(nc), jsm };
}

/** Writes an event in the caller's transaction. The relay publishes it after commit. */
export async function enqueue(db: Queryable, type: string, orderId: string, data: unknown = {}) {
  const event: Envelope = { id: randomUUID(), type, orderId, data, at: new Date().toISOString() };
  await db.query('INSERT INTO messaging.outbox (id, payload) VALUES ($1, $2)', [
    event.id,
    JSON.stringify(event),
  ]);
}

/**
 * Transactional outbox relay. Polls for unpublished rows, publishes them with the event id as
 * the JetStream message id (so a retry after a crash is de-duplicated), then marks them sent.
 * DUPLICATE_DELIVERY=1 publishes every event a second time under a different message id,
 * which gets past JetStream's de-duplication and tests that consumers are idempotent.
 */
export function startRelay(pool: Pool, bus: Bus) {
  const pollMs = Number(process.env.OUTBOX_POLL_MS ?? 10);
  const duplicate = process.env.DUPLICATE_DELIVERY === '1';
  let stopped = false;

  const loop = async () => {
    while (!stopped) {
      let published = 0;
      try {
        published = await tx(pool, async (c) => {
          const { rows } = await c.query<{ id: string; payload: Envelope }>(
            `SELECT id, payload FROM messaging.outbox WHERE published_at IS NULL
             ORDER BY created_at LIMIT 200 FOR UPDATE SKIP LOCKED`,
          );
          await Promise.all(
            rows.flatMap((r) => {
              const subject = `events.${r.payload.type}`;
              const body = JSON.stringify(r.payload);
              const sends = [bus.js.publish(subject, body, { msgID: r.id })];
              if (duplicate) sends.push(bus.js.publish(subject, body, { msgID: `${r.id}:dup` }));
              return sends;
            }),
          );
          if (rows.length) {
            await c.query(
              'UPDATE messaging.outbox SET published_at = clock_timestamp() WHERE id = ANY($1)',
              [rows.map((r) => r.id)],
            );
          }
          return rows.length;
        });
      } catch (err) {
        logger.warn(`relay: ${(err as Error).message}`);
        await sleep(500);
      }
      if (published < 200) await sleep(pollMs);
    }
  };

  const running = loop();
  return async () => {
    stopped = true;
    await running;
  };
}

export type Outcome = void | { retryInMs: number };

/**
 * Durable pull consumer with bounded concurrency. Handlers ack by returning, ask for a delayed
 * redelivery by returning { retryInMs }, and get a 1 s redelivery if they throw.
 */
export async function consume(
  bus: Bus,
  durable: string,
  types: string[],
  handle: (event: Envelope, msg: JsMsg) => Promise<Outcome>,
) {
  const concurrency = Number(process.env.CONSUMER_CONCURRENCY ?? 32);
  // How long a delivered message may stay unacked before JetStream hands it out again.
  // After a crash this is the floor on recovery time; it must stay above the slowest handler.
  const ackWaitMs = Number(process.env.ACK_WAIT_MS ?? 10_000);
  await bus.jsm.consumers.add(STREAM, {
    durable_name: durable,
    filter_subjects: types.map((t) => `events.${t}`),
    ack_policy: AckPolicy.Explicit,
    ack_wait: nanos(ackWaitMs),
    max_deliver: -1,
    max_ack_pending: 2000,
  });
  const consumer = await bus.js.consumers.get(STREAM, durable);
  const messages = await consumer.consume({ max_messages: concurrency * 2 });

  let active = 0;
  const waiting: (() => void)[] = [];
  const run = async (msg: JsMsg) => {
    try {
      const outcome = await handle(msg.json<Envelope>(), msg);
      if (outcome) msg.nak(outcome.retryInMs);
      else msg.ack();
    } catch (err) {
      logger.warn(`${durable}: ${(err as Error).message}`);
      msg.nak(1000);
    } finally {
      active--;
      waiting.shift()?.();
    }
  };

  void (async () => {
    for await (const msg of messages) {
      if (active >= concurrency) await new Promise<void>((resolve) => waiting.push(resolve));
      active++;
      void run(msg);
    }
  })();

  return async () => {
    await messages.close();
  };
}

/** Runs fn at most once per event id, in one transaction with the inbox record. */
export function once(pool: Pool, event: Envelope, fn: (c: Queryable) => Promise<void>) {
  return tx(pool, async (c) => {
    const first = await c.query(
      'INSERT INTO messaging.inbox (event_id) VALUES ($1) ON CONFLICT DO NOTHING',
      [event.id],
    );
    if (first.rowCount) await fn(c);
  });
}

export async function seen(db: Queryable, event: Envelope) {
  const { rowCount } = await db.query('SELECT 1 FROM messaging.inbox WHERE event_id = $1', [
    event.id,
  ]);
  return rowCount === 1;
}
