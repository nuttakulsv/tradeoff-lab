import { describe, expect, it } from 'vitest';
import { decide } from '../src/microservices/orders/saga.js';

const lines = [{ sku: 'LATTE', qty: 2, unitPrice: 8500 }];

describe('place-order saga', () => {
  it('asks for payment once stock is reserved', () => {
    const d = decide(
      { status: 'PENDING', step: 'RESERVING' },
      { type: 'inventory.reserved', data: { lines, amount: 17000 } },
    );
    expect(d.patch).toMatchObject({ status: 'PENDING', step: 'PAYING', amount: 17000 });
    expect(d.emit).toEqual([{ type: 'payments.requested', data: { amount: 17000 } }]);
  });

  it('rejects without compensation when stock was never taken', () => {
    const d = decide(
      { status: 'PENDING', step: 'RESERVING' },
      { type: 'inventory.rejected', data: { reason: 'OUT_OF_STOCK' } },
    );
    expect(d.patch).toMatchObject({ status: 'REJECTED', reason: 'OUT_OF_STOCK' });
    expect(d.emit).toEqual([]);
  });

  it('compensates a failed payment by telling inventory to release', () => {
    const d = decide(
      { status: 'PENDING', step: 'PAYING' },
      { type: 'payments.failed', data: { reason: 'PAYMENT_DECLINED' } },
    );
    expect(d.patch).toMatchObject({ status: 'REJECTED', step: 'DONE', reason: 'PAYMENT_DECLINED' });
    expect(d.emit).toEqual([{ type: 'orders.rejected', data: {} }]);
  });

  it('confirms on a successful payment', () => {
    const d = decide(
      { status: 'PENDING', step: 'PAYING' },
      { type: 'payments.succeeded', data: { chargeId: 'ch_1' } },
    );
    expect(d.patch).toMatchObject({ status: 'CONFIRMED', step: 'DONE' });
    expect(d.emit).toEqual([{ type: 'orders.confirmed', data: {} }]);
  });

  it('ignores events that arrive out of turn or twice', () => {
    expect(
      decide(
        { status: 'CONFIRMED', step: 'DONE' },
        { type: 'payments.succeeded', data: { chargeId: 'x' } },
      ),
    ).toEqual({ emit: [] });
    expect(
      decide(
        { status: 'PENDING', step: 'PAYING' },
        { type: 'inventory.reserved', data: { lines, amount: 1 } },
      ),
    ).toEqual({ emit: [] });
    expect(
      decide(
        { status: 'REJECTED', step: 'DONE' },
        { type: 'payments.failed', data: { reason: 'PAYMENT_DECLINED' } },
      ),
    ).toEqual({ emit: [] });
    expect(
      decide({ status: 'CONFIRMED', step: 'DONE' }, { type: 'payments.refunded', data: {} }),
    ).toEqual({ emit: [] });
  });

  it('finishes a cancellation after the refund', () => {
    const d = decide(
      { status: 'CANCELLING', step: 'REFUNDING' },
      { type: 'payments.refunded', data: {} },
    );
    expect(d.patch).toMatchObject({ status: 'CANCELLED' });
    expect(d.emit).toEqual([{ type: 'orders.cancelled', data: {} }]);
  });
});
