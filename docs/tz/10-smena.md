# Smena va Z-hisobot

> Manba: `frontend/docs/BACKEND_TZ.md` v1.3. Bo'lim raqamlari asl TZ dagidek qoldirilgan.

Smenani ochish va yopish, bitta ochiq smena qoidasi, muzlatilgan jamlar, smena API.

**Bog'liq qismlar:** [Kassa va sotuv](09-kassa-sotuv.md)

---

### 7.7. Smena

**`shifts`**: `id`, `branch_id`, `opened_by`, `opened_at`, `closed_by null`, `closed_at null`, `opening_cash bigint default 0`, `closing_cash_counted bigint null`, `totals jsonb` (yopilganda muzlatiladi: `cash`, `card`, `transfer`, `other` (maxsus usullar, `kind = other`), `byMethod` (`{methodId: summa}` — Z-hisobotda har usul alohida qatorda), `nasiyaDebt`, `debtPayments`, `receipts`, `revenue`). Nasiya chekida kassaga tushgan oldindan to'lov o'z usuli bo'yicha hisoblanadi. Har filialda bir vaqtda faqat **bitta** ochiq smena: qisman unikal indeks `(branch_id) WHERE closed_at IS NULL`.

### 8.9. Smena
- `require_shift = true` bo'lsa smena ochiq bo'lmasa sotuv rad etiladi (`422 shift_required`); boshqa xodim ochgan smenada sotish `403 shift_owned_by_other`.
- Smena ochish: ochiq smena bo'lmasa. Yopish: ochgan xodim yoki `manage_users`.
- Yopilganda `totals` hisoblanib muzlatiladi: usul bo'yicha tushum, nasiyaga yozilgan, qarz to'lovlari, cheklar soni (bekor qilinganlar hisobga olinmaydi).
- Z-hisobot chop etish uchun `GET /shifts/:id/report`.

### 9.7. Smena
| Metod | Yo'l | Perm |
|---|---|---|
| GET | `/shifts/current` | `view_pos` |
| POST | `/shifts/open` `{openingCash?}` | `view_pos` |
| POST | `/shifts/:id/close` `{countedCash?}` | egasi yoki `manage_users` |
| GET | `/shifts?from=&to=` | `view_analytics` |
| GET | `/shifts/:id/report` | egasi yoki `view_analytics` |
