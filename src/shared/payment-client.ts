export type ChargeResult =
  { ok: true; chargeId: string } | { ok: false; kind: 'declined' | 'unavailable' };

export interface Charge {
  id: string;
  key: string;
  amount: number;
  status: 'captured' | 'declined';
}

/** Client for the payment provider. Every charge is keyed by order id, so retries are safe. */
export class PaymentClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = Number(process.env.PAYMENT_TIMEOUT_MS ?? 5000),
  ) {}

  async charge(orderId: string, amount: number): Promise<ChargeResult> {
    try {
      const res = await fetch(`${this.baseUrl}/charges`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': orderId },
        body: JSON.stringify({ amount, currency: 'THB' }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (res.status === 201) return { ok: true, chargeId: ((await res.json()) as Charge).id };
      await res.body?.cancel();
      return { ok: false, kind: res.status === 402 ? 'declined' : 'unavailable' };
    } catch {
      return { ok: false, kind: 'unavailable' };
    }
  }

  /** undefined when the provider can't be reached, null when it has no charge for this order. */
  async findCharge(orderId: string): Promise<Charge | null | undefined> {
    try {
      const res = await fetch(`${this.baseUrl}/charges/by-key/${orderId}`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (res.status === 404) return null;
      if (!res.ok) return undefined;
      return (await res.json()) as Charge;
    } catch {
      return undefined;
    }
  }

  async refund(chargeId: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/charges/${chargeId}/refund`, {
        method: 'POST',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      await res.body?.cancel();
      return res.ok;
    } catch {
      return false;
    }
  }
}
