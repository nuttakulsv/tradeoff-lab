import type { Queryable } from './db.js';
import type { OrderLine, RejectReason } from './contract.js';

export const PRODUCTS = [
  { sku: 'THAI-TEA', name: 'Thai milk tea', price: 6500, stock: 10_000_000 },
  { sku: 'LATTE', name: 'Iced latte', price: 8500, stock: 10_000_000 },
  { sku: 'CROISSANT', name: 'Butter croissant', price: 7500, stock: 10_000_000 },
  { sku: 'MOONCAKE', name: 'Limited mooncake box', price: 59000, stock: 100 },
];

export const INVENTORY_DDL = `
  CREATE SCHEMA IF NOT EXISTS inventory;
  CREATE TABLE IF NOT EXISTS inventory.products (
    sku text PRIMARY KEY,
    name text NOT NULL,
    price integer NOT NULL,
    available integer NOT NULL CHECK (available >= 0)
  );
  CREATE TABLE IF NOT EXISTS inventory.reservations (
    order_id uuid NOT NULL,
    sku text NOT NULL,
    qty integer NOT NULL,
    status text NOT NULL,
    PRIMARY KEY (order_id, sku)
  );
`;

export async function seedProducts(db: Queryable) {
  for (const p of PRODUCTS) {
    await db.query(
      `INSERT INTO inventory.products (sku, name, price, available) VALUES ($1, $2, $3, $4)
       ON CONFLICT (sku) DO NOTHING`,
      [p.sku, p.name, p.price, p.stock],
    );
  }
}

export type Reservation =
  | { ok: true; lines: OrderLine[]; amount: number }
  | { ok: false; reason: Extract<RejectReason, 'OUT_OF_STOCK' | 'UNKNOWN_SKU'> };

/**
 * Takes stock for every line or for none. Must run inside a transaction; on failure it rolls
 * back to its own savepoint so the caller can still commit other work (inbox, outbox).
 * Lines are expected sorted by sku so concurrent orders lock rows in the same order.
 */
export async function reserve(
  db: Queryable,
  orderId: string,
  lines: OrderLine[],
): Promise<Reservation> {
  await db.query('SAVEPOINT reserve');
  const priced: OrderLine[] = [];
  for (const line of lines) {
    const { rows } = await db.query<{ price: number }>(
      `UPDATE inventory.products SET available = available - $2
       WHERE sku = $1 AND available >= $2 RETURNING price`,
      [line.sku, line.qty],
    );
    if (!rows[0]) {
      const exists = await db.query('SELECT 1 FROM inventory.products WHERE sku = $1', [line.sku]);
      await db.query('ROLLBACK TO SAVEPOINT reserve');
      return { ok: false, reason: exists.rowCount ? 'OUT_OF_STOCK' : 'UNKNOWN_SKU' };
    }
    await db.query(
      `INSERT INTO inventory.reservations (order_id, sku, qty, status) VALUES ($1, $2, $3, 'reserved')`,
      [orderId, line.sku, line.qty],
    );
    priced.push({ ...line, unitPrice: rows[0].price });
  }
  await db.query('RELEASE SAVEPOINT reserve');
  return {
    ok: true,
    lines: priced,
    amount: priced.reduce((sum, l) => sum + l.qty * l.unitPrice!, 0),
  };
}

export async function commitReservation(db: Queryable, orderId: string) {
  await db.query(
    `UPDATE inventory.reservations SET status = 'committed' WHERE order_id = $1 AND status = 'reserved'`,
    [orderId],
  );
}

/** Puts reserved or sold stock back. Safe to call twice: released rows are skipped. */
export async function releaseReservation(db: Queryable, orderId: string) {
  await db.query(
    `WITH released AS (
       UPDATE inventory.reservations SET status = 'released'
       WHERE order_id = $1 AND status IN ('reserved', 'committed') RETURNING sku, qty
     )
     UPDATE inventory.products p SET available = p.available + released.qty
     FROM released WHERE p.sku = released.sku`,
    [orderId],
  );
}

export async function listProducts(db: Queryable) {
  const { rows } = await db.query<{ sku: string; name: string; price: number; available: number }>(
    'SELECT sku, name, price, available FROM inventory.products ORDER BY sku',
  );
  return rows;
}
