import { defineConfig } from 'vitest/config';

/**
 * Integratsiya testlari: haqiqiy PostgreSQL (docker, alohida `xostavar_test` bazasi).
 * Fayllar ketma-ket ishlaydi (bitta baza), har fayl o'z ma'lumotini yaratadi.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://xostavar:xostavar@localhost:5433/xostavar_test',
      JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret-0000',
      JWT_ACCESS_TTL: '15m',
      SEED_DEMO: 'true',
      CORS_ORIGINS: 'http://localhost:5173',
    },
  },
});
