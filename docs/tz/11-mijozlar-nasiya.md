# Mijozlar va nasiya

> Manba: `frontend/docs/BACKEND_TZ.md` v1.3. Bo'lim raqamlari asl TZ dagidek qoldirilgan.

Mijoz kartochkasi, qarz jurnali (ledger), muddati o'tganlik, qarz to'lovi, mijozlar API. Nasiya sotuv shartlari 09-qismdagi 8.8 da.

**Bog'liq qismlar:** [Kassa va sotuv](09-kassa-sotuv.md)

---

### 7.5. Mijozlar va nasiya

**`customers`** — `id`, `name`, `phone` (normalizatsiya qilingan raqamlar, unikal), `group_id`, `credit_limit bigint`, `due_date date null`, `last_paid_date date null`, `total_debt bigint` (hosila, tranzaksiyalardan kelib chiqadi), `deleted_at`, `version`.
**`debt_ledger`** — mijoz qarzi harakati: `id`, `customer_id`, `branch_id`, `type` (`sale_debt`|`payment`|`adjustment`), `amount` (+ qarz oshishi, − kamayishi), `balance_after`, `ref_type`, `ref_id`, `user_id`, `created_at`. `customers.total_debt` har doim oxirgi `balance_after` ga teng bo'lishi shart (tranzaksiya ichida yangilanadi).

Muddati o'tganlik **saqlanmaydi**, hisoblanadi: `total_debt > 0 AND due_date < CURRENT_DATE`.

Mijoz qoidalari (frontend bilan mos):
- `name` bo'sh bo'lmaydi. Telefon `+998 XX XXX-XX-XX` ko'rinishida kiritiladi va 12 raqam bo'lishi shart.
- Yangi mijozda standart qiymatlar: `credit_limit = business_rules.default_credit_limit`, `due_date = bugun + default_credit_days`, guruh — ro'yxatdagi birinchi guruh. Kassadagi to'lov oynasidan ham yangi mijoz qo'shiladi va darhol tanlanadi.
- `due_date` qo'lda tahrirlanadi (`give_debt` yoki `manage_users`). Tahrirda `total_debt` o'zgarmaydi (u faqat ledger orqali o'zgaradi).
- Limitni joriy qarzdan **kichik** qilish ruxsat etiladi: frontend ogohlantiradi ("yangi nasiya berilmaydi"), keyingi nasiya `credit_limit_exceeded` bilan rad etiladi.
- Ro'yxat tartibi: avval muddati o'tganlar, keyin qarz kamayish tartibida. Qidiruv: nom yoki telefon raqamlari (kamida 2 raqam).

### 9.8. Mijozlar va nasiya
| Metod | Yo'l | Perm |
|---|---|---|
| GET | `/customers?q=&overdue=true&hasDebt=true` | `view_debts` yoki `view_pos` |
| POST | `/customers` | `view_pos` yoki `view_debts` (kassada tezkor qo'shish) |
| PATCH | `/customers/:id` | `give_debt` yoki `manage_users` |
| DELETE | `/customers/:id` | `manage_users` (qarz 0 bo'lsa) |
| POST | `/customers/:id/payments` | `view_debts` |
| GET | `/customers/:id/ledger` | `view_debts` |

Telefon normalizatsiya: faqat raqamlar, `998` prefiksli 12 raqam yoki 9 raqam (xalqaro formatga keltiriladi); takror telefon `409 duplicate_code`.
