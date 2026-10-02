import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';

// Black-box tests both variants must pass. They only talk HTTP: the public API and the
// payment provider's admin and ledger endpoints. Point them at a running variant with
// API_URL and PAYMENT_PROVIDER_URL.

const BASE = process.env.API_URL ?? 'http://127.0.0.1:4000';
const PROVIDER = process.env.PAYMENT_PROVIDER_URL ?? 'http://127.0.0.1:4010';
const TERMINAL = ['CONFIRMED', 'REJECTED', 'CANCELLED'];

async function api(path: string, init: RequestInit & { json?: unknown } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
    body: init.json === undefined ? init.body : JSON.stringify(init.json),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

async function provider(path: string, json: unknown) {
  await fetch(`${PROVIDER}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(json),
  });
}

async function settle(id: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { body } = await api(`/orders/${id}`);
    if (TERMINAL.includes(body.status) || Date.now() > deadline) return body;
    await sleep(25);
  }
}

async function stock(sku: string): Promise<number> {
  const { body } = await api('/products');
  return body.find((p: { sku: string }) => p.sku === sku).available;
}

/** Stock moves after the order status in the event-driven variant, so wait for it. */
async function stockEventually(sku: string, expected: number, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let value = await stock(sku);
  while (value !== expected && Date.now() < deadline) {
    await sleep(25);
    value = await stock(sku);
  }
  return value;
}

async function ledger() {
  const res = await fetch(`${PROVIDER}/ledger`);
  return (await res.json()) as {
    charges: { key: string; amount: number }[];
    refunds: { chargeId: string }[];
  };
}

const order = (items = [{ sku: 'LATTE', qty: 2 }]) => ({ customerId: `c-${randomUUID()}`, items });

afterEach(() =>
  provider('/admin/config', { latencyMs: 0, declineRate: 0, unavailableRate: 0, down: false }),
);

describe('catalog', () => {
  it('lists products with price and available stock', async () => {
    const { status, body } = await api('/products');
    expect(status).toBe(200);
    expect(body.map((p: { sku: string }) => p.sku)).toEqual([
      'CROISSANT',
      'LATTE',
      'MOONCAKE',
      'THAI-TEA',
    ]);
    expect(body[1]).toMatchObject({ sku: 'LATTE', price: 8500 });
  });
});

describe('placing an order', () => {
  it('confirms it, charges the right amount and takes the stock', async () => {
    const before = await stock('LATTE');
    const placed = await api('/orders', {
      method: 'POST',
      json: order([
        { sku: 'LATTE', qty: 2 },
        { sku: 'THAI-TEA', qty: 1 },
        { sku: 'LATTE', qty: 1 },
      ]),
    });
    expect([201, 202]).toContain(placed.status);

    const final = await settle(placed.body.id);
    expect(final.status).toBe('CONFIRMED');
    expect(final.amount).toBe(3 * 8500 + 6500);
    expect(final.items).toEqual([
      { sku: 'LATTE', qty: 3, unitPrice: 8500 },
      { sku: 'THAI-TEA', qty: 1, unitPrice: 6500 },
    ]);
    expect(await stock('LATTE')).toBe(before - 3);
    const charge = (await ledger()).charges.find((c) => c.key === final.id);
    expect(charge?.amount).toBe(final.amount);
  });

  it('rejects an order it cannot fill and keeps the stock as it was', async () => {
    const before = await stock('THAI-TEA');
    const placed = await api('/orders', {
      method: 'POST',
      json: order([
        { sku: 'THAI-TEA', qty: 1000 },
        { sku: 'MOONCAKE', qty: 999 },
      ]),
    });
    const final = await settle(placed.body.id);
    expect(final).toMatchObject({ status: 'REJECTED', reason: 'OUT_OF_STOCK' });
    expect(await stock('THAI-TEA')).toBe(before);
  });

  it('rejects unknown products', async () => {
    const placed = await api('/orders', { method: 'POST', json: order([{ sku: 'NOPE', qty: 1 }]) });
    expect(await settle(placed.body.id)).toMatchObject({
      status: 'REJECTED',
      reason: 'UNKNOWN_SKU',
    });
  });

  it('gives the stock back when the card is declined', async () => {
    await provider('/admin/config', { declineRate: 1 });
    const before = await stock('CROISSANT');
    const placed = await api('/orders', {
      method: 'POST',
      json: order([{ sku: 'CROISSANT', qty: 2 }]),
    });
    expect(await settle(placed.body.id)).toMatchObject({
      status: 'REJECTED',
      reason: 'PAYMENT_DECLINED',
    });
    expect(await stockEventually('CROISSANT', before)).toBe(before);
  });

  it('validates the body', async () => {
    const { status } = await api('/orders', {
      method: 'POST',
      json: { customerId: '', items: [{ sku: 'LATTE', qty: 0 }] },
    });
    expect(status).toBe(400);
  });

  it('returns the same order for a repeated Idempotency-Key and charges once', async () => {
    const key = randomUUID();
    const body = order();
    const [a, b] = await Promise.all([
      api('/orders', { method: 'POST', json: body, headers: { 'idempotency-key': key } }),
      api('/orders', { method: 'POST', json: body, headers: { 'idempotency-key': key } }),
    ]);
    expect(a.body.id).toBe(b.body.id);
    const again = await api('/orders', {
      method: 'POST',
      json: body,
      headers: { 'idempotency-key': key },
    });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(a.body.id);
    await settle(a.body.id);
    expect((await ledger()).charges.filter((c) => c.key === a.body.id)).toHaveLength(1);
  });
});

describe('reading orders', () => {
  it('returns 404 for an unknown id and 400 for a malformed one', async () => {
    expect((await api(`/orders/${randomUUID()}`)).status).toBe(404);
    expect((await api('/orders/not-a-uuid')).status).toBe(400);
  });

  it('lists orders filtered by status', async () => {
    const placed = await api('/orders', { method: 'POST', json: order() });
    await settle(placed.body.id);
    const { status, body } = await api('/orders?status=CONFIRMED&limit=5');
    expect(status).toBe(200);
    expect(body.length).toBeGreaterThan(0);
    expect(body.every((o: { status: string }) => o.status === 'CONFIRMED')).toBe(true);
  });
});

describe('cancelling', () => {
  it('refunds a confirmed order and puts the stock back', async () => {
    const placed = await api('/orders', {
      method: 'POST',
      json: order([{ sku: 'THAI-TEA', qty: 4 }]),
    });
    const confirmed = await settle(placed.body.id);
    expect(confirmed.status).toBe('CONFIRMED');
    const before = await stock('THAI-TEA');

    const cancel = await api(`/orders/${confirmed.id}/cancel`, { method: 'POST' });
    expect([200, 202]).toContain(cancel.status);
    expect((await settle(confirmed.id)).status).toBe('CANCELLED');
    expect(await stockEventually('THAI-TEA', before + 4)).toBe(before + 4);

    const { charges, refunds } = await ledger();
    const charge = charges.find((c) => c.key === confirmed.id) as { id?: string } | undefined;
    expect(refunds.some((r) => r.chargeId === charge?.id)).toBe(true);
  });

  it('refuses to cancel an order that was not confirmed', async () => {
    const placed = await api('/orders', { method: 'POST', json: order([{ sku: 'NOPE', qty: 1 }]) });
    await settle(placed.body.id);
    expect((await api(`/orders/${placed.body.id}/cancel`, { method: 'POST' })).status).toBe(409);
  });
});
