import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import request, { type Response } from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

/** Bugungi sana — server bilan bir xil (Asia/Tashkent), UTC emas. */
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date());
export const uniq = (p = '') => `${p}${Math.random().toString(36).slice(2, 8)}`;

export async function createApp(): Promise<INestApplication> {
  const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = m.createNestApplication({ logger: process.env.TEST_LOG ? ['error', 'warn'] : false });
  configureApp(app);
  await app.init();
  return app;
}

/** To'g'ridan-to'g'ri SQL (yaxlitlik tekshiruvlari uchun). */
export function rawDb() {
  return new pg.Pool({ connectionString: process.env.DATABASE_URL });
}

export interface Client {
  token: string;
  branchId?: string;
  get: (path: string) => Promise<Response>;
  post: (path: string, body?: unknown, opts?: { idem?: string | false }) => Promise<Response>;
  put: (path: string, body?: unknown) => Promise<Response>;
  patch: (path: string, body?: unknown) => Promise<Response>;
  del: (path: string) => Promise<Response>;
  /** Boshqa filial kontekstida. */
  at: (branchId: string) => Client;
}

export function client(app: INestApplication, token: string, branchId?: string): Client {
  const base = '/api/v1';
  const h = (r: request.Test) => {
    r.set('authorization', `Bearer ${token}`);
    if (branchId) r.set('x-branch-id', branchId);
    return r;
  };
  return {
    token,
    branchId,
    get: (p) => h(request(app.getHttpServer()).get(base + p)),
    post: (p, body, opts) => {
      const r = h(request(app.getHttpServer()).post(base + p));
      if (opts?.idem !== false) r.set('idempotency-key', opts?.idem ?? randomUUID());
      return r.send(body ?? {});
    },
    put: (p, body) => h(request(app.getHttpServer()).put(base + p)).send(body ?? {}),
    patch: (p, body) => h(request(app.getHttpServer()).patch(base + p)).send(body ?? {}),
    del: (p) => h(request(app.getHttpServer()).delete(base + p)),
    at: (b) => client(app, token, b),
  };
}

export async function login(app: INestApplication, loginName: string, password = '1234'): Promise<{ token: string; refreshToken: string; user: Record<string, unknown> }> {
  const r = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ login: loginName, password });
  if (r.status !== 200) throw new Error(`login ${loginName}: ${r.status} ${JSON.stringify(r.body)}`);
  return { token: r.body.accessToken, refreshToken: r.body.refreshToken, user: r.body.user };
}

export async function as(app: INestApplication, loginName: string, password = '1234', branchId?: string): Promise<Client> {
  const { token } = await login(app, loginName, password);
  return client(app, token, branchId);
}

/** Xato javobi: { error: { code } } */
export const code = (r: Response) => r.body?.error?.code;

export interface Seeded {
  admin: Client;
  kassir: Client;
  omborchi: Client;
  buxgalter: Client;
  mainId: string;
  settings: Record<string, any>;
  methods: Record<string, string>; // code → id
  cats: Record<string, string>; // name → id
}

/** Standart aktyorlar va lug'atlar (seed). */
export async function seeded(app: INestApplication): Promise<Seeded> {
  const admin = await as(app, 'admin');
  const branches = (await admin.get('/branches')).body as { id: string; code: string }[];
  const mainId = branches.find((b) => b.code === 'MAIN')!.id;
  const settings = (await admin.get('/settings')).body;
  return {
    admin: admin.at(mainId),
    kassir: await as(app, 'kassir'),
    omborchi: await as(app, 'omborchi'),
    buxgalter: await as(app, 'buxgalter'),
    mainId,
    settings,
    methods: Object.fromEntries(settings.paymentMethods.map((m: { code: string; id: string }) => [m.code, m.id])),
    cats: Object.fromEntries(settings.categories.map((c: { name: string; id: string }) => [c.name, c.id])),
  };
}

/** Oddiy (variantsiz) mahsulot yaratadi va kerak bo'lsa kirim qiladi. */
export async function makeProduct(c: Client, s: Seeded, o: { name?: string; baseUnit?: string; isDivisible?: boolean; price?: number; stock?: number; cost?: number; conversions?: unknown[]; category?: string } = {}) {
  const r = await c.post('/products', {
    name: o.name ?? uniq('Tovar '), categoryId: s.cats[o.category ?? "Xo'jalik mollari"], baseUnit: o.baseUnit ?? 'piece', isDivisible: o.isDivisible ?? false,
    conversions: o.conversions ?? [], retailPrice: o.price ?? 10000, isVariable: false,
  }, { idem: false });
  if (r.status !== 201) throw new Error(`product: ${r.status} ${JSON.stringify(r.body)}`);
  const p = r.body as { id: string; sku: string };
  if (o.stock) {
    const si = await c.post('/stock-in', { lines: [{ productId: p.id, unit: o.baseUnit ?? 'piece', qty: o.stock, costPerUnit: o.cost ?? 0 }] });
    if (si.status !== 201) throw new Error(`stock-in: ${si.status} ${JSON.stringify(si.body)}`);
  }
  return p;
}

/** Ochiq smena bo'lmasa ochadi; qaytaradi: yopish funksiyasi. */
export async function ensureShift(c: Client, openingCash = 0) {
  const cur = await c.get('/shifts/current');
  if (!cur.body || !cur.body.id) {
    const r = await c.post('/shifts/open', { openingCash });
    if (r.status !== 201) throw new Error(`shift open: ${r.status} ${JSON.stringify(r.body)}`);
  }
  return () => c.post('/shifts/close', {});
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
