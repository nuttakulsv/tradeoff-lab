import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

const TERMINAL = new Set(['CONFIRMED', 'REJECTED', 'CANCELLED']);

export interface Sample {
  /** ms since the load started */
  at: number;
  status: number;
  requestMs: number;
  /** POST until a final status was seen, including polling. null if it never got there. */
  e2eMs: number | null;
  final?: string;
  reason?: string;
  error?: string;
}

export interface LoadOptions {
  baseUrl: string;
  concurrency: number;
  durationMs: number;
  items: () => { sku: string; qty: number }[];
  /** Send every POST twice at the same moment with the same Idempotency-Key. */
  duplicateRequests?: boolean;
  pollMs?: number;
  waitTimeoutMs?: number;
}

/**
 * Closed-loop load: each virtual user places an order and waits until it is CONFIRMED or
 * REJECTED before placing the next one, like a customer staring at a "processing" screen.
 * A 202 response is followed by polling GET /orders/:id every pollMs.
 */
export async function runLoad(opts: LoadOptions) {
  const pollMs = opts.pollMs ?? 50;
  const waitTimeoutMs = opts.waitTimeoutMs ?? 60_000;
  const samples: Sample[] = [];
  let polls = 0;
  let duplicatesSent = 0;
  const t0 = performance.now();
  const end = t0 + opts.durationMs;

  const user = async (vu: number) => {
    let n = 0;
    while (performance.now() < end) {
      const body = JSON.stringify({ customerId: `vu-${vu}`, items: opts.items() });
      const headers = {
        'content-type': 'application/json',
        'idempotency-key': `${vu}-${n++}-${randomUUID()}`,
      };
      const start = performance.now();
      const post = () =>
        fetch(`${opts.baseUrl}/orders`, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(30_000),
        });

      let res: Response;
      try {
        if (opts.duplicateRequests) {
          const [first, second] = await Promise.all([post(), post().catch(() => undefined)]);
          await second?.body?.cancel();
          duplicatesSent++;
          res = first;
        } else {
          res = await post();
        }
      } catch (err) {
        samples.push({
          at: start - t0,
          status: 0,
          requestMs: performance.now() - start,
          e2eMs: null,
          error: (err as Error).message,
        });
        await sleep(50);
        continue;
      }
      const requestMs = performance.now() - start;
      if (!res.ok) {
        await res.body?.cancel();
        samples.push({ at: start - t0, status: res.status, requestMs, e2eMs: null });
        await sleep(50);
        continue;
      }

      let order = (await res.json()) as { id: string; status: string; reason?: string };
      while (!TERMINAL.has(order.status) && performance.now() - start < waitTimeoutMs) {
        await sleep(pollMs);
        polls++;
        try {
          const r = await fetch(`${opts.baseUrl}/orders/${order.id}`, {
            signal: AbortSignal.timeout(10_000),
          });
          if (r.ok) order = (await r.json()) as typeof order;
          else await r.body?.cancel();
        } catch {
          // keep polling, the gateway may be restarting
        }
      }
      const done = TERMINAL.has(order.status);
      samples.push({
        at: start - t0,
        status: res.status,
        requestMs,
        e2eMs: done ? performance.now() - start : null,
        final: order.status,
        reason: order.reason ?? undefined,
      });
    }
  };

  await Promise.all(Array.from({ length: opts.concurrency }, (_, vu) => user(vu)));
  return { samples, polls, duplicatesSent, elapsedMs: performance.now() - t0 };
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

export function summarize(values: number[]) {
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    p50: round(percentile(values, 50)),
    p95: round(percentile(values, 95)),
    p99: round(percentile(values, 99)),
    max: round(values.reduce((m, v) => Math.max(m, v), 0)),
  };
}
