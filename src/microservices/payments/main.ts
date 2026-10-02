import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { JsMsg } from '@nats-io/jetstream';
import { requireEnv } from '../../shared/db.js';
import { PaymentClient } from '../../shared/payment-client.js';
import { PAYMENTS_DDL, findPayment, recordPayment } from '../../shared/payments-store.js';
import { consume, enqueue, once, seen, type Envelope, type Outcome } from '../lib/bus.js';
import { Runtime, runService } from '../lib/runtime.js';
import { decidePayment } from './policy.js';

const RETRY_WINDOW_MS = Number(process.env.PAYMENT_RETRY_WINDOW_MS ?? 60_000);

@Injectable()
class PaymentsHandler implements OnApplicationBootstrap {
  private readonly client = new PaymentClient(requireEnv('PAYMENT_URL'));

  constructor(private readonly runtime: Runtime) {}

  async onApplicationBootstrap() {
    const stop = await consume(
      this.runtime.bus,
      'payments',
      ['payments.requested', 'orders.cancel-requested'],
      (event, msg) =>
        event.type === 'payments.requested' ? this.charge(event, msg) : this.refund(event),
    );
    this.runtime.onStop(stop);
  }

  // The provider call happens outside the transaction; the order id is the idempotency key,
  // so calling it again after a crash or a duplicate delivery returns the same charge.
  async charge(event: Envelope<{ amount: number }>, msg: JsMsg): Promise<Outcome> {
    if (await seen(this.runtime.db, event)) return;
    const result = await this.client.charge(event.orderId, event.data.amount);
    const decision = decidePayment(
      result,
      msg.info.deliveryCount,
      msg.time.getTime(),
      Date.now(),
      RETRY_WINDOW_MS,
    );
    if ('retryInMs' in decision) return decision;

    await once(this.runtime.db, event, async (c) => {
      if (decision.emit === 'payments.succeeded') {
        await recordPayment(c, event.orderId, event.data.amount, 'captured', decision.chargeId);
        await enqueue(c, decision.emit, event.orderId, { chargeId: decision.chargeId });
      } else {
        await recordPayment(c, event.orderId, event.data.amount, 'failed');
        await enqueue(c, decision.emit, event.orderId, { reason: decision.reason });
      }
    });
  }

  async refund(event: Envelope): Promise<Outcome> {
    if (await seen(this.runtime.db, event)) return;
    const payment = await findPayment(this.runtime.db, event.orderId);
    if (!payment?.charge_id) throw new Error(`no captured payment for order ${event.orderId}`);
    if (payment.status !== 'refunded' && !(await this.client.refund(payment.charge_id))) {
      return { retryInMs: 2000 };
    }
    await once(this.runtime.db, event, async (c) => {
      await recordPayment(c, event.orderId, payment.amount, 'refunded');
      await enqueue(c, 'payments.refunded', event.orderId);
    });
  }
}

await runService({
  ddl: [PAYMENTS_DDL],
  providers: [PaymentsHandler],
  port: Number(process.env.PORT ?? 4103),
});
