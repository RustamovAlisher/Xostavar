# Frontendga ulash, migratsiya va seed

> Manba: `frontend/docs/BACKEND_TZ.md` v1.3. Bo'lim raqamlari asl TZ dagidek qoldirilgan.

Frontend o'zgarishlari, brauzerdagi ma'lumotni import qilish, maydonlar moslik jadvali, frontend bilan ma'lum farqlar, boshlang'ich ma'lumotlar.

---

## 14. Frontendni backendga ulash va migratsiya

### 14.1. Frontend o'zgarishlari (qisqacha)
- `src/store.ts` dagi biznes amallar API chaqiruvlariga almashtiriladi; hisob funksiyalari (`calcLine`, `units.ts`) faqat **oldindan ko'rish** uchun qoladi, haqiqiy summa `POST /sales/quote` va `POST /sales` javobidan olinadi.
- Login: API `/auth/login`; `crypto` hash kodi (`hashPassword`) olib tashlanadi.
- Ma'lumotlarni olish uchun so'rovlar keshi (TanStack Query) tavsiya etiladi; `persist` faqat sozlama/qoralama va oflayn navbat uchun qoladi.
- Frontend `types.ts` dan OpenAPI → TypeScript tiplari generatsiya qilinadi (tiplar mosligini kafolatlash).

### 14.2. Mavjud ma'lumotlarni ko'chirish
Hozirgi brauzer ma'lumoti (mahsulotlar, mijozlar, tranzaksiyalar, sozlamalar) bir martalik ko'chiriladi:
1. Frontendda "Ma'lumotlarni eksport qilish" tugmasi `localStorage` dagi `temir-baza-pos-v2` ni JSON fayl qiladi (v3 shakli, `src/lib/migrate.ts` bilan mos).
2. Backend `POST /admin/import` (faqat `manage_users`, bir martalik, yangi bo'sh bazaga) JSON ni tekshirib tranzaksiyada yuklaydi: sozlamalar → mahsulotlar → mijozlar → tarixiy cheklar → kirimlar → audit.
2a. **Filial ma'lumoti (1.2):** eksport faylida `branches`, `stockByBranch` (`{branchId: {"productId|variantId": qty}}`), `shifts` (`{branchId: ShiftState}`), `activeBranchId`, hamda `Transaction/StockInRecord/ShiftRecord/AuditLog.branchId` bo'ladi. Filialsiz (eski) eksportda hamma narsa bitta `main` filialga yuklanadi. `stockByBranch` → `stock_levels`, yozuvda `branchId` bo'sh bo'lsa `main`. `SystemUser.branchId` (bo'sh = barcha filiallar) → `user_branches` / `all_branches`.
3. Eski ochiq parollar/hashlar import qilinmaydi: foydalanuvchilar uchun vaqtinchalik parol beriladi, `must_change_password = true`.
4. Import hisoboti: nechta yozuv yuklandi, nechtasi rad etildi va sababi.

### 14.3. Maydon moslik jadvali (asosiylari)
| Frontend (`types.ts`) | Backend |
|---|---|
| `Product.categoryId` | `products.category_id` |
| `Product.baseUnit`, `conversions[]` | `products.base_unit`, `unit_conversions` |
| `Product.stock`, `minStock`, `costPrice`, `ProductVariant.stock/minStock/costPrice` | `stock_levels` (tanlangan filial uchun) |
| `ProductVariant.*` | `product_variants` + variantga xos `unit_conversions` |
| `CartItem` | faqat so'rovda (serverda saqlanmaydi, `quote`/`sales` orqali) |
| `Transaction` (`lines`) | `sales` + `sale_lines` |
| `Transaction.paymentMethod`, `downPaymentMethod`, `paidAmount` | `sale_payments`: oddiy chekda bitta qator (`paymentMethod`, `paidAmount`); nasiya chekida `paidAmount > 0` bo'lsa bitta qator (`downPaymentMethod`, `paidAmount`), qolgani `remaining_debt`. `payment_summary` shundan hosil qilinadi |
| `ShiftTotals.byMethod`, `other` | `shifts.totals.byMethod`, `other` |
| `StoreInfo.printFormat`, `paperWidthMm` | `store_settings.print_format`, `paper_width_mm` |
| `CustomerDebt.role` (guruh nomi) | `customers.group_id` (id bo'yicha) |
| `SystemUser.role` (nom) | `users.role_id` |
| `ShiftState/ShiftRecord` | `shifts` (filial bo'yicha); frontendda `shifts: Record<branchId, ShiftState>` |
| `Branch` | `branches` |
| `StockMap` (`stockByBranch[branchId]["productId|variantId"]`) | `stock_levels` (`branch_id`, `product_id`, `variant_id`, `stock`) |
| `SystemUser.branchId` (bo'sh = barcha filiallar) | `user_branches` / `roles.all_branches` |
| `Transaction.branchId`, `StockInRecord.branchId`, `ShiftRecord.branchId`, `AuditLog.branchId` | tegishli jadvallarda `branch_id` |
| `Permission.manage_branches` | `manage_branches` (3.2) |
| `settings.store.*` | `branches` (nom, manzil, telefon, chek matni — filial bo'yicha) |
| `AuditLog` | `audit_logs` |
| `AppSettings.*` | yuqoridagi sozlama jadvallari |

### 14.4. Frontend 1.2 bilan ma'lum farqlar (qaror kerak)

| # | Mavzu | Frontend hozir | Backend (TZ) | Taklif |
|---|---|---|---|---|
| 1 | O'rtacha tannarx | Bitta (katalogda), butun kompaniya qoldig'i bo'yicha hisoblanadi | Filial bo'yicha (`stock_levels.cost_price`) | Backendniki to'g'ri; kirim filialga yoziladi. Frontend API ga o'tganda shunga moslanadi |
| 2 | Sotish narxi | Hamma filialda bir xil | `branch_prices` (filialda farq qilishi mumkin, MVP) | Frontendda filial narxi UI yo'q — keyin qo'shiladi. Filial admini narxni baribir o'zgartira olmaydi |
| 3 | Xodim va filial | Bitta `branchId` yoki hammasi | `user_branches` (ko'p-ko'p) | Backend ko'proq imkon beradi; UI hozircha bitta filial |
| 4 | Rol nomi | Egasi = "Super Admin" | "Egasi" (`all_branches`) | Seed da ikkalasi bir rolga moslanadi |
| 5 | Mahsulot yaratishda narx | Sotish narxi > 0 majburiy | `retail_price` bo'sh bo'lishi mumkin (narxsiz = sotilmaydi) | Katalogni "faqat asosiy ma'lumot" bilan yuritish uchun backend narxsiz mahsulotni qabul qiladi; frontend keyinroq moslanadi |
| 6 | Chek raqami | `R-<vaqt>` (brauzerda) | Server tomonidan `MAIN-20261013-0001` | Server raqami haqiqat manbai |
| 7 | Filial almashtirish | Savat bo'sh bo'lishi shart (frontend bloklaydi) | Serverda savat yo'q | Server uchun ahamiyatsiz; chek bir filialda tuziladi (8.12 (3)) |
| 8 | Parol | Brauzerda SHA-256 + salt | Argon2id/bcrypt, serverda | 6.2; eski hashlar import qilinmaydi (14.2) |
| 9 | Min. qoldiq va tannarx | Katalog formasida, mahsulotning o'zida (umumiy) | `stock_levels` da filial bo'yicha | Katalog formasidagi qiymat joriy filialga yoziladi (`PATCH /stock-levels/:id`, 7.3). Frontend API ga o'tganda maydon izohi "joriy filial uchun" bo'ladi |
| 10 | Ma'lumot eksporti | "Ma'lumotlarni eksport qilish" tugmasi **hali yo'q** | 14.2 shu faylni kutadi | Migratsiyadan oldin frontendga eksport tugmasi qo'shiladi (`localStorage["temir-baza-pos-v2"]` → JSON) |
| 11 | Audit amal kodlari | Smena yopilishi `edit`, sozlamalar `edit` | Alohida kodlar (`shift_close`, `settings_reset`...) | 7.8; frontend noma'lum kodni "Boshqa" sifatida ko'rsatadi |
| 12 | Xodim emaili | Bo'sh bo'lsa `username@temirbaza.uz` yasaladi | `null` | Backend soxta email yaratmaydi |
| 13 | Aralash to'lov | Chekda bitta usul; nasiyada bitta oldindan to'lov usuli | `payments[]` (bir nechta usul) | API to'liq; frontend keyin aralash to'lov UI ni qo'shadi |
| 14 | Sotuvlar ro'yxati | Alohida sahifa yo'q (faqat oxirgi chek va mijoz tarixi) | `GET /sales` | Endpoint MVP da bor, UI keyin |

## 15. Seed (boshlang'ich ma'lumotlar)

`local`/`staging` uchun: 4 ta demo foydalanuvchi (`admin`, `kassir`, `omborchi`, `buxgalter`; parol `1234`, `must_change_password = true`), standart birliklar, kategoriyalar, o'lcham andozalari, guruhlar, to'lov usullari, standart biznes qoidalari (`src/data.ts` dagi `defaultSettings`), namuna mahsulotlar (armatura, truba, mix, list, sement, samorez, disk, bolgarka, bo'yoq, kafel) va mijozlar. `production` da faqat lug'atlar va bitta birinchi administrator (o'rnatish paytida parol so'raladi).
