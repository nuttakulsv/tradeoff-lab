import { Inject, Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { Pool } from '../../shared/db.js';
import { NOTIFICATIONS_DDL, notify } from '../../shared/notifications-store.js';
import { DB } from '../database.js';

// In-process events: cheap and simple, but if the process dies between the order commit
// and this handler, the notification is lost. The lab measures how often that happens.
@Injectable()
class NotificationsListener implements OnModuleInit {
  constructor(@Inject(DB) private readonly db: Pool) {}

  async onModuleInit() {
    await this.db.query(NOTIFICATIONS_DDL);
  }

  @OnEvent('order.confirmed', { async: true, promisify: true })
  confirmed({ orderId }: { orderId: string }) {
    return notify(this.db, orderId, 'confirmed');
  }

  @OnEvent('order.cancelled', { async: true, promisify: true })
  cancelled({ orderId }: { orderId: string }) {
    return notify(this.db, orderId, 'cancelled');
  }
}

@Module({ providers: [NotificationsListener] })
export class NotificationsModule {}
