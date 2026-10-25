import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

/** `npm run db:generate` — sxemadan SQL migratsiya yasaydi; `npm run db:migrate` — bazaga qo'llaydi. */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/entities/index.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://xostavar:xostavar@localhost:5432/xostavar' },
  strict: true,
  verbose: true,
});
