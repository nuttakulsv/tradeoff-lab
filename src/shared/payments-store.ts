import type { Queryable } from './db.js';

export const PAYMENTS_DDL = `
  CREATE SCHEMA IF NOT EXISTS payments;
  CREATE TABLE IF NOT EXISTS payments.payments (
    order_id uuid PRIMARY KEY,
    charge_id text,
    amount integer NOT NULL,
    status text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
  );
`;

export async function recordPayment(
  db: Queryable,
  orderId: string,
  amount: number,
  status: 'captured' | 'failed' | 'refunded',
  chargeId: string | null = null,
) {
  await db.query(
    `INSERT INTO payments.payments (order_id, charge_id, amount, status) VALUES ($1, $2, $3, $4)
     ON CONFLICT (order_id) DO UPDATE
     SET charge_id = COALESCE(EXCLUDED.charge_id, payments.payments.charge_id),
         status = EXCLUDED.status, updated_at = clock_timestamp()`,
    [orderId, chargeId, amount, status],
  );
}

export async function findPayment(db: Queryable, orderId: string) {
  const { rows } = await db.query<{ charge_id: string | null; amount: number; status: string }>(
    'SELECT charge_id, amount, status FROM payments.payments WHERE order_id = $1',
    [orderId],
  );
  return rows[0];
}
