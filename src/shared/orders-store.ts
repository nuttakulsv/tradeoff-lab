import { randomUUID } from 'node:crypto';
import type { Queryable } from './db.js';
import {
  type ListOrdersQuery,
  type OrderLine,
  type OrderRow,
  type OrderStatus,
  type RejectReason,
} from './contract.js';

export const ORDERS_DDL = `
  CREATE SCHEMA IF NOT EXISTS orders;
  CREATE TABLE IF NOT EXISTS orders.orders (
    id uuid PRIMARY KEY,
    idempotency_key text UNIQUE,
    customer_id text NOT NULL,
    status text NOT NULL,
    reason text,
    items jsonb NOT NULL,
    amount integer,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
  );
  CREATE INDEX IF NOT EXISTS orders_status_idx ON orders.orders (status, updated_at);
`;

const COLUMNS = 'id, customer_id, status, reason, items, amount, created_at, updated_at';

export async function insertOrder(
  db: Queryable,
  order: { customerId: string; items: OrderLine[]; idempotencyKey?: string; status?: OrderStatus },
): Promise<OrderRow> {
  const { rows } = await db.query<OrderRow>(
    `INSERT INTO orders.orders (id, idempotency_key, customer_id, status, items)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
    [
      randomUUID(),
      order.idempotencyKey ?? null,
      order.customerId,
      order.status ?? 'PENDING',
      JSON.stringify(order.items),
    ],
  );
  return rows[0];
}

export async function findOrder(db: Queryable, id: string, forUpdate = false) {
  const { rows } = await db.query<OrderRow>(
    `SELECT ${COLUMNS} FROM orders.orders WHERE id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id],
  );
  return rows[0];
}

export async function findOrderByKey(db: Queryable, key: string) {
  const { rows } = await db.query<OrderRow>(
    `SELECT ${COLUMNS} FROM orders.orders WHERE idempotency_key = $1`,
    [key],
  );
  return rows[0];
}

export async function listOrders(db: Queryable, query: ListOrdersQuery) {
  const { rows } = await db.query<OrderRow>(
    `SELECT ${COLUMNS} FROM orders.orders
     WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC LIMIT $2`,
    [query.status ?? null, query.limit],
  );
  return rows;
}

/** Moves an order on only if it is still in one of the expected states. */
export async function transition(
  db: Queryable,
  id: string,
  from: OrderStatus[],
  patch: { status: OrderStatus; reason?: RejectReason; items?: OrderLine[]; amount?: number },
): Promise<OrderRow | undefined> {
  const { rows } = await db.query<OrderRow>(
    `UPDATE orders.orders
     SET status = $3, reason = COALESCE($4, reason), items = COALESCE($5, items),
         amount = COALESCE($6, amount), updated_at = clock_timestamp()
     WHERE id = $1 AND status = ANY($2) RETURNING ${COLUMNS}`,
    [
      id,
      from,
      patch.status,
      patch.reason ?? null,
      patch.items ? JSON.stringify(patch.items) : null,
      patch.amount ?? null,
    ],
  );
  return rows[0];
}
