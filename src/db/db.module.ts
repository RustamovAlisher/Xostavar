import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';
import type { Env } from '../config/env.js';

export const DB = Symbol('DB');
export type Db = NodePgDatabase<typeof schema> & { $client: pg.Pool };
/** Tranzaksiya ichidagi `tx` ham, oddiy `db` ham shu turda — servislar ikkalasini qabul qiladi. */
export type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

// numeric (qty/money) ni string emas, son sifatida qaytaramiz; bigint ham (pul 2^53 dan kichik)
pg.types.setTypeParser(1700, (v) => Number(v));
pg.types.setTypeParser(20, (v) => Number(v));

@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const pool = new pg.Pool({
          connectionString: config.get('DATABASE_URL', { infer: true }),
          max: 10,
          idleTimeoutMillis: 30_000,
        });
        return drizzle(pool, { schema, casing: 'snake_case' });
      },
    },
    { provide: 'DB_SHUTDOWN', inject: [DB], useFactory: (db: Db) => new DbShutdown(db) },
  ],
  exports: [DB],
})
export class DbModule {}

class DbShutdown implements OnApplicationShutdown {
  constructor(private readonly db: Db) {}
  async onApplicationShutdown() {
    await this.db.$client.end();
  }
}
