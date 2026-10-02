import { Controller, Get, Module } from '@nestjs/common';
import { InventoryService } from './inventory.service.js';

@Controller('products')
class ProductsController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  list() {
    return this.inventory.products();
  }
}

@Module({
  controllers: [ProductsController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
