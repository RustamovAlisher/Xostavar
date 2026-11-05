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
  /** Yuklangan fayllar (mahsulot rasmlari) papkasi; `/api/v1/uploads/` orqali tarqatiladi. */
  UPLOAD_DIR: z.string().default('./uploads'),
  /** Telegram bot tokeni (zaxira xizmati bilan umumiy bo'lishi mumkin). */
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  /**
   * Savdo boti (har sotuv xabari, 21:00 hisobot, tugmalar). Bitta token bilan faqat BITTA muhitda yoqing —
   * ikki server bir botdan `getUpdates` qilsa Telegram 409 qaytaradi.
   */
  SALES_BOT_ENABLED: z
    .string()
    .default('false')
    .transform((s) => s === 'true' || s === '1'),
  /** Kun yakuni hisoboti vaqti (Toshkent), HH:MM. */
  SALES_BOT_DAILY_AT: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM formatida').default('21:00'),
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
