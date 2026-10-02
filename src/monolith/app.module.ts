import { Controller, Get, Inject, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import type { Pool } from '../shared/db.js';
import { DB, DatabaseModule } from './database.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { PaymentsModule } from './payments/payments.module.js';

@Controller('health')
class HealthController {
  constructor(@Inject(DB) private readonly db: Pool) {}

  @Get()
  async check() {
    await this.db.query('SELECT 1');
    return { status: 'ok' };
  }
}

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    DatabaseModule,
    InventoryModule,
    PaymentsModule,
    NotificationsModule,
    OrdersModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
