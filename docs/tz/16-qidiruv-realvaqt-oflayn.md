# Global qidiruv, real vaqt va oflayn rejim

> Manba: `frontend/docs/BACKEND_TZ.md` v1.3. Bo'lim raqamlari asl TZ dagidek qoldirilgan.

Ctrl+K qidiruvi, WebSocket/SSE hodisalari va oflayn sinxronizatsiya (ixtiyoriy bosqich).

**Bog'liq qismlar:** [Kassa va sotuv](09-kassa-sotuv.md)

---

### 9.13. Global qidiruv
`GET /search?q=&limit=` (autentifikatsiyalangan) — frontenddagi Ctrl+K oynasi uchun. Javob guruhlangan: `products` (faqat `view_pos` bo'lsa, joriy filial omboridan, 6 tagacha: nom, SKU, shtrix-kod, variant bo'yicha), `customers` (faqat `view_debts` bo'lsa, 5 tagacha: nom yoki telefon bo'yicha). Sahifalar ro'yxati frontendda qoladi. Ixtiyoriy: frontend buni `/products` va `/customers` ga ikki so'rov bilan ham qila oladi.

### 9.11. Real vaqt
WebSocket/SSE `GET /events`: `stock.changed {productId, variantId, stock}`, `shift.changed`, `settings.changed`, `sale.created`. Frontend shu bo'yicha ro'yxatlarni yangilaydi. Kanal autentifikatsiyalangan, huquqga mos hodisalar yuboriladi.

## 10. Oflayn rejim va sinxronizatsiya

**Holat:** hozir 1 ta kassa va internet kam uziladi, shuning uchun oflayn rejim **MVP dan keyingi ixtiyoriy bosqich** (17-bo'lim). API boshidan oflayn uchun tayyor (idempotentlik, `clientId`). Quyida talab qilinsa bajariladigan mexanizm.

Kassa internet uzilganda ham sotishi mumkin bo'lishi uchun:

- Frontend oflayn sotuvlarni mahalliy navbatga (IndexedDB) saqlaydi. Har sotuvga o'z `clientId` (UUID) beradi.
- Aloqa tiklanganda navbat tartib bilan `POST /sales` ga yuboriladi (har biri uchun `Idempotency-Key = clientId`). Server `client_id` bo'yicha takrorni aniqlaydi (takror yaratmaydi).
- **Narx siyosati (tasdiqlanishi kerak):** oflayn sotuvda mijozga chekda ko'rsatilgan narx saqlanadi. Shuning uchun `POST /sales` da ixtiyoriy `offline: true` va `clientUnitPrices` qabul qilinadi. Server bu narxlarni faqat farq ruxsat etilgan chegarada bo'lsa (sozlama, standart 0%) o'zgartirmay qabul qiladi, aks holda sotuvni `needs_review` holatida yozadi va administrator ko'rib chiqadi.
- Qoldiq yetmasligi oflayn sotuvni rad etmaydi (haqiqiy sotuv allaqachon bo'lgan): qoldiq manfiyga ketishi mumkin va `needs_review` belgisi qo'yiladi, administratorga bildirishnoma.
- Katalog (mahsulotlar, narxlar, sozlamalar) oflayn uchun mahalliy keshlanadi, `GET /sync/catalog?since=<version>` o'zgarishlarni qaytaradi (`updatedAt`/`version` bo'yicha).
- Konflikt qoidasi: pul va qoldiq o'zgartiruvchi amallar serverda tartib bilan qo'llanadi (last-write-wins faqat sozlamalarda, versiya tekshiruvi bilan).
- Oflayn rejim **Bosqich 3** da; MVP da frontend onlayn ishlaydi, lekin API (idempotentlik, `clientId`) boshidan shunga tayyor qilinadi.

### 7.10. Indekslar (minimal)
`products(category_id)`, `products(lower(name))` trigram (`pg_trgm`) qidiruv uchun, `product_variants(product_id)`, `product_barcodes(barcode)` unikal, `sales(created_at desc)`, `sales(shift_id)`, `sales(customer_id)`, `sale_lines(product_id)`, `sale_lines(sale_id)`, `stock_levels(branch_id, product_id, variant_id)` unikal, `stock_movements(branch_id, product_id, created_at desc)`, `debt_ledger(customer_id, created_at desc)`, `audit_logs` yuqoridagi.
