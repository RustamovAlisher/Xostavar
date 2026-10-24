# Hisobotlar

> Manba: `frontend/docs/BACKEND_TZ.md` v1.3. Bo'lim raqamlari asl TZ dagidek qoldirilgan.

Hisobot qoidalari, dashboard javobi tarkibi, barcha hisobot endpointlari.

**Bog'liq qismlar:** [Xarajatlar va sof foyda](12-xarajatlar.md)

---

### 8.10. Hisobot qoidalari
- "Bugungi tushum" = bugungi `paid_amount` yig'indisi (qarz to'lovlari bilan). "Cheklar soni" va "o'rtacha chek" faqat `type = sale`. "Kecha" bilan taqqoslash serverda hisoblanadi (kecha 0 bo'lsa foiz `null`).
- Qarzdorlar soni: `total_debt > 0` bo'lgan mijozlar.
- Ombor qiymati: Σ `stock × (cost_price ?? retail_price)`, `view_cost_price` bo'lmasa sotish narxida.
- Vaqt zonasi: do'kon vaqt zonasi sozlamasi (`Asia/Tashkent`), "kun" chegarasi shu zonada.

### 9.9. Hisobotlar
Hammasi `view_analytics`; foyda/tannarx maydonlari `view_cost_price` bilan.

| Yo'l | Natija |
|---|---|
| `GET /reports/dashboard?date=` | "Moliya va statistika" sahifasi uchun bitta javob (joriy filial bo'yicha, mijozlar qarzi esa umumiy). Maydonlar pastdagi ro'yxatda |
| `GET /reports/branches-overview?from=&to=` | Barcha filiallar bo'yicha taqqoslash (savdo, cheklar, foyda*, ombor qiymati*) — `manage_branches` |
| `GET /reports/revenue?from=&to=&groupBy=day` | Kunlik tushum va foyda |
| `GET /reports/categories?from=&to=` | Kategoriyalar ulushi |
| `GET /reports/payments?from=&to=` | To'lov usullari (`kind` va usul bo'yicha) |
| `GET /reports/profit-loss?from=&to=` | Foyda va zarar: tushum, tannarx, yalpi foyda, xarajatlar, sof foyda (9.12) |
| `GET /reports/products?from=&to=&sort=` | Eng ko'p sotilgan, eng foydali mahsulotlar |
| `GET /reports/low-stock` | Kam qoldiqdagilar (variantlar bilan) |
| `GET /reports/debts` | Qarzdorlar, muddati o'tganlar, yoshi (aging) |
| `GET /reports/cashiers?from=&to=` | Kassirlar bo'yicha |
| `GET /reports/*.csv` | Eksport |

`GET /reports/dashboard` javobi (frontend `AnalyticsView` bilan mos), har bir ko'rsatkich `{today, yesterday}` juftligi bilan (foiz frontendda hisoblanadi, kecha 0 bo'lsa taqqoslanmaydi):
- `revenue` — kassaga tushgan pul (`paid_amount`, qarz to'lovlari bilan);
- `receipts` — `type = sale` cheklar soni; `avgReceipt` — `Σ total_amount / receipts`;
- `profit` va `marginPct` (`profit / Σ total_amount × 100`) — faqat `view_cost_price`;
- `customerDebt` — mijozlar umumiy qarzi va qarzdorlar soni; kechagi qiymat = bugungi − bugun yozilgan nasiya + bugungi qarz to'lovlari;
- `inventoryValue` — ombor qiymati va pozitsiyalar soni (`view_cost_price` bo'lsa tannarxda, aks holda sotish narxida); kechagi qiymat = bugungi + bugun sotilganning tannarxi − bugungi kirim summasi;
- `week` — oxirgi 7 kun: kun, tushum, foyda*;
- `categoryShare` — oxirgi 30 kun sotuvi kategoriya bo'yicha (chegirma qatorlarga proporsional taqsimlanadi), eng katta 6 tasi alohida, qolgani "Boshqa" (7 ta yoki kamroq bo'lsa hammasi alohida);
- `paymentsToday` — bugun usul bo'yicha kassaga tushgan pul (nasiya chekidagi oldindan to'lov o'z usulida), alohida `nasiyaWritten` (bugun nasiyaga yozilgan) va `debtPaymentsToday` (shundan qarz to'lovlari);
- `lowStock` — kam qoldiqdagi pozitsiyalar (variantlar alohida), `stock / minStock` nisbati bo'yicha o'sish tartibida. Kam qoldiq: `min_stock > 0 AND stock < min_stock`.
