import { z } from 'zod';

/**
 * Muhit o'zgaruvchilari bitta joyda tekshiriladi (12-factor).
 * Noto'g'ri yoki yetishmayotgan qiymat bo'lsa ilova ishga tushmaydi — bu runtime'da sirli xatolardan yaxshi.
 */
const schema = z.object({
  NODE_ENV: z.enum(['local', 'staging', 'production', 'test']).default('local'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET kamida 32 belgi'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)),
  SEED_DEMO: z
    .string()
    .default('true')
    .transform((s) => s === 'true' || s === '1'),
});

export type Env = z.infer<typeof schema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const r = schema.safeParse(raw);
  if (!r.success) {
    const lines = r.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Muhit o'zgaruvchilari noto'g'ri:\n${lines}`);
  }
  if (r.data.NODE_ENV === 'production' && r.data.SEED_DEMO) {
    throw new Error('production da SEED_DEMO=true bo\'lishi mumkin emas (demo parollar)');
  }
  return r.data;
}
