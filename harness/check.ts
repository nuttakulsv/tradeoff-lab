import { setTimeout as sleep } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { PRODUCTS } from '../src/shared/stock.js';
import type { Postgres } from './infra.js';
import { providerUrl } from './session.js';
import type { VariantSpec } from './variants.js';

export async function unfinished(pg: Postgres, spec: VariantSpec, createdBefore?: Date) {
  const [row] = await pg.query<{ n: string }>(
    spec.databases.orders,
    `SELECT count(*) AS n FROM orders.orders WHERE status IN ('PENDING', 'CANCELLING')
     AND ($1::timestamptz IS NULL OR created_at < $1)`,
    [createdBefore ?? null],
  );
  return Number(row.n);
}

/** Waits until no order is PENDING or CANCELLING. Returns how long that took, or null on timeout. */
export async function settle(pg: Postgres, spec: VariantSpec, timeoutMs = 90_000) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    if ((await unfinished(pg, spec)) === 0) return performance.now() - t0;
    await sleep(100);
  }
  return null;
}

/**
 * The questions that matter after a failure, answered from the databases and the provider's
 * ledger rather than from what the API said.
 */
export async function checkInvariants(pg: Postgres, spec: VariantSpec) {
  const db = spec.databases;
  const orders = await pg.query<{
    id: string;
    status: string;
    reason: string | null;
    items: { sku: string; qty: number }[];
  }>(db.orders, 'SELECT id, status, reason, items FROM orders.orders');
  const [dupes] = await pg.query<{ n: string }>(
    db.orders,
    `SELECT count(*) AS n FROM (SELECT idempotency_key FROM orders.orders
     WHERE idempotency_key IS NOT NULL GROUP BY 1 HAVING count(*) > 1) d`,
  );
  const products = await pg.query<{ sku: string; available: number }>(
    db.inventory,
    'SELECT sku, available FROM inventory.products',
  );
  const notified = new Set(
    (
      await pg.query<{ order_id: string }>(
        db.notifications,
        `SELECT order_id FROM notifications.notifications WHERE kind = 'confirmed'`,
      )
    ).map((r) => r.order_id),
  );
  const ledger = (await (await fetch(`${providerUrl}/ledger`)).json()) as {
    requests: number;
    charges: { id: string; key: string; amount: number }[];
    refunds: { chargeId: string }[];
  };

  const byStatus: Record<string, number> = {};
  const byReason: Record<string, number> = {};
  for (const o of orders) {
    byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
    if (o.reason) byReason[o.reason] = (byReason[o.reason] ?? 0) + 1;
  }

  // Every unit that left the shelf should belong to a confirmed order, and only to one.
  const sold = new Map<string, number>();
  for (const o of orders.filter((o) => o.status === 'CONFIRMED')) {
    for (const line of o.items) sold.set(line.sku, (sold.get(line.sku) ?? 0) + line.qty);
  }
  let stockLeaked = 0;
  let stockOversold = 0;
  for (const p of products) {
    const initial = PRODUCTS.find((x) => x.sku === p.sku)!.stock;
    const diff = initial - p.available - (sold.get(p.sku) ?? 0);
    if (diff > 0) stockLeaked += diff;
    if (diff < 0) stockOversold -= diff;
  }

  // Money: a capture that was not refunded must belong to a confirmed order, and the reverse.
  const refunded = new Set(ledger.refunds.map((r) => r.chargeId));
  const kept = new Set(ledger.charges.filter((c) => !refunded.has(c.id)).map((c) => c.key));
  const status = new Map(orders.map((o) => [o.id, o.status]));
  const chargedWithoutOrder = [...kept].filter((key) => status.get(key) !== 'CONFIRMED').length;
  const confirmed = orders.filter((o) => o.status === 'CONFIRMED');
  const confirmedWithoutCharge = confirmed.filter((o) => !kept.has(o.id)).length;
  const missingNotifications = confirmed.filter((o) => !notified.has(o.id)).length;

  const stuck = (byStatus.PENDING ?? 0) + (byStatus.CANCELLING ?? 0);
  return {
    orders: orders.length,
    byStatus,
    byReason,
    stuck,
    duplicateOrders: Number(dupes.n),
    stockLeaked,
    stockOversold,
    chargedWithoutOrder,
    confirmedWithoutCharge,
    missingNotifications,
    providerRequests: ledger.requests,
    ok:
      stuck === 0 &&
      Number(dupes.n) === 0 &&
      stockLeaked === 0 &&
      stockOversold === 0 &&
      chargedWithoutOrder === 0 &&
      confirmedWithoutCharge === 0 &&
      missingNotifications === 0,
  };
}

export type Invariants = Awaited<ReturnType<typeof checkInvariants>>;
