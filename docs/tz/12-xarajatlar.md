# Xarajatlar va sof foyda

> Manba: `frontend/docs/BACKEND_TZ.md` v1.3. Bo'lim raqamlari asl TZ dagidek qoldirilgan.

Xarajat kategoriyalari, xarajat yozuvlari, kassadan chiqim, foyda va zarar hisoboti.

**Bog'liq qismlar:** [Smena va Z-hisobot](10-smena.md), [Hisobotlar](13-hisobotlar.md)

---

### 7.11. Xarajatlar (chiqimlar) va sof foyda

Tizimning asosiy maqsadlaridan biri: do'kon egasi **daromad va chiqimlarni** yuritadi. Tovar tannarxi (kirim) alohida hisoblanadi; bu yerda tovarga kirmaydigan **operatsion xarajatlar**.

**`expense_categories`** — `id`, `name` (unikal), `active`, `sort_order`. Boshlang'ich: Ijara, Ish haqi, Transport va yetkazib berish, Kommunal (elektr, suv, gaz, internet), Reklama, Ta'mirlash, Soliq va yig'imlar (ichki yozuv), Boshqa. Egasi o'zi qo'shadi.
**`expenses`** — `id`, `branch_id`, `date`, `category_id`, `amount bigint > 0`, `method_id` (to'lov usuli), `source` (`cash_register`: kassadan chiqarilgan pul | `other`: boshqa manba), `shift_id null` (kassadan chiqim bo'lsa joriy smena), `supplier_id null`, `note`, `created_by`, `voided_at null`.

Qoidalar:
- `source = cash_register` bo'lsa smena ochiq bo'lishi shart; smenadagi **kutilgan naqd pul** kamayadi (Z-hisobotda alohida qator: "Kassadan chiqim").
- Xarajatni o'chirish yumshoq (`voided_at`) va auditga yoziladi.
- **Sof foyda** = yalpi foyda (Σ chek foydasi, 8.7) − Σ xarajatlar (davr bo'yicha). Hisobot `view_expenses` va `view_cost_price` huquqini talab qiladi.
- **Foyda va zarar (P&L)** hisoboti: tushum, tannarx, yalpi foyda, xarajatlar kategoriya bo'yicha, sof foyda. Kassa oqimi: kirim (to'lovlar) va chiqim (xarajatlar, kirim uchun to'lovlar) usullar bo'yicha.
- Yetkazib beruvchiga to'lov (kreditor qarz): ochiq savol (23-bo'lim). Kerak bo'lsa `supplier_payments` jadvali keyin qo'shiladi.

### 9.12. Xarajatlar (chiqimlar)
| Metod | Yo'l | Perm |
|---|---|---|
| GET | `/expense-categories` | `view_expenses` |
| POST/PATCH/DELETE | `/expense-categories`, `/expense-categories/:id` | `manage_settings` |
| GET | `/expenses?from=&to=&categoryId=&source=&branchId=` | `view_expenses` |
| POST | `/expenses` `{date, categoryId, amount, methodId, source, note, supplierId?}` + `Idempotency-Key` | `manage_expenses` |
| PATCH | `/expenses/:id` | `manage_expenses` |
| POST | `/expenses/:id/void` | `manage_expenses` |
| GET | `/reports/profit-loss?from=&to=&branchId=` | `view_expenses` + `view_cost_price` |
| GET | `/reports/cash-flow?from=&to=&branchId=` | `view_expenses` |
