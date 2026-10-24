# Temir Baza ERP/POS — Backend TZ (qismlarga bo'lingan)

Bu papka `frontend/docs/BACKEND_TZ.md` (v1.3) ning mavzular bo'yicha bo'lingan nusxasi. Har bir fayl bitta modulni to'liq qamraydi: jadvallar, biznes qoidalari va API. Backendni modulma-modul qurishda kerakli faylni olib ishlaysiz, butun TZ ni har safar o'qish shart emas.

Bo'lim raqamlari (7.3, 8.6, 9.4 ...) asl TZ dagidek qoldirilgan, shuning uchun matndagi "7.0.1 ga qarang" kabi havolalar ishlaydi: kerakli raqamni pastdagi jadvaldan topasiz.

**Asl manba:** `frontend/docs/BACKEND_TZ.md`. TZ o'zgarsa avval o'sha fayl yangilanadi, keyin bu qismlar qayta yasaladi (bo'lish skripti sarlavhalar bo'yicha kesadi, matnni o'zgartirmaydi).

## Qismlar

| Fayl | Mavzu | Asl bo'limlar |
|---|---|---|
| [01-umumiy.md](01-umumiy.md) | Maqsad, doira, arxitektura, server, nofunksional talablar | 1, 2, 4, 13 |
| [02-api-konvensiyalar.md](02-api-konvensiyalar.md) | API konvensiyalari, xato formati, umumiy jadval maydonlari, o'chirish qoidalari | 5, 7 (kirish), 8 (kirish), 8.11, 9 (kirish) |
| [03-auth-xavfsizlik.md](03-auth-xavfsizlik.md) | Login, tokenlar, sessiyalar, parollar, xavfsizlik | 6, 9.1 |
| [04-xodimlar-rollar.md](04-xodimlar-rollar.md) | Rollar, huquqlar, server qoidalari, xodimlar API | 3, 7.1, 9.2 |
| [05-filiallar.md](05-filiallar.md) | Filiallar, umumiy va filialga tegishli ma'lumot, Bosh admin | 7.0, 7.0.1, 8.12, 9.0 |
| [06-sozlamalar.md](06-sozlamalar.md) | Do'kon, birliklar, kategoriyalar, to'lov usullari, biznes qoidalari | 7.2, 9.3 |
| [07-katalog.md](07-katalog.md) | Mahsulot, variant, konversiya, shtrix-kod, narx hisobi | 7.3, 8.1, 9.4, 21 |
| [08-ombor.md](08-ombor.md) | Qoldiq, kirim, o'rtacha tannarx, qoldiq jurnali | 7.4, 8.5, 8.6, 9.5 |
| [09-kassa-sotuv.md](09-kassa-sotuv.md) | Chek, kesim, chegirma, QQS, foyda, to'lov va nasiya, storno, `POST /sales` | 7.6, 7.9, 8.2–8.4, 8.7, 8.8, 9.6, 20 |
| [10-smena.md](10-smena.md) | Smena va Z-hisobot | 7.7, 8.9, 9.7 |
| [11-mijozlar-nasiya.md](11-mijozlar-nasiya.md) | Mijozlar, qarz jurnali, qarz to'lovi | 7.5, 9.8 |
| [12-xarajatlar.md](12-xarajatlar.md) | Xarajatlar, foyda va zarar | 7.11, 9.12 |
| [13-hisobotlar.md](13-hisobotlar.md) | Dashboard va hisobotlar | 8.10, 9.9 |
| [14-audit.md](14-audit.md) | Audit jurnali | 7.8, 9.10, 11 |
| [15-chek-chop-etish.md](15-chek-chop-etish.md) | Termo chek va A4 hujjat | 12.1 |
| [16-qidiruv-realvaqt-oflayn.md](16-qidiruv-realvaqt-oflayn.md) | Global qidiruv, real vaqt, oflayn rejim, indekslar | 7.10, 9.11, 9.13, 10 |
| [17-frontend-integratsiya.md](17-frontend-integratsiya.md) | Frontendga ulash, import, moslik jadvali, farqlar, seed | 14, 15 |
| [18-test-qabul.md](18-test-qabul.md) | Test strategiyasi, qabul mezonlari | 16, 18 |
| [19-bosqichlar-savollar.md](19-bosqichlar-savollar.md) | Bosqichlar, integratsiyalar, xavflar, mijoz javoblari, ochiq savollar | 12, 17, 19, 22, 23, 24 |

## Qurish tartibi (tavsiya)

Har bir qadamda **01** va **02** fayllar doim yonida turadi. Test talablari (**18**) har bir qadam bilan birga yoziladi, oxirida emas.

| Qadam | Nima quriladi | Fayllar | TZ bosqichi (17-bo'lim) |
|---|---|---|---|
| 0 | Loyiha skeleti: NestJS, PostgreSQL, Redis, docker-compose, migratsiyalar, OpenAPI, xato formati, `requestId`, idempotentlik middleware | 01, 02 | 0 |
| 1 | Auth: login, refresh, logout, sessiyalar, parol hash, rate limit | 03 | 0–1 |
| 2 | Filiallar va filial konteksti (`X-Branch-Id`), seed da bitta `main` filial | 05 | 1 |
| 3 | Xodimlar, rollar, huquqlar matritsasi, filial admini cheklovlari | 04 | 1 |
| 4 | Audit jurnali (keyingi barcha modullar shunga yozadi) | 14 | 1 |
| 5 | Sozlamalar va lug'atlar, `in_use` tekshiruvlari | 06 | 1 |
| 6 | Mahsulotlar katalogi, variantlar, konversiyalar, narx hisobi, import | 07 | 2 |
| 7 | Ombor: `stock_levels`, kirim, qoldiq jurnali, o'rtacha tannarx, tuzatish | 08 | 2 |
| 8 | Mijozlar va qarz jurnali (sotuvdagi nasiyadan oldin kerak) | 11 | 4 |
| 9 | Smena | 10 | 3 |
| 10 | Kassa: `quote`, `sales`, kesim, chegirma, aralash to'lov, nasiya, storno | 09 | 3 |
| 11 | Chek shablonlari (termo va A4) | 15 | 3 |
| 12 | Xarajatlar, foyda va zarar | 12 | 5 |
| 13 | Hisobotlar va dashboard | 13 | 5 |
| 14 | Global qidiruv va real vaqt hodisalari | 16 | 6 |
| 15 | Frontendni ulash va brauzer ma'lumotini import qilish | 17 | 6 |
| 16 | Oflayn rejim (ixtiyoriy) | 16 | 7 |
| 17 | Yuklama va xavfsizlik testlari, monitoring, zaxira, ishga tushirish | 18, 01 (4.5, 13) | 8 |

Asl TZ da mijozlar (bosqich 4) sotuvdan (bosqich 3) keyin turadi. Bu yerda ular oldinga olindi, chunki `POST /sales` nasiya qismi `customers` va `debt_ledger` jadvallarisiz ishlamaydi.

## Ochiq savollar

Backendni boshlashdan oldin javob kerak bo'lgan savollar [19-bosqichlar-savollar.md](19-bosqichlar-savollar.md) faylidagi 23.2-bo'limda. Eng muhimlari:

- aralash to'lov kerakmi;
- tannarx o'rtacha bo'yicha hisoblanadimi yoki FIFO bo'yicha;
- yetkazib beruvchilarga qarz yuritiladimi;
- server variantlaridan qaysi biri tanlanadi.
