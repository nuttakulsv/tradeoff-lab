import { z } from 'zod';

export const placeOrderSchema = z.object({
  customerId: z.string().trim().min(1).max(64),
  items: z
    .array(
      z.object({
        sku: z.string().trim().min(1).max(64),
        qty: z.number().int().min(1).max(1000),
      }),
    )
    .min(1)
    .max(20),
});

export const listOrdersSchema = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLING', 'CANCELLED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PlaceOrderBody = z.infer<typeof placeOrderSchema>;
export type ListOrdersQuery = z.infer<typeof listOrdersSchema>;

export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLING' | 'CANCELLED';
export type RejectReason =
  'OUT_OF_STOCK' | 'UNKNOWN_SKU' | 'PAYMENT_DECLINED' | 'PAYMENT_UNAVAILABLE';

export const TERMINAL: readonly OrderStatus[] = ['CONFIRMED', 'REJECTED', 'CANCELLED'];

export interface OrderLine {
  sku: string;
  qty: number;
  unitPrice: number | null;
}

export interface OrderView {
  id: string;
  customerId: string;
  status: OrderStatus;
  reason: RejectReason | null;
  items: OrderLine[];
  amount: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderRow {
  id: string;
  customer_id: string;
  status: OrderStatus;
  reason: RejectReason | null;
  items: OrderLine[];
  amount: number | null;
  created_at: Date;
  updated_at: Date;
}

export function toView(row: OrderRow): OrderView {
  return {
    id: row.id,
    customerId: row.customer_id,
    status: row.status,
    reason: row.reason,
    items: row.items,
    amount: row.amount,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function mergeItems(items: PlaceOrderBody['items']): OrderLine[] {
  const qty = new Map<string, number>();
  for (const item of items) qty.set(item.sku, (qty.get(item.sku) ?? 0) + item.qty);
  return [...qty]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sku, q]) => ({ sku, qty: q, unitPrice: null }));
}
