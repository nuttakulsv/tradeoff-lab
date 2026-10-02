import type { ChargeResult } from '../../shared/payment-client.js';

export type PaymentDecision =
  | { emit: 'payments.succeeded'; chargeId: string }
  | { emit: 'payments.failed'; reason: 'PAYMENT_DECLINED' | 'PAYMENT_UNAVAILABLE' }
  | { retryInMs: number };

/**
 * Nobody is holding an HTTP request open here, so an unavailable provider is retried with
 * backoff for up to windowMs after the request was first published. Declines are final.
 */
export function decidePayment(
  result: ChargeResult,
  attempt: number,
  publishedAt: number,
  now: number,
  windowMs: number,
): PaymentDecision {
  if (result.ok) return { emit: 'payments.succeeded', chargeId: result.chargeId };
  if (result.kind === 'declined') return { emit: 'payments.failed', reason: 'PAYMENT_DECLINED' };
  if (now - publishedAt >= windowMs)
    return { emit: 'payments.failed', reason: 'PAYMENT_UNAVAILABLE' };
  return { retryInMs: Math.min(250 * 2 ** (attempt - 1), 4000) };
}
