# Bosqichlar, integratsiyalar va ochiq savollar

> Manba: `frontend/docs/BACKEND_TZ.md` v1.3. Bo'lim raqamlari asl TZ dagidek qoldirilgan.

Ish bosqichlari va muddatlar, keyingi integratsiyalar, xavflar, mijoz javoblari, hali javob kutilayotgan savollar, frontend bilan solishtirish natijasi.

---

## 17. Bosqichlar va muddatlar (taxminiy, 1–2 backend dasturchi + 1 QA)

| Bosqich | Mazmuni | Muddat |
|---|---|---|
| 0. Tayyorgarlik | Repo, CI, docker-compose, DB sxema asosi, OpenAPI skeleti, auth | 1 hafta |
| 1. Asos | Auth, xodimlar/rollar/huquqlar, **filiallar (bitta `main` bilan)**, sozlamalar, audit | 2 hafta |
| 2. Katalog va ombor | Mahsulotlar (universal model, variantlar, shtrix-kod), kirim, qoldiq jurnali, import/eksport | 2.5 hafta |
| 3. Sotuv | `quote`, `sales`, kesim, chegirma, QQS, **dinamik to'lov usullari va aralash to'lov**, smena, Z-hisobot, storno, chek (kichik va A4) | 3.5 hafta |
| 4. Mijozlar va nasiya | Mijozlar, limit, qarz to'lovi, ledger | 1.5 hafta |
| 5. Hisobotlar va xarajatlar | Dashboard, kunlik/kategoriya/to'lov, kam qoldiq, qarzdorlar, eksport, **xarajatlar, foyda-zarar, kassa oqimi** | 2.5 hafta |
| 6. Frontend integratsiyasi | API ga ulash, tiplar generatsiyasi, migratsiya (import), real vaqt | 2 hafta |
| 7. Oflayn rejim *(ixtiyoriy, talab bo'lsa)* | IndexedDB navbat, sinxronizatsiya, konflikt | 2 hafta |
| 8. Barqarorlashtirish | Yuklama va xavfsizlik sinovi, monitoring, zaxira, hujjatlar, ishga tushirish | 1.5 hafta |
| **Jami** | | **≈ 18.5 hafta** (oflayn rejimsiz ≈ 16.5) |

MVP (bosqich 0–6) — **≈ 15 hafta**. Keyingi bosqichlar (to'lov tizimlari integratsiyasi, SMS, filiallararo ko'chirish) alohida baholanadi.

## 12. Integratsiyalar (keyingi bosqichlar, interfeyslar oldindan belgilanadi)

| Integratsiya | Maqsad | Izoh |
|---|---|---|
| To'lov tizimlari (Click, Payme, Uzcard/Humo terminali) | Karta/QR orqali to'lovni tasdiqlash | `payments` jadvali: `provider`, `external_id`, `status`. Webhook endpointlar imzo bilan |
| SMS provayder | Qarz eslatmasi, muddat | Fon vazifa (BullMQ), shablonlar |
| Telegram bot | Kunlik hisobot egasiga | Cron + shablon |
| Shtrix-kod printer/tarozi | Yorliq chop etish, tarozi | Frontend/lokal agent, backend faqat shablon va kodlarni beradi |

## 19. Xavflar va ochiq savollar

| # | Savol/Xavf | Taklif |
|---|---|---|
| 1 | ~~Fiskal chek~~ | **Hal qilindi:** kerak emas, tizim ichki hisob uchun |
| 2 | Filiallar | **Qaror qabul qilindi:** kelajakda filial bo'ladi. Sxema boshidan ko'p filialli (7.0-band), MVP da bitta filial. Qolgan savollar Ilova D da |
| 3 | Oflayn sotuvda narx farqi va manfiy qoldiq siyosati | 10-bo'limdagi qaror tasdiqlanishi kerak |
| 4 | Sotuvni qaytarish (vozvrat) jarayoni | MVP da faqat storno; qismiy qaytarish talabini aniqlash |
| 5 | Mahsulot rasmlari kerakmi | Kerak bo'lsa MinIO va yuklash endpointi (Bosqich 2 ga qo'shiladi) |
| 6 | Tannarx usuli (o'rtacha vs FIFO) | O'rtacha tannarx qabul qilingan; FIFO kerak bo'lsa partiyalar jadvali qo'shiladi |
| 7 | Parol siyosati va 2FA | Admin uchun 2FA (TOTP) ni Bosqich 8 ga qo'shish mumkin |
| 8 | Hosting va ma'lumotlarni saqlash joyi bo'yicha qonuniy talablar | 4.5-bandagi tavsiya (O'zbekistondagi data-markazda VPS); mijoz ismi/telefoni uchun mamlakat ichida saqlash talabini yurist bilan tekshirish |
| 9 | Valyuta | **Hal qilindi:** faqat so'm |
| 10 | Chek chop etish (Xprinter, kichik chek + A4) | 12.1-band. MVP: brauzer orqali; jim chop etish va tortma uchun lokal agent keyin |
| 11 | Mahsulotlar soni noma'lum, lekin ko'p (minglab bo'lishi mumkin) | Ro'yxatlar sahifalanadi, server tomonida qidiruv, ommaviy import (Excel) shabloni va oldindan ko'rish, kerak bo'lsa 50 000 mahsulotgacha sinov |

## 22. Ilova C. Hujjatlar ro'yxati (topshirishda)
OpenAPI fayli, ER-diagramma, ma'lumotlar lug'ati, deploy va zaxira yo'riqnomasi, huquqlar matritsasi, import yo'riqnomasi, test hisoboti, ma'lum cheklovlar ro'yxati.

## 23. Ilova D. Mijoz javoblari (2026-10-13) va ochiq savollar

### 23.1. Qabul qilingan qarorlar

| # | Mavzu | Javob | TZ ga ta'siri |
|---|---|---|---|
| 1 | Filiallar soni | Aniq emas, kelajakda qo'shilishi mumkin | Sxema ko'p filialli (7.0), MVP da bitta filial |
| 2 | Ombor | Har filialning alohida ombori | `stock_levels` filial bo'yicha |
| 3 | Sotish narxi | Filiallarda farq qilishi mumkin | `branch_prices` MVP ga kiritildi (7.3, 8.1) |
| 4 | Mijoz va qarz | Umumiy | Mijoz va qarz umumiy, to'lov filial kassasiga tushadi |
| 5 | Egasi | Ikkala filial xodimlarini ham ko'rishi kerak | "Egasi" roli, `all_branches`, `?branchId=all` |
| 6 | Soliq/fiskal chek | Kerak emas, ichki hisob uchun | Doiradan chiqarildi; chekda "Ichki hisob cheki" |
| 7 | To'lov turlari | Dinamik bo'lishi kerak, egasi o'zi qo'shadi | `payment_methods` dinamik, `kind` bilan (7.2); aralash to'lov alohida mavzu, pastda |
| 8 | Chegirma | Kassir bera oladi, summa kiritiladi | 8.3; ixtiyoriy yuqori chegara sozlamasi |
| 9 | Vozvrat | Hozircha yo'q | Faqat to'liq bekor qilish (7.9) |
| 10 | Valyuta | Faqat so'm | Doirada |
| 12 | Hajm | Mahsulotlar ko'p (soni noma'lum), mijozlar Excelda yo'q | Ommaviy import (mahsulotlar), sahifalash va qidiruv talabi |
| 13 | Kassa/internet/server | 1 kassa, internet barqaror, server tanlanmagan | Oflayn ixtiyoriy; hosting tavsiyasi 4.5 |
| 14 | Printer | Xprinter, kichik chek va A4 | 12.1 |
| 15 | Til | Hozircha faqat o'zbek | Doirada |
| 16 | Admin darajalari (2026-10-24) | Eng katta admin uchun alohida panel; filial boshqaruvi uchun alohida admin, ular faqat o'zlariga kerakli narsani ko'rsin | **Bosh admin** (`manage_branches`, `all_branches`) va **Filial admini** (filial doirasi), 3.1, 3.3 (8–9), 8.12 |
| 17 | Yangi tovar kelishi (2026-10-24) | Katalogda faqat asosiy mahsulotlar; tovar kelganda admin ro'yxatdan tanlab, miqdorini yozadi, nom/o'lchamni qayta yozmaydi | Katalog umumiy, kirim filial bo'yicha (7.0.1); narxsiz mahsulot ruxsat (14.4 (5)) |

Qo'shimcha: **loyihaning maqsadi** o'z omborini, daromad va chiqimlarini hisoblash ekani aniqlandi, shuning uchun TZ ga **xarajatlar moduli va sof foyda** qo'shildi (7.11, 9.12).

### 23.2. Hali javob kerak bo'lgan savollar

1. **Aralash to'lov** (bir chekda qisman naqd, qisman karta yoki Click): kerakmi? *Dinamik to'lov usullari bilan bir narsa emas: usullar ro'yxati qanday usullar borligini belgilaydi, aralash to'lov esa bitta chekni bir nechta usul bilan to'lash imkonidir. Backend uchun qo'shish arzon, shuning uchun TZ ga kiritilgan; kerak bo'lmasa chiqarib tashlaymiz.*
2. **Tannarx**: tovar har safar turli narxda keladi (masalan sement 56 000, keyin 60 000). *O'rtacha tannarx* bularni aralashtirib o'rtachasini oladi (oddiy, tavsiya). *FIFO* birinchi kirgan partiya narxidan sotadi (aniqroq, murakkabroq). Qaysi biri kerak?
3. **Yetkazib beruvchilarga qarz**: tovarni ba'zan nasiyaga olasizmi? Agar shunday bo'lsa, kimga qancha qarzingiz borligini ham yuritamiz (kreditor qarz).
4. **Xarajatlar kategoriyalari**: yuqoridagi ro'yxat (ijara, ish haqi, transport, kommunal, reklama, ta'mirlash, boshqa) yetarlimi? Kassadan chiqim (kassadan pul olib xarajat qilish) bo'ladimi?
5. **Mahsulotlar importi**: Excel/CSV da qanday ustunlar bor (nomi, narxi, qoldig'i, birligi, shtrix-kod)? Namuna fayl bersangiz import shablonini unga moslaymiz.
6. **Qo'shimcha rollar**: Egasi, Super Admin, Kassir, Omborchi, Buxgalter yetarlimi? Menejer yoki boshqa lavozim kerakmi?
7. **Mahsulot rasmi** kerakmi?
8. **SMS yoki Telegram** orqali mijozga qarz eslatmasi, egasiga kunlik hisobot kerakmi?
9. **Chek kengligi**: Xprinter modeli 58 mm mi yoki 80 mm mi? A4 hujjatda "so'z bilan summa" yozilishi kerakmi?
10. **Server**: 4.5-bandagi variantlardan qaysi biri yoqadi? Byudjet taxminan qanday?

## 24. Ilova E. Frontend bilan solishtirish natijasi (1.3, 2026-10-24)

Frontend kodi (`src/store.ts`, `src/types.ts`, `src/lib/units.ts`, barcha sahifa va oynalar) TZ bilan qatorma-qator solishtirildi. Frontendda bor, lekin TZ da yo'q yoki noaniq bo'lgan narsalar tegishli bo'limlarga qo'shildi:

| # | Nima | Qayerga qo'shildi |
|---|---|---|
| 1 | O'z profilini tahrirlash, o'z rolini o'zgartirganda huquqlar o'zgarmasligi, filial admini o'z filialini o'zgartira olmasligi | 3.3 (3) |
| 2 | Filial kodi formada yo'q: server nomdan avtomatik yasaydi, kod o'zgarmaydi | 7.0, 9.0 |
| 3 | Login formati, email ixtiyoriyligi, rol — huquq shabloni, rol almashganda `resetPermissionsToRole` | 7.1, 9.2 |
| 4 | Chek formati (`print_format`), termo qog'oz kengligi (`paper_width_mm`), STIR, filial va umumiy rekvizitlar qaysi biri ishlatilishi | 7.2 `store_settings` |
| 5 | To'lov usuli turini o'zgartirish cheklovi, `debt` turi faqat tizimda, nom unikalligi | 7.2 `payment_methods` |
| 6 | Sozlamalar cheklovlari: oxirgi kategoriya/guruhni o'chirmaslik, kategoriya bilan andozalar o'chishi, birlik kodi o'zgarmasligi, `short` unikalligi va h.k. | 7.2 |
| 7 | Avtomatik SKU va variant SKU, shtrix-kodlarni ajratish, kategoriya shabloni, metrli tovar yordamchilari | 7.3 |
| 8 | Variantni olib tashlash (qoldig'i bo'lsa `409`), katalog formasida qoldiq yo'qligi, min. qoldiq va tannarx filialga yozilishi, ulgurji narx kassada ishlatilmasligi | 7.3, 9.5 `PATCH /stock-levels/:id` |
| 9 | Mijoz: telefon formati, yangi mijoz standart qiymatlari, muddatni qo'lda o'zgartirish, limitni qarzdan kichik qilish, ro'yxat tartibi | 7.5 |
| 10 | Smena jamlarida `other` va `byMethod`, nasiya chekidagi oldindan to'lov | 7.7 |
| 11 | Qo'shimcha audit amal kodlari va frontend bilan moslik | 7.8 |
| 12 | Kirishdagi standart filial | 8.12 (1) |
| 13 | Bosh admin sahifasi: jami qatori, bugungi cheklar soni, savdo `total_amount` bo'yicha | 9.0 |
| 14 | Sozlamalarni standartga qaytarishda ishlatilayotgan yozuvlar saqlanishi | 9.3 |
| 15 | Mahsulot ro'yxati: filial ombori bo'yicha filtr, kirim uchun "omborda bor/yo'q" belgisi, variant orqali qidiruv, kategoriya sonlari | 9.4 |
| 16 | Kirim qoidalari (tannarx 0 = o'zgarmaydi, erkin matnli yetkazib beruvchi) | 9.5 |
| 17 | Dashboard javobining to'liq tarkibi (kechaga taqqoslash, 7 kun, kategoriya ulushi, to'lov usullari, kam qoldiq) | 9.9 |
| 18 | Audit: qidiruv maydonlari, amal turlari bo'yicha sonlar, sahifalash | 9.10 |
| 19 | Global qidiruv (Ctrl+K) | 9.13 |
| 20 | Moslik jadvali: to'lov usuli maydonlari → `sale_payments`, smena jamlari, chek sozlamalari | 14.3 |
| 21 | Yangi farqlar: min. qoldiq/tannarx, eksport tugmasi yo'qligi, audit kodlari, soxta email, aralash to'lov UI, sotuvlar sahifasi | 14.4 (9–14) |

Frontendga xos va backendga **tegishli bo'lmagan** narsalar (TZ ga kiritilmadi): mavzu (yorug'/qorong'i), yon panel holati, klaviatura tugmalari (F1–F8, F12, Ctrl+K), hash-marshrutlash, savatni brauzerda ushlab turish, filial almashtirishda savat bo'sh bo'lishi talabi, toast xabarlar.
