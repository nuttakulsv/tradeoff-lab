import { Controller, Get, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import {
  INVENTORY_DDL,
  commitReservation,
  listProducts,
  releaseReservation,
  reserve,
  seedProducts,
} from '../../shared/stock.js';
import type { OrderLine } from '../../shared/contract.js';
import { consume, enqueue, once, type Envelope } from '../lib/bus.js';
import { Runtime, runService } from '../lib/runtime.js';

@Controller('products')
class ProductsController {
  constructor(private readonly runtime: Runtime) {}

  @Get()
  list() {
    return listProducts(this.runtime.db);
  }
}

@Injectable()
class StockHandler implements OnApplicationBootstrap {
  constructor(private readonly runtime: Runtime) {}

  async onApplicationBootstrap() {
    await seedProducts(this.runtime.db);
    const stop = await consume(
      this.runtime.bus,
      'inventory',
      ['orders.placed', 'orders.confirmed', 'orders.rejected', 'orders.cancelled'],
      (event) => this.handle(event),
    );
    this.runtime.onStop(stop);
  }

  handle(event: Envelope<{ items?: OrderLine[] }>) {
    return once(this.runtime.db, event, async (c) => {
      switch (event.type) {
        case 'orders.placed': {
          const result = await reserve(c, event.orderId, event.data.items!);
          if (result.ok) {
            await enqueue(c, 'inventory.reserved', event.orderId, {
              lines: result.lines,
              amount: result.amount,
            });
          } else {
            await enqueue(c, 'inventory.rejected', event.orderId, { reason: result.reason });
          }
          return;
        }
        case 'orders.confirmed':
          return commitReservation(c, event.orderId);
        case 'orders.rejected':
        case 'orders.cancelled':
          return releaseReservation(c, event.orderId);
      }
    });
  }
}

await runService({
  ddl: [INVENTORY_DDL],
  controllers: [ProductsController],
  providers: [StockHandler],
  port: Number(process.env.PORT ?? 4102),
});
