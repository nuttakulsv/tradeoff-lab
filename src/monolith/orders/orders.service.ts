import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  mergeItems,
  type OrderRow,
  type PlaceOrderBody,
  type RejectReason,
} from '../../shared/contract.js';
import { isUniqueViolation, tx, type Pool } from '../../shared/db.js';
import {
  ORDERS_DDL,
  findOrder,
  findOrderByKey,
  insertOrder,
  transition,
} from '../../shared/orders-store.js';
import { DB } from '../database.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { PaymentsService } from '../payments/payments.service.js';

@Injectable()
export class OrdersService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Pool,
    private readonly inventory: InventoryService,
    private readonly payments: PaymentsService,
    private readonly events: EventEmitter2,
  ) {}

  async onModuleInit() {
    await this.db.query(ORDERS_DDL);
  }

  /** Runs the whole order synchronously: the response already says CONFIRMED or REJECTED. */
  async place(body: PlaceOrderBody, idempotencyKey?: string) {
    if (idempotencyKey) {
      const existing = await findOrderByKey(this.db, idempotencyKey);
      if (existing) return { order: existing, created: false };
    }

    let order: OrderRow;
    try {
      // Stock and the order commit together: one database, one transaction.
      order = await tx(this.db, async (c) => {
        const placed = await insertOrder(c, {
          customerId: body.customerId,
          items: mergeItems(body.items),
          idempotencyKey,
        });
        const stock = await this.inventory.reserve(c, placed.id, placed.items);
        const patch = stock.ok
          ? { status: 'PENDING' as const, items: stock.lines, amount: stock.amount }
          : { status: 'REJECTED' as const, reason: stock.reason };
        return (await transition(c, placed.id, ['PENDING'], patch))!;
      });
    } catch (err) {
      if (idempotencyKey && isUniqueViolation(err)) {
        return { order: (await findOrderByKey(this.db, idempotencyKey))!, created: false };
      }
      throw err;
    }
    if (order.status !== 'PENDING') return { order, created: true };

    const payment = await this.payments.charge(order.id, order.amount!);
    order = payment.ok
      ? await this.confirm(order.id, order.amount!, payment.chargeId)
      : await this.reject(
          order.id,
          payment.kind === 'declined' ? 'PAYMENT_DECLINED' : 'PAYMENT_UNAVAILABLE',
        );
    return { order, created: true };
  }

  async confirm(id: string, amount: number, chargeId: string): Promise<OrderRow> {
    const confirmed = await tx(this.db, async (c) => {
      const row = await transition(c, id, ['PENDING'], { status: 'CONFIRMED' });
      if (row) {
        await this.inventory.commit(c, id);
        await this.payments.record(c, id, amount, chargeId);
      }
      return row;
    });
    if (!confirmed) return (await findOrder(this.db, id))!;
    this.events.emit('order.confirmed', { orderId: id });
    return confirmed;
  }

  async reject(id: string, reason: RejectReason): Promise<OrderRow> {
    const rejected = await tx(this.db, async (c) => {
      const row = await transition(c, id, ['PENDING'], { status: 'REJECTED', reason });
      if (row) await this.inventory.release(c, id);
      return row;
    });
    return rejected ?? (await findOrder(this.db, id))!;
  }

  async cancel(id: string): Promise<OrderRow> {
    const order = await findOrder(this.db, id);
    if (!order) throw new NotFoundException('Order not found');
    if (order.status === 'CANCELLING' || order.status === 'CANCELLED') return order;
    if (order.status !== 'CONFIRMED') {
      throw new ConflictException(
        `Only confirmed orders can be cancelled, this one is ${order.status}`,
      );
    }
    if (!(await transition(this.db, id, ['CONFIRMED'], { status: 'CANCELLING' }))) {
      return (await findOrder(this.db, id))!;
    }
    return this.finishCancel(id);
  }

  /** Refund first, then give the stock back. If the refund fails the order stays CANCELLING. */
  async finishCancel(id: string): Promise<OrderRow> {
    if (!(await this.payments.refund(id))) return (await findOrder(this.db, id))!;
    const cancelled = await tx(this.db, async (c) => {
      const row = await transition(c, id, ['CANCELLING'], { status: 'CANCELLED' });
      if (row) await this.inventory.release(c, id);
      return row;
    });
    if (!cancelled) return (await findOrder(this.db, id))!;
    this.events.emit('order.cancelled', { orderId: id });
    return cancelled;
  }
}
