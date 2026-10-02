import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { NOTIFICATIONS_DDL, notify } from '../../shared/notifications-store.js';
import { consume, once, type Envelope } from '../lib/bus.js';
import { Runtime, runService } from '../lib/runtime.js';

@Injectable()
class NotificationsHandler implements OnApplicationBootstrap {
  constructor(private readonly runtime: Runtime) {}

  async onApplicationBootstrap() {
    const stop = await consume(
      this.runtime.bus,
      'notifications',
      ['orders.confirmed', 'orders.cancelled'],
      (event) => this.handle(event),
    );
    this.runtime.onStop(stop);
  }

  handle(event: Envelope) {
    const kind = event.type === 'orders.confirmed' ? 'confirmed' : 'cancelled';
    return once(this.runtime.db, event, (c) => notify(c, event.orderId, kind));
  }
}

await runService({
  ddl: [NOTIFICATIONS_DDL],
  providers: [NotificationsHandler],
  port: Number(process.env.PORT ?? 4104),
});
