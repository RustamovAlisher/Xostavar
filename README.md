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
| `npm run db:generate` | `src/entities/` o'zgarishidan yangi SQL migratsiya yasaydi (`drizzle/`) |
| `npm run db:migrate` | Migratsiyalarni bazaga qo'llaydi (qo'llanganlari takrorlanmaydi) |
| `npm run db:seed` | Boshlang'ich ma'lumot (qayta ishga tushirish xavfsiz) |
| `npm run db:studio` | Drizzle Studio — bazani brauzerda ko'rish |
| `npm run typecheck` / `npm run lint` / `npm run build` | |

## Tuzilma

Qatlamlar Java loyihalaridagi kabi alohida papkalarda: **entity → repository → service → controller**, oraliqda **dto** (kiruvchi) va **mapper** (chiquvchi).

```
src/
  main.ts                 bootstrap: prefix /api/v1, CORS, validation, OpenAPI
  app.module.ts           modullar, global filter/guard/interceptor
  config/env.ts           muhit o'zgaruvchilari (zod bilan tekshiriladi)
  entities/*.ts           Drizzle jadvallari = entity (TZ 7); modul bo'yicha fayllar
  db/
    db.module.ts          Drizzle + pg Pool (DB token), numeric/bigint → number
    tx.ts                 runTx — deadlock/serialization da qayta urinish
    migrate.ts, seed.ts
  common/
    decorators/           @Perms, @BranchScoped, @CurrentUser, @BranchId, AuthUser
    filters/              HttpExceptionFilter → {"error": {code, message, details, requestId}} + log
    interceptors/         Idempotency-Key (Postgres'da 24 soat)
    pipes/                ValidationPipe, xabarlar o'zbekcha
    errors/               AppError + TZ 5.2 kodlari; Postgres xatolari tarjimasi
    utils/                pricing (frontend calcLine bilan bir xil), numbers, pagination, version
    constants/            huquqlar ro'yxati
  modules/<nom>/
    <nom>.module.ts       DI: providers = service + repository, exports = service
    controllers/          HTTP: yo'l, huquq, DTO → service chaqiruvi (logika yo'q)
    dto/                  class-validator bilan kiruvchi ma'lumot
    services/             biznes qoidalari, tranzaksiya (runTx), audit; SQL yozmaydi
    repositories/         barcha Drizzle so'rovlari; `tx` qabul qiladi; xato tashlamaydi
    mappers/              satr → API javobi (toXView); toza funksiyalar, DI yo'q
    guards/, constants/   faqat kerak bo'lgan modulda (auth, settings)
```

Modullar:

```
auth        login, refresh (rotation), sessiyalar, parol
users       xodimlar, rollar, filial admini cheklovlari
branches    filiallar, Bosh admin overview
settings    lug'atlar (GET/PUT butun to'plam), biznes qoidalari
catalog     mahsulotlar, variantlar, konversiyalar, shtrix-kodlar, lookup, filial narxi
inventory   stock_levels, kirim, o'rtacha tannarx, jurnal, tuzatish
customers   mijozlar, qarz jurnali
shifts      smena, Z-hisobot jamlari
sales       quote, sotuv (aralash to'lov, nasiya, kesim), storno, qarz to'lovi
expenses    xarajatlar, kassadan chiqim
reports     dashboard, revenue, products, cashiers, payments, debts, P&L, cash-flow
audit       audit jurnali (jadval + info log)
health      /health
```

Qoida: service `drizzle-orm` yoki `entities` ni import qilmaydi — SQL faqat repository da. Yangi modul yozganda `shifts` modulini namuna qiling.

## Testlar

```bash
npm test            # unit: hisob funksiyalari (narx, birlik, kesim, tannarx, telefon, sana), PG xatolari tarjimasi, validatsiya xabarlari, runTx qayta urinish — bazasiz
npm run test:e2e    # integratsiya: haqiqiy Postgres, alohida `xostavar_test` bazasi (docker ichida yaratiladi)
```

Integratsiya testlari har yurishda test bazasini tozalab (`drop schema` → migratsiya → seed), Nest ilovasini xotirada ko'tarib, HTTP orqali tekshiradi. Fayllar ketma-ket ishlaydi, har biri o'z ma'lumotini (filial, mahsulot, mijoz) yaratadi:

| Fayl | Nima tekshiriladi |
|---|---|
| `auth` | login, bloklash, majburiy parol almashtirish, parol siyosati, refresh rotation (parallel refresh — atomik), qayta ishlatish, sessiyalar, nofaol xodim |
| `users` | yaratish/tahrirlash qoidalari, o'z-o'zini o'zgartirish taqiqi, oxirgi admin (kesh poygasi bilan), filial admini doirasi, rollar |
| `branches` | kod, nofaol qilish qoidalari (parallel deaktivatsiya ham), nofaol filial xodimi, `X-Branch-Id`, overview |
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
| `errors` | global xato formati: 404/400/413/422 tuzilmasi, `requestId`, validatsiya `details.errors` |
| `scope` | id bilan so'rashda filial/egalik chegarasi, yopilgan smena Z-hisobotining storno/chiqim o'chirilgandan keyin qayta hisoblanishi, filial narxi (parallel upsert), variantsiz→variantli o'tishda qoldiq, quote ogohlantirishlari, qidiruv indekslari |

Sana testlarda `today()` yordamchisi bilan Toshkent vaqti bo'yicha olinadi (server ham shu zonada hisoblaydi).

Test bazasi manzili: `TEST_DATABASE_URL` (standart `postgres://xostavar:xostavar@localhost:5433/xostavar_test`).

## Qoidalar (qisqa)

- **Filial konteksti:** `X-Branch-Id` sarlavhasi; bo'lmasa xodimning standart filiali (egasi uchun birinchi faol filial). Biriktirilmagan filial → `403 branch_forbidden`.
- **Pul** butun so'm (`bigint`), **miqdor** `numeric(18,4)`. Hisob faqat serverda: mijozdan `productId, variantId, unit, qty, cuts` olinadi.
- **Idempotentlik:** `POST /sales`, `/stock-in`, `/stock-adjustments`, `/customers/:id/payments`, `/shifts/open|close`, `/expenses`, `/sales/:id/void` — `Idempotency-Key` majburiy.
- **N+1 yo'q:** ro'yxatlar batch (`inArray`) yoki `GROUP BY` bilan; qoldiq o'zgarishi `FOR UPDATE` qulfi bilan, kalitlar tartiblangan (deadlock yo'q).
- **Tannarx va foyda** faqat `view_cost_price` bilan javobga kiradi.
- **Audit** biznes tranzaksiyasi bilan bir tranzaksiyada yoziladi.

## Loglar

Hammasi pino orqali JSON (dev da `pino-pretty`), har yozuvda `requestId` (so'rov sarlavhasi `X-Request-Id` bilan bir xil):

| Daraja | Qayerda | Nima |
|---|---|---|
| `info` | pino-http | har so'rov: metod, URL, status, davomiyligi (`/health` dan tashqari) |
| `info` | `Audit` | har biznes voqea: modul/amal, obyekt, kim, filial, qisqa tafsilot |
| `info` | `Auth` | kirish, chiqish, barcha sessiyalar yopilishi |
| `warn` | `Auth` | login bloklandi, refresh token qayta ishlatildi (sessiya oilasi bekor) |
| `warn` | `Http` | har 4xx: status, kod, yo'l, foydalanuvchi, mijozga ketgan xabar |
| `warn` | `Tx` | deadlock/serialization — qayta urinish |
| `error` | `Http` | har 5xx: to'liq stack va `cause`; mijozga faqat umumiy xabar |
| `fatal` | process | `uncaughtException` / `unhandledRejection` |

Parol, token, `Authorization`/`Cookie` sarlavhalari loglarga tushmaydi (redaksiya).

## Keyingi qadamlar

- Frontend API ga ulangan (`../frontend/src/api`): kirish, katalog, kirim, savdo, nasiya, smena, xarajat, hisobot, audit, xodimlar, filiallar.
- Brauzer ma'lumotini import qilish (`POST /admin/import`, TZ 14.2) — faqat eski localStorage ma'lumoti kerak bo'lsa.
- Real vaqt (`/events`), CSV import endpointi (`POST /products/import`), chek HTML/PDF shabloni, filiallar aro ko'chirish.
