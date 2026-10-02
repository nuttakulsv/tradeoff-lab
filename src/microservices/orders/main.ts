import {
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpCode,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  listOrdersSchema,
  mergeItems,
  placeOrderSchema,
  toView,
  type ListOrdersQuery,
  type PlaceOrderBody,
} from '../../shared/contract.js';
import { isUniqueViolation, tx } from '../../shared/db.js';
import {
  ORDERS_DDL,
  findOrder,
  findOrderByKey,
  insertOrder,
  listOrders,
} from '../../shared/orders-store.js';
import { consume, enqueue, once, type Envelope } from '../lib/bus.js';
import { Runtime, runService } from '../lib/runtime.js';
import { decide, type SagaEvent, type SagaState } from './saga.js';

const SAGA_DDL = `ALTER TABLE orders.orders ADD COLUMN IF NOT EXISTS step text NOT NULL DEFAULT 'RESERVING'`;

@Controller('orders')
class OrdersController {
  constructor(private readonly runtime: Runtime) {}

  /** Accepts the order and returns at once. The saga decides CONFIRMED or REJECTED later. */
  @Post()
  async place(
    @Body({ schema: placeOrderSchema }) body: PlaceOrderBody,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const db = this.runtime.db;
    if (key) {
      const existing = await findOrderByKey(db, key);
      if (existing) {
        res.status(200);
        return toView(existing);
      }
    }
    try {
      const order = await tx(db, async (c) => {
        const placed = await insertOrder(c, {
          customerId: body.customerId,
          items: mergeItems(body.items),
          idempotencyKey: key,
        });
        await enqueue(c, 'orders.placed', placed.id, { items: placed.items });
        return placed;
      });
      res.status(202);
      return toView(order);
    } catch (err) {
      if (!key || !isUniqueViolation(err)) throw err;
      res.status(200);
      return toView((await findOrderByKey(db, key))!);
    }
  }

  @Get()
  async list(@Query({ schema: listOrdersSchema }) query: ListOrdersQuery) {
    return (await listOrders(this.runtime.db, query)).map(toView);
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const order = await findOrder(this.runtime.db, id);
    if (!order) throw new NotFoundException('Order not found');
    return toView(order);
  }

  @Post(':id/cancel')
  @HttpCode(202)
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const order = await tx(this.runtime.db, async (c) => {
      const row = await findOrder(c, id, true);
      if (!row) throw new NotFoundException('Order not found');
      if (row.status === 'CANCELLING' || row.status === 'CANCELLED') return row;
      if (row.status !== 'CONFIRMED') {
        throw new ConflictException(
          `Only confirmed orders can be cancelled, this one is ${row.status}`,
        );
      }
      await c.query(
        `UPDATE orders.orders SET status = 'CANCELLING', step = 'REFUNDING', updated_at = clock_timestamp() WHERE id = $1`,
        [id],
      );
      await enqueue(c, 'orders.cancel-requested', id);
      return (await findOrder(c, id))!;
    });
    if (order.status === 'CANCELLED') res.status(200);
    return toView(order);
  }
}

@Injectable()
class OrderSaga implements OnApplicationBootstrap {
  constructor(private readonly runtime: Runtime) {}

  async onApplicationBootstrap() {
    const stop = await consume(
      this.runtime.bus,
      'orders',
      [
        'inventory.reserved',
        'inventory.rejected',
        'payments.succeeded',
        'payments.failed',
        'payments.refunded',
      ],
      (event) => this.handle(event),
    );
    this.runtime.onStop(stop);
  }

  handle(event: Envelope) {
    return once(this.runtime.db, event, async (c) => {
      const { rows } = await c.query<SagaState>(
        'SELECT status, step FROM orders.orders WHERE id = $1 FOR UPDATE',
        [event.orderId],
      );
      if (!rows[0]) return;
      const { patch, emit } = decide(rows[0], event as unknown as SagaEvent);
      if (patch) {
        await c.query(
          `UPDATE orders.orders SET status = $2, step = $3, reason = COALESCE($4, reason),
             items = COALESCE($5, items), amount = COALESCE($6, amount), updated_at = clock_timestamp()
           WHERE id = $1`,
          [
            event.orderId,
            patch.status,
            patch.step,
            patch.reason ?? null,
            patch.items ? JSON.stringify(patch.items) : null,
            patch.amount ?? null,
          ],
        );
      }
      for (const e of emit) await enqueue(c, e.type, event.orderId, e.data);
    });
  }
}

await runService({
  ddl: [ORDERS_DDL, SAGA_DDL],
  controllers: [OrdersController],
  providers: [OrderSaga],
  port: Number(process.env.PORT ?? 4101),
});
