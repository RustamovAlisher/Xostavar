import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

/**
 * `npm run db:migrate` — drizzle/ dagi SQL fayllarni tartib bilan qo'llaydi.
 * Qo'llanganlar `drizzle.__drizzle_migrations` jadvalida saqlanadi, takror qo'llanmaydi.
 */
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);
await migrate(db, { migrationsFolder: './drizzle' });
console.log('Migratsiyalar qo\'llandi');
await pool.end();
