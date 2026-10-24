# Temir Baza ERP/POS — Backend

NestJS 12 · TypeScript · PostgreSQL 16 · Drizzle ORM · Redis. TZ: [`docs/tz/`](docs/tz/00-README.md).

## Ishga tushirish

```bash
cp .env.example .env        # kerak bo'lsa portlar va JWT sirini o'zgartiring
npm install --legacy-peer-deps
npm run db:up               # Postgres (5433) va Redis Docker'da
npm run db:migrate          # drizzle/ dagi SQL migratsiyalar
npm run db:seed             # lug'atlar, rollar, "main" filial, demo xodimlar (admin/1234), namuna katalog
npm run start:dev
```

- API: `http://localhost:3000/api/v1`, OpenAPI UI: `http://localhost:3000/api/docs`, JSON: `/api/docs-json`
- Health: `GET /health`
- Demo foydalanuvchilar (faqat `SEED_DEMO=true`): `admin`, `kassir`, `omborchi`, `buxgalter` — parol `1234`, birinchi kirishda almashtirish majburiy (`POST /auth/change-password`).

Lokal Postgres 5432 portni band qilgani uchun Docker'dagi baza **5433** da.

## Buyruqlar

| Buyruq | Nima qiladi |
|---|---|
| `npm run db:generate` | `src/db/schema/` o'zgarishidan yangi SQL migratsiya yasaydi (`drizzle/`) |
| `npm run db:migrate` | Migratsiyalarni bazaga qo'llaydi (qo'llanganlari takrorlanmaydi) |
| `npm run db:seed` | Boshlang'ich ma'lumot (qayta ishga tushirish xavfsiz) |
| `npm run db:studio` | Drizzle Studio — bazani brauzerda ko'rish |
| `npm run typecheck` / `npm run lint` / `npm run build` | |

## Tuzilma

```
src/
  main.ts                 bootstrap: prefix /api/v1, CORS, validation, OpenAPI
  app.module.ts           modullar, global filter/guard/interceptor
  config/env.ts           muhit o'zgaruvchilari (zod bilan tekshiriladi)
  db/
    db.module.ts          Drizzle + pg Pool (DB token), numeric/bigint → number
    schema/*.ts           jadvallar modul bo'yicha (TZ 7)
    migrate.ts, seed.ts
  common/
    errors.ts             AppError + TZ 5.2 xato kodlari
    http-exception.filter {"error": {code, message, details, requestId}}
    auth-context.ts       @Perms, @BranchScoped, @CurrentUser, @BranchId
    idempotency.interceptor  Idempotency-Key (Postgres'da 24 soat)
    pricing.ts            birlik/narx/kesim hisobi — frontend calcLine bilan bir xil
    pagination.ts, version.ts, numbers.ts
  modules/
    auth        login, refresh (rotation), sessiyalar, parol
    users       xodimlar, rollar, filial admini cheklovlari
    branches    filiallar, Bosh admin overview
    settings    lug'atlar (GET/PUT butun to'plam), biznes qoidalari
    catalog     mahsulotlar, variantlar, konversiyalar, shtrix-kodlar, lookup
    inventory   stock_levels, kirim, o'rtacha tannarx, jurnal, tuzatish
    customers   mijozlar, qarz jurnali
    shifts      smena, Z-hisobot jamlari
    sales       quote, sotuv (aralash to'lov, nasiya, kesim), storno, qarz to'lovi
    expenses    xarajatlar, kassadan chiqim
    reports     dashboard, revenue, products, cashiers, payments, debts, P&L, cash-flow
    audit       audit jurnali
```

## Qoidalar (qisqa)

- **Filial konteksti:** `X-Branch-Id` sarlavhasi; bo'lmasa xodimning standart filiali (egasi uchun birinchi faol filial). Biriktirilmagan filial → `403 branch_forbidden`.
- **Pul** butun so'm (`bigint`), **miqdor** `numeric(18,4)`. Hisob faqat serverda: mijozdan `productId, variantId, unit, qty, cuts` olinadi.
- **Idempotentlik:** `POST /sales`, `/stock-in`, `/stock-adjustments`, `/customers/:id/payments`, `/shifts/open|close`, `/expenses`, `/sales/:id/void` — `Idempotency-Key` majburiy.
- **N+1 yo'q:** ro'yxatlar batch (`inArray`) yoki `GROUP BY` bilan; qoldiq o'zgarishi `FOR UPDATE` qulfi bilan, kalitlar tartiblangan (deadlock yo'q).
- **Tannarx va foyda** faqat `view_cost_price` bilan javobga kiradi.
- **Audit** biznes tranzaksiyasi bilan bir tranzaksiyada yoziladi.

## Keyingi qadamlar

- Frontendni API ga ulash (TZ 14): `openapi-typescript` bilan tiplar, `store.ts` amallarini so'rovlarga almashtirish, brauzer ma'lumotini import qilish (`POST /admin/import`).
- Real vaqt (`/events`), CSV import endpointi (`POST /products/import`), chek HTML/PDF shabloni.
- Testlar: pricing golden-test (frontend bilan), integratsiya (Testcontainers), huquqlar matritsasi.
