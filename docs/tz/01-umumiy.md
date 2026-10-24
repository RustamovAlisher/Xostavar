# Umumiy ma'lumot, doira va arxitektura

> Manba: `frontend/docs/BACKEND_TZ.md` v1.3. Bo'lim raqamlari asl TZ dagidek qoldirilgan.

Loyiha maqsadi, nima kiradi va nima kirmaydi, texnologiyalar, server va nofunksional talablar. Har bir qismni boshlashdan oldin bir marta o'qiladi.

---

## 1. Umumiy ma'lumot

### 1.1. Maqsad
Hozirgi frontend ilova (kassa terminali, ombor, nasiya, statistika, xodimlar, sozlamalar) ma'lumotlarni faqat brauzerning `localStorage` xotirasida saqlaydi. Bu quyidagi muammolarni keltiradi: ma'lumot bitta qurilmaga bog'liq, bir nechta kassa/telefon bir vaqtda ishlay olmaydi, xotira to'lsa saqlash to'xtaydi, parol va huquqlar mijoz tomonida tekshiriladi (xavfsiz emas), zaxira nusxa yo'q.

Backend quyidagi maqsadlarni bajaradi:

1. Barcha ma'lumotning yagona, ishonchli manbasi (PostgreSQL).
2. Bir nechta qurilmadan (kassa kompyuter, telefon, planshet) bir vaqtda ishlash.
3. Haqiqiy autentifikatsiya va rollar bo'yicha ruxsat (server tomonida majburiy tekshiruv).
4. Pul va qoldiq hisob-kitoblarining yagona, tranzaksion va auditlanadigan bajarilishi.
5. Hisobotlar, zaxira nusxa, kuzatuv (monitoring).
6. Do'kon egasi uchun **daromad va chiqimlarni** (tushum, tannarx, foyda, xarajatlar, sof foyda) yagona joyda yuritish.
7. Keyingi bosqichlarda: filiallar kengayishi, SMS, to'lov tizimlari integratsiyasi.

### 1.2. Hozirgi frontend haqida qisqacha (backend uchun kontekst)
- Texnologiya: React 19, TypeScript, Zustand. Barcha mantiq `src/store.ts` da, yordamchi hisob funksiyalari `src/lib/units.ts` da.
- Ekranlar: Kassa (POS), Mahsulotlar, Moliya va statistika, Mijozlar va nasiya, Harakatlar tarixi, Xodimlar, Sozlamalar.
- Til: o'zbekcha (lotin). Pul: so'm (UZS), kasrsiz (butun). Miqdorlar kasr bo'lishi mumkin.
- Frontend model fayli: `src/types.ts`. **Backend ma'lumot modeli shu fayl bilan 1:1 mos bo'lishi shart** (7-bo'lim), keyin esa frontend minimal o'zgartirish bilan API ga ulanadi.

### 1.3. Ta'riflar

| Termin | Ma'nosi |
|---|---|
| Asosiy birlik (base unit) | Mahsulot qoldig'i va tannarxi saqlanadigan birlik (metr, kg, dona, qop, litr, m²...) |
| Konversiya | Qo'shimcha birlikni asosiy birlikka aylantirish koeffitsienti: `1 [birlik] = factor × [asosiy birlik]`. Masalan metrli armaturada `1 kg = 1.126 m`, `1 dona (tayoq) = 11.7 m` |
| Variant | Bir mahsulotning o'lchami/turi (Ø12, 40×20×2). Alohida SKU, narx, qoldiq, tannarx |
| Kesim (raskroy) | Metrli mahsulotni mijoz so'ragan uzunliklarda kesib sotish |
| Smena | Kassirning ish sessiyasi: ochiladi, sotuvlar shu smenaga bog'lanadi, yopilganda Z-hisobot chiqadi |
| Nasiya | Qarzga sotuv; mijozning umumiy qarzi, kredit limiti va muddati bor |
| O'rtacha tannarx | Kirimlar asosida hisoblanadigan og'irlikli o'rtacha tannarx (foyda hisobi uchun) |
| Idempotent so'rov | Bir xil so'rov takrorlansa natija bir marta qo'llanadi (tarmoq uzilganda ikki marta sotuv bo'lmasligi uchun) |

## 2. Doira (scope)

### 2.1. Birinchi versiyaga kiradi (MVP + Bosqich 1–3, 17-bo'lim)
- Autentifikatsiya, rollar va huquqlar, xodimlar boshqaruvi.
- Sozlamalar: do'kon ma'lumoti, o'lchov birliklari, kategoriyalar, o'lcham andozalari, mijoz guruhlari, to'lov usullari, yetkazib beruvchilar, rollar, biznes qoidalari.
- Mahsulotlar: universal model (asosiy birlik + konversiyalar + variantlar), kategoriyalar, shtrix-kodlar.
- Ombor: kirim (qabul), qoldiq, o'rtacha tannarx, kam qoldiq ogohlantirishi, tarix.
- Kassa: savat (server tomonida hisoblash), kesim, chegirma (so'mda, kassir bera oladi), QQS, sotuv, chek, **dinamik to'lov usullari** (egasi yangisini o'zi qo'shadi) va **aralash to'lov**, nasiya.
- Smena: ochish/yopish, Z-hisobot.
- Mijozlar va nasiya: mijoz kartochkasi, limit, muddat, qarz to'lovi.
- **Xarajatlar (chiqimlar):** xarajat kategoriyalari, xarajat yozuvlari, kassadan chiqim, sof foyda (7.11-band).
- Hisobotlar: kunlik/haftalik tushum va foyda, kategoriyalar ulushi, to'lov usullari, qoldiq qiymati, kam qoldiq, **foyda va zarar (P&L)**, kassa oqimi.
- **Chek chop etish:** kichik termo chek (58/80 mm) va A4 hujjat formati (12.1-band).
- **Mahsulotlarni ommaviy import** (Excel/CSV): mahsulotlar soni ko'p, mijozlar ro'yxati Excelda yo'q (qo'lda kiritiladi).
- **Filial bo'yicha narx** (`branch_prices`), filial bo'yicha alohida ombor, egasi uchun barcha filiallar ko'rinishi.
- Audit jurnali.
- Frontend uchun to'liq REST API + OpenAPI hujjati.
- Oflayn rejim uchun sinxronizatsiya mexanizmi (10-bo'lim).
- **Ko'p filialga tayyor sxema:** ma'lumotlar modeli boshidan filiallarni qo'llab-quvvatlaydi (7.0-band). Birinchi versiyada bitta filial (`main`) ishlaydi, interfeysda filial tanlagich filial soni 1 dan ko'p bo'lganda paydo bo'ladi.

### 2.2. Keyingi bosqichga (alohida kelishiladi)
- Filiallararo tovar ko'chirish (transfer), filiallar bo'yicha taqqoslash hisobotlari.
- To'lov tizimlari integratsiyasi (Click, Payme, Uzcard/Humo terminali).
- SMS xabarnomalar (qarz eslatmasi), Telegram bot.
- Yetkazib beruvchilar bilan hisob-kitob (kreditor qarz), buyurtma berish.
- Mijozlar sodiqlik tizimi (bonus, kupon).
- Tarozi va shtrix-kod printer integratsiyasi.
- Ma'lumotlarni Excel ga eksport/import (mahsulotlarni ommaviy yuklash MVP da bor, 9.4-band).

### 2.3. Doiraga kirmaydi
- **Soliq (fiskal) chek integratsiyasi va soliq hisoboti.** Tizim ichki hisob uchun; chekda "Ichki hisob cheki" yozuvi bo'ladi.
- Buxgalteriya (balans, provodkalar) va ish haqi hisobi.
- Sotuvni qaytarish (vozvrat) va almashtirish (hozircha kerak emas; faqat to'liq bekor qilish, 7.9-band).
- Valyuta: faqat so'm (UZS).
- Onlayn do'kon (e-commerce).

## 4. Arxitektura

### 4.1. Tavsiya etiladigan texnologiyalar
Quyidagilar tavsiya. Jamoa boshqa stek taklif qilsa, talablar o'zgarmaydi.

| Qatlam | Tanlov | Sababi |
|---|---|---|
| Til/freymvork | Node.js 22 LTS + TypeScript + NestJS (yoki Fastify) | Frontend bilan bir xil til, tiplarni ulashish mumkin |
| Ma'lumotlar bazasi | PostgreSQL 16 | Tranzaksiyalar, `numeric` aniqligi, JSONB, indekslar |
| ORM/migratsiya | Drizzle yoki Prisma + SQL migratsiyalar | Versiyalangan sxema |
| Kesh/navbat | Redis | Sessiyalar, rate limit, fon vazifalar (BullMQ) |
| API | REST (JSON), OpenAPI 3.1 | Oddiy, frontendga mos |
| Real vaqt | WebSocket yoki SSE | Qoldiq/smena o'zgarishlari boshqa qurilmalarga |
| Fayllar | S3-mos xotira (MinIO) | Mahsulot rasmlari, eksportlar (Bosqich 4) |
| Konteyner | Docker, docker-compose | Ishlab chiqish va ishga tushirish |
| CI/CD | GitHub Actions (yoki GitLab CI) | Test, lint, build, deploy |
| Monitoring | Prometheus + Grafana, Sentry, strukturali log (pino) | Kuzatuv |

### 4.2. Qatlamlar
```
Frontend (React)  ──HTTPS──▶  API gateway/Reverse proxy (Nginx/Caddy, TLS)
                                    │
                              Backend (modullar)
        auth · users · settings · catalog · inventory · sales · shifts · customers · reports · audit · sync
                                    │
                    PostgreSQL ── Redis ── (MinIO)
```

### 4.3. Modullar
`auth`, `users` (xodimlar, rollar), `settings` (lug'atlar), `catalog` (mahsulotlar, variantlar, kategoriyalar), `inventory` (kirim, qoldiq harakati), `sales` (savat hisobi, chek, sotuv), `shifts`, `customers` (mijoz + nasiya), `reports`, `audit`, `sync` (oflayn). Har modul o'z servis qatlami va DTO validatsiyasiga ega; tranzaksiya chegaralari servis darajasida.

### 4.4. Muhitlar
`local` (docker-compose), `staging`, `production`. Konfiguratsiya faqat muhit o'zgaruvchilari orqali (12-factor). Sirlar (DB paroli, JWT kalitlari) repoda saqlanmaydi.

### 4.5. Server (hosting) bo'yicha tavsiya

Hozirgi holat: **1 ta kassa**, internet kamdan-kam uziladi, kelajakda filiallar qo'shilishi mumkin. Server hali tanlanmagan.

| Variant | Qachon mos | Afzallik | Kamchilik |
|---|---|---|---|
| **A. Bulutdagi VPS, O'zbekistondagi data-markaz (tavsiya)** | Hozir va filiallar qo'shilganda | Hamma filial va telefondan bir xil kirish, avtomatik zaxira, elektr/uskuna muammosi yo'q, ma'lumot mamlakat ichida | Oylik to'lov; provayder sifatini tekshirish kerak |
| B. Xorijiy VPS (Germaniya, Finlandiya) | Arzon va barqaror xizmat kerak bo'lsa | Odatda arzon, barqaror | Mijozlar ismi va telefoni shaxsiy ma'lumot hisoblanadi; **mamlakat ichida saqlash talabi bo'lishi mumkin** (yurist bilan tekshiring). Tashkent'dan kechikish yuqoriroq (taxminan 80–150 ms, bu ilova uchun yetarli) |
| C. Do'kondagi kompyuter (o'z serveri) | Faqat sinov yoki bitta do'kon, tezkor boshlash | Oylik to'lov yo'q | Elektr o'chishi, uskuna buzilishi, tashqi tarmoqdan kirish murakkabligi, filial qo'shilganda ishlamaydi, zaxira qo'lda |

**Tavsiya: A variant.** Boshlang'ich konfiguratsiya (1 kassa, 1–2 filialgacha yetadi):
- 2 vCPU, 4 GB RAM, 60 GB NVMe SSD, Ubuntu 24.04 LTS.
- Docker Compose: Caddy yoki Nginx (HTTPS, Let's Encrypt), API, PostgreSQL 16, Redis.
- Filiallar ko'payganda: 4 vCPU, 8 GB RAM gacha oshiriladi (qayta o'rnatishsiz).
- Domen nomi (masalan `erp.sizningdomen.uz`) va HTTPS majburiy.
- **Zaxira:** kunlik `pg_dump` + WAL arxivi, **boshqa joyda** saqlanadi (boshqa provayder yoki ofisdagi disk), 30 kun; oyiga bir marta tiklash sinovi.
- **Kuzatuv:** server yetib bo'lmay qolsa Telegram/SMS ogohlantirish (UptimeRobot kabi xizmat), xatolar uchun Sentry.
- Narx provayder tarifiga bog'liq; boshlang'ich VPS uchun taxminan oyiga 10–30 USD oralig'i kutiladi (rasmiy tariflarni tekshiring).

Oflayn rejim (10-bo'lim) bitta kassa va barqaror internetda **MVP dan keyingi ixtiyoriy bosqich**. Uzilish bo'lsa kassir kutadi yoki qo'lda yozib, keyin kiritadi. Lekin API oflayn uchun boshidanoq tayyor qilinadi (idempotentlik, `clientId`).

## 13. Nofunksional talablar

| Mezon | Talab |
|---|---|
| Javob vaqti | `GET` ro'yxatlar p95 < 300 ms; `POST /sales` p95 < 500 ms (50 qatorgacha); qidiruv p95 < 200 ms (50 000 mahsulotgacha) |
| Yuklama | 20 bir vaqtdagi foydalanuvchi, 10 ta kassa; kuniga 5 000 chek, 100 000 chek qatori |
| Mavjudlik | 99.5% (ish vaqtida 99.9%) |
| Zaxira | Kunlik to'liq `pg_dump`, WAL arxiv (PITR), 30 kun saqlash; haftada bir tiklash sinovi |
| RPO / RTO | RPO ≤ 15 daqiqa, RTO ≤ 2 soat |
| Xavfsizlik | OWASP ASVS 2-daraja asosiy talablari; bog'liqliklar skaneri (npm audit/Dependabot) |
| Kuzatuv | Strukturali loglar, `requestId`, metrikalar (so'rov vaqti, xatolar, DB), ogohlantirishlar |
| Ma'lumot yaxlitligi | Pul/qoldiq tranzaksiyalari ACID, `SERIALIZABLE` yoki qator qulfi; jadval cheklovlari (CHECK, FK, UNIQUE) |
| Moslik | Zamonaviy brauzerlar, Android/iOS Chrome/Safari |
| Til | Xato matnlari o'zbek (lotin), kod va jurnallar ingliz |
| Hujjatlar | OpenAPI avtomatik, README, ma'lumotlar lug'ati, deploy yo'riqnomasi |
