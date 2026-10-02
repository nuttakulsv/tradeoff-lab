import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Pool } from '../../shared/db.js';
import { DB } from '../database.js';
import { PaymentsService } from '../payments/payments.service.js';
import { OrdersService } from './orders.service.js';

const AFTER_MS = Number(process.env.RECOVERY_AFTER_MS ?? 30_000);
const EVERY_MS = Number(process.env.RECOVERY_INTERVAL_MS ?? 5_000);

/**
 * If the process dies while a customer waits for the payment, the order is left PENDING with
 * stock held. This job asks the provider what really happened and finishes the order.
 * AFTER_MS must be longer than the slowest in-flight payment call, or it races with it.
 */
@Injectable()
export class RecoveryService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RecoveryService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(DB) private readonly db: Pool,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.run(), EVERY_MS);
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  async run() {
    if (this.running) return;
    this.running = true;
    try {
      const { rows } = await this.db.query<{ id: string; status: string; amount: number }>(
        `SELECT id, status, amount FROM orders.orders
         WHERE status IN ('PENDING', 'CANCELLING') AND updated_at < clock_timestamp() - $1 * interval '1 millisecond'
         ORDER BY updated_at LIMIT 200`,
        [AFTER_MS],
      );
      for (const order of rows) {
        if (order.status === 'CANCELLING') {
          await this.orders.finishCancel(order.id);
          continue;
        }
        const charge = await this.payments.findCharge(order.id);
        if (charge === undefined) continue;
        if (charge?.status === 'captured')
          await this.orders.confirm(order.id, order.amount, charge.id);
        else await this.orders.reject(order.id, 'PAYMENT_UNAVAILABLE');
      }
      if (rows.length) this.logger.log(`recovered ${rows.length} orders`);
    } catch (err) {
      this.logger.error(err);
    } finally {
      this.running = false;
    }
  }
}
