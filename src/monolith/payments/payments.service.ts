import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { setTimeout as sleep } from 'node:timers/promises';
import { requireEnv, type Pool, type Queryable } from '../../shared/db.js';
import { PaymentClient, type ChargeResult } from '../../shared/payment-client.js';
import { PAYMENTS_DDL, findPayment, recordPayment } from '../../shared/payments-store.js';
import { DB } from '../database.js';

const ATTEMPTS = Number(process.env.PAYMENT_ATTEMPTS ?? 3);

@Injectable()
export class PaymentsService implements OnModuleInit {
  private readonly client = new PaymentClient(requireEnv('PAYMENT_URL'));

  constructor(@Inject(DB) private readonly db: Pool) {}

  async onModuleInit() {
    await this.db.query(PAYMENTS_DDL);
  }

  /** The customer is waiting on this call, so retries are short: a few hundred ms in total. */
  async charge(orderId: string, amount: number): Promise<ChargeResult> {
    let result: ChargeResult = { ok: false, kind: 'unavailable' };
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      result = await this.client.charge(orderId, amount);
      if (result.ok || result.kind === 'declined') return result;
      if (attempt < ATTEMPTS) await sleep(100 * attempt);
    }
    return result;
  }

  findCharge(orderId: string) {
    return this.client.findCharge(orderId);
  }

  record(tx: Queryable, orderId: string, amount: number, chargeId: string) {
    return recordPayment(tx, orderId, amount, 'captured', chargeId);
  }

  async refund(orderId: string): Promise<boolean> {
    const payment = await findPayment(this.db, orderId);
    if (!payment?.charge_id) return false;
    if (payment.status === 'refunded') return true;
    if (!(await this.client.refund(payment.charge_id))) return false;
    await recordPayment(this.db, orderId, payment.amount, 'refunded');
    return true;
  }
}
