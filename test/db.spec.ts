import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LAB, startPostgres, type Postgres } from '../harness/infra.js';
import { mergeItems } from '../src/shared/contract.js';
import { createPool, tx, type Pool } from '../src/shared/db.js';
import {
  INVENTORY_DDL,
  PRODUCTS,
  releaseReservation,
  reserve,
  seedProducts,
} from '../src/shared/stock.js';
import { MESSAGING_DDL, once, type Envelope } from '../src/microservices/lib/bus.js';

let server: Postgres;
let pool: Pool;

beforeAll(async () => {
  server = await startPostgres({ port: 54339, dir: join(LAB, 'pg-test') });
  await server.recreate('unit');
  pool = createPool(server.url('unit'), 40);
  await pool.query(INVENTORY_DDL);
  await pool.query(MESSAGING_DDL);
  await seedProducts(pool);
});

afterAll(async () => {
  await pool?.end();
  await server?.stop();
});

const available = async (sku: string) =>
  (
    await pool.query<{ available: number }>(
      'SELECT available FROM inventory.products WHERE sku = $1',
      [sku],
    )
  ).rows[0].available;

describe('mergeItems', () => {
  it('adds up repeated skus and sorts them so locks are always taken in the same order', () => {
    expect(
      mergeItems([
        { sku: 'LATTE', qty: 1 },
        { sku: 'CROISSANT', qty: 2 },
        { sku: 'LATTE', qty: 3 },
      ]),
    ).toEqual([
      { sku: 'CROISSANT', qty: 2, unitPrice: null },
      { sku: 'LATTE', qty: 4, unitPrice: null },
    ]);
  });
});

describe('stock reservation', () => {
  it('takes all lines or none, and leaves the surrounding transaction usable', async () => {
    const before = await available('LATTE');
    const id = randomUUID();
    const result = await tx(pool, async (c) => {
      const r = await reserve(c, id, [
        { sku: 'LATTE', qty: 1, unitPrice: null },
        { sku: 'MOONCAKE', qty: 10_000, unitPrice: null },
      ]);
      await c.query('SELECT 1');
      return r;
    });
    expect(result).toEqual({ ok: false, reason: 'OUT_OF_STOCK' });
    expect(await available('LATTE')).toBe(before);
    const { rowCount } = await pool.query(
      'SELECT 1 FROM inventory.reservations WHERE order_id = $1',
      [id],
    );
    expect(rowCount).toBe(0);
  });

  it('never sells more than it has, however many orders race for the last items', async () => {
    const start = PRODUCTS.find((p) => p.sku === 'MOONCAKE')!.stock;
    expect(await available('MOONCAKE')).toBe(start);
    const results = await Promise.all(
      Array.from({ length: start + 50 }, () =>
        tx(pool, (c) => reserve(c, randomUUID(), [{ sku: 'MOONCAKE', qty: 1, unitPrice: null }])),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(start);
    expect(await available('MOONCAKE')).toBe(0);
  });

  it('releases a reservation only once', async () => {
    const id = randomUUID();
    const before = await available('THAI-TEA');
    await tx(pool, (c) => reserve(c, id, [{ sku: 'THAI-TEA', qty: 3, unitPrice: null }]));
    await releaseReservation(pool, id);
    await releaseReservation(pool, id);
    expect(await available('THAI-TEA')).toBe(before);
  });
});

describe('idempotent consumer', () => {
  it('runs the handler once per event id, even when deliveries overlap', async () => {
    const event: Envelope = {
      id: randomUUID(),
      type: 'test',
      orderId: randomUUID(),
      data: {},
      at: new Date().toISOString(),
    };
    let runs = 0;
    await Promise.all(
      Array.from({ length: 10 }, () =>
        once(pool, event, async () => {
          runs++;
        }),
      ),
    );
    await once(pool, event, async () => {
      runs++;
    });
    expect(runs).toBe(1);
  });

  it('forgets the event when the handler fails, so a redelivery can try again', async () => {
    const event: Envelope = {
      id: randomUUID(),
      type: 'test',
      orderId: randomUUID(),
      data: {},
      at: new Date().toISOString(),
    };
    await expect(
      once(pool, event, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    let ran = false;
    await once(pool, event, async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});
