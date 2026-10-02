import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { RecoveryService } from './recovery.service.js';

@Module({
  imports: [InventoryModule, PaymentsModule],
  controllers: [OrdersController],
  providers: [OrdersService, RecoveryService],
})
export class OrdersModule {}
