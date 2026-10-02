import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createPool, requireEnv, type Pool } from '../shared/db.js';

export const DB = Symbol('DB');

@Global()
@Module({
  providers: [{ provide: DB, useFactory: () => createPool(requireEnv('DATABASE_URL')) }],
  exports: [DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Pool) {}

  async onApplicationShutdown() {
    await this.db.end();
  }
}
