import 'reflect-metadata';
import {
  Controller,
  Get,
  Module,
  StandardSchemaValidationPipe,
  type DynamicModule,
  type OnApplicationShutdown,
  type Type,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createPool, requireEnv, type Pool } from '../../shared/db.js';
import { MESSAGING_DDL, connectBus, startRelay, type Bus } from './bus.js';

/** Database pool, broker connection and outbox relay for one service. */
export class Runtime implements OnApplicationShutdown {
  private readonly stops: (() => Promise<void> | void)[] = [];

  private constructor(
    readonly db: Pool,
    readonly bus: Bus,
  ) {}

  static async create(ddl: string[]) {
    const db = createPool(requireEnv('DATABASE_URL'));
    for (const statement of [MESSAGING_DDL, ...ddl]) await db.query(statement);
    const runtime = new Runtime(db, await connectBus(requireEnv('NATS_URL')));
    runtime.stops.push(startRelay(db, runtime.bus));
    return runtime;
  }

  onStop(stop: () => Promise<void> | void) {
    this.stops.push(stop);
  }

  async onApplicationShutdown() {
    for (const stop of this.stops.reverse()) await stop();
    await this.bus.nc.drain();
    await this.db.end();
  }
}

@Controller('health')
class HealthController {
  constructor(private readonly runtime: Runtime) {}

  @Get()
  async check() {
    await this.runtime.db.query('SELECT 1');
    if (this.runtime.bus.nc.isClosed()) throw new Error('broker connection closed');
    return { status: 'ok' };
  }
}

export async function runService(options: {
  ddl: string[];
  controllers?: Type[];
  providers?: Type[];
  port: number;
}) {
  @Module({})
  class ServiceModule {
    static forRoot(): DynamicModule {
      return {
        module: ServiceModule,
        controllers: [HealthController, ...(options.controllers ?? [])],
        providers: [
          { provide: Runtime, useFactory: () => Runtime.create(options.ddl) },
          ...(options.providers ?? []),
        ],
      };
    }
  }

  const app = await NestFactory.create(ServiceModule.forRoot(), {
    logger: ['error', 'warn', 'log'],
  });
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.enableShutdownHooks();
  await app.listen(options.port);
  return app;
}
