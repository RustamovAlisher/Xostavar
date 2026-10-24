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

## Testlar

```bash
npm test            # unit: hisob funksiyalari (narx, birlik, kesim, tannarx, telefon, sana) — bazasiz
npm run test:e2e    # integratsiya: haqiqiy Postgres, alohida `xostavar_test` bazasi (docker ichida yaratiladi)
```

Integratsiya testlari har yurishda test bazasini tozalab (`drop schema` → migratsiya → seed), Nest ilovasini xotirada ko'tarib, HTTP orqali tekshiradi. Fayllar ketma-ket ishlaydi, har biri o'z ma'lumotini (filial, mahsulot, mijoz) yaratadi:

| Fayl | Nima tekshiriladi |
|---|---|
| `auth` | login, bloklash, majburiy parol almashtirish, parol siyosati, refresh rotation va qayta ishlatish, sessiyalar, nofaol xodim |
| `users` | yaratish/tahrirlash qoidalari, o'z-o'zini o'zgartirish taqiqi, oxirgi admin (kesh poygasi bilan), filial admini doirasi, rollar |
| `branches` | kod, nofaol qilish qoidalari, nofaol filial xodimi, `X-Branch-Id`, overview |
| `settings` | butun to'plam saqlash, validatsiya, `in_use`, to'lov usullari qoidalari, reset |
| `catalog` | variantlar, avto SKU, kodlar unikalligi, qidiruv, lookup, tannarx yashirish, variant o'chirish, soft/hard delete |
| `inventory` | kirim va o'rtacha tannarx, idempotentlik, filial izolyatsiyasi, jurnal, tuzatish, yaxlitlik |
| `customers` | telefon, filtrlar, nasiya muddati qoidasi, ledger |
| `shifts` | bitta ochiq smena, egalik, Z-hisobot, `require_shift` |
| `sales` | quote, oddiy/aralash/nasiya sotuv, limit, chegirma chegarasi, kesim, chek raqami, idempotentlik, storno, qarz to'lovi, ro'yxat |
| `expenses` | kassadan chiqim va smena, huquqlar, ro'yxat |
| `reports` | dashboard va barcha hisobotlar aniq raqamlar bilan |
| `audit` | filtrlar, filial doirasi, umumiy amallar |
| `permissions` | huquqlar matritsasi: har endpoint ruxsatsiz rolda 403 |
| `concurrency` | 20 parallel sotuv (qoldiq manfiy emas), parallel kirim+sotuv, parallel qarz to'lovlari, butun baza yaxlitligi |

Test bazasi manzili: `TEST_DATABASE_URL` (standart `postgres://xostavar:xostavar@localhost:5433/xostavar_test`).

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
