import { describe, expect, it } from 'vitest';
import { decidePayment } from '../src/microservices/payments/policy.js';

const unavailable = { ok: false, kind: 'unavailable' } as const;

describe('payment retry policy', () => {
  it('passes success and declines straight through', () => {
    expect(decidePayment({ ok: true, chargeId: 'ch_1' }, 1, 0, 0, 60_000)).toEqual({
      emit: 'payments.succeeded',
      chargeId: 'ch_1',
    });
    expect(decidePayment({ ok: false, kind: 'declined' }, 1, 0, 0, 60_000)).toEqual({
      emit: 'payments.failed',
      reason: 'PAYMENT_DECLINED',
    });
  });

  it('backs off exponentially while the provider is down, capped at 4 s', () => {
    expect([1, 2, 3, 4, 5, 9].map((n) => decidePayment(unavailable, n, 0, 1000, 60_000))).toEqual([
      { retryInMs: 250 },
      { retryInMs: 500 },
      { retryInMs: 1000 },
      { retryInMs: 2000 },
      { retryInMs: 4000 },
      { retryInMs: 4000 },
    ]);
  });

  it('gives up once the retry window has passed', () => {
    expect(decidePayment(unavailable, 20, 0, 60_000, 60_000)).toEqual({
      emit: 'payments.failed',
      reason: 'PAYMENT_UNAVAILABLE',
    });
  });
});
