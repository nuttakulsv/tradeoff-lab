import type { Queryable } from './db.js';

export const NOTIFICATIONS_DDL = `
  CREATE SCHEMA IF NOT EXISTS notifications;
  CREATE TABLE IF NOT EXISTS notifications.notifications (
    order_id uuid NOT NULL,
    kind text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (order_id, kind)
  );
`;

/** Stands in for sending an email or LINE message. The row is the proof it happened. */
export async function notify(db: Queryable, orderId: string, kind: 'confirmed' | 'cancelled') {
  await db.query(
    'INSERT INTO notifications.notifications (order_id, kind) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [orderId, kind],
  );
}
