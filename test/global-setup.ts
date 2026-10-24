import { execFileSync } from 'node:child_process';
import pg from 'pg';

/**
 * Har test yurishidan oldin test bazasi toza holatga keltiriladi: schema drop → migratsiya → seed.
 * Seed'dan keyin demo foydalanuvchilarning "parolni almashtiring" belgisi olib tashlanadi — testlar to'g'ridan-to'g'ri kiradi
 * (majburiy almashtirish alohida testda yangi foydalanuvchi bilan tekshiriladi).
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://xostavar:xostavar@localhost:5433/xostavar_test';
  const env = { ...process.env, DATABASE_URL: url, NODE_ENV: 'test', SEED_DEMO: 'true' };
  const pool = new pg.Pool({ connectionString: url });
  await pool.query('drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;');
  await pool.end();
  execFileSync('npx', ['tsx', 'src/db/migrate.ts'], { env, stdio: 'pipe' });
  execFileSync('npx', ['tsx', 'src/db/seed.ts'], { env, stdio: 'pipe' });
  const p2 = new pg.Pool({ connectionString: url });
  await p2.query('update users set must_change_password = false');
  await p2.end();
}
