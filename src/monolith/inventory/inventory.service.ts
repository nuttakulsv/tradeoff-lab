import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { OrderLine } from '../../shared/contract.js';
import type { Pool, Queryable } from '../../shared/db.js';
import {
  INVENTORY_DDL,
  commitReservation,
  listProducts,
  releaseReservation,
  reserve,
  seedProducts,
} from '../../shared/stock.js';
import { DB } from '../database.js';

/** The only way other modules touch stock. They pass in their transaction; the SQL stays here. */
@Injectable()
export class InventoryService implements OnModuleInit {
  constructor(@Inject(DB) private readonly db: Pool) {}

  async onModuleInit() {
    await this.db.query(INVENTORY_DDL);
    await seedProducts(this.db);
  }

  reserve(tx: Queryable, orderId: string, lines: OrderLine[]) {
    return reserve(tx, orderId, lines);
  }

  commit(tx: Queryable, orderId: string) {
    return commitReservation(tx, orderId);
  }

  release(tx: Queryable, orderId: string) {
    return releaseReservation(tx, orderId);
  }

  products() {
    return listProducts(this.db);
  }
}
