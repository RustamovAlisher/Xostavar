# Kassa va sotuv

> Manba: `frontend/docs/BACKEND_TZ.md` v1.3. Bo'lim raqamlari asl TZ dagidek qoldirilgan.

Chek modeli, kesim (raskroy), chegirma, QQS, tannarx va foyda, to'lov va nasiya shartlari, aralash to'lov, storno, sotuv API va `POST /sales` algoritmi.

**Bog'liq qismlar:** [Mahsulotlar katalogi](07-katalog.md), [Ombor: qoldiq, kirim, tannarx](08-ombor.md), [Smena va Z-hisobot](10-smena.md), [Mijozlar va nasiya](11-mijozlar-nasiya.md)

---

### 7.6. Sotuv

**`sales`** (chek)
`id`, `branch_id`, `number` (ketma-ket, filial kodi va kun bo'yicha, masalan `MAIN-20261013-0001`), `type` (`sale`|`debt_payment`), `shift_id`, `cashier_id`, `customer_id null`, `customer_name text`, `payment_summary text` (hosila ro'yxat uchun: `cash`|`card`|`transfer`|`other`|`mixed`|`debt`), `subtotal bigint`, `discount_amount bigint`, `total_amount bigint`, `paid_amount bigint` (kassaga tushgan pul = `sale_payments` yig'indisi), `remaining_debt bigint` (nasiyaga yozilgan), `customer_debt_after bigint null`, `profit bigint`, `vat_included numeric`, `status` (`completed`|`voided`), `voided_at`, `voided_by`, `void_reason`, `client_id uuid` (oflayn yaratilgan chek id si, unikal), `created_at`.
**`sale_lines`**
`id`, `sale_id`, `product_id`, `variant_id null`, `name`, `variant_name`, `sku`, `category_id` (nusxa, hisobot uchun), `unit`, `qty numeric`, `base_qty numeric`, `unit_price bigint`, `line_total bigint`, `cost_per_base numeric null` (sotuv paytidagi tannarx nusxasi), `cuts jsonb null` (`[{lengthMeters, quantity}]`).

**`sale_payments`** — chekning to'lov qismlari (aralash to'lov uchun): `id`, `sale_id`, `method_id`, `kind` (nusxa), `amount bigint > 0`, `ref text null` (terminal/tranzaksiya raqami, ixtiyoriy). Qoida: `Σ amount + remaining_debt = total_amount`. Bitta usulli oddiy sotuvda bitta qator bo'ladi. Qarz to'lovi (`type = debt_payment`) ham shu jadvalda yoziladi.

Chek qatorlarida mahsulot nomi/SKU **nusxalanadi** (keyin mahsulot o'zgarsa yoki o'chirilsa tarixiy chek buzilmasligi uchun).

### 8.2. Kesim (raskroy)
Faqat `base_unit = 'meter'` mahsulotda va `unit = 'meter'` qatorda.
- `cuts = [{lengthMeters, quantity}]`, `lengthMeters > 0`, `quantity` butun ≥ 1.
- Mijoz to'laydigan miqdor: `qty = Σ lengthMeters × quantity` (sof metr, 2 xonagacha).
- Ombordan ayriladigan miqdor `cut_deduction_mode` ga qarab:
  - `net`: `baseQty = qty`.
  - `bars`: kesim bo'laklari uzunligi bo'yicha kamayish tartibida tayoqlarga "birinchi sig'adigan" usulida joylashtiriladi; ayriladi `tayoqlar_soni × tayoq_uzunligi`. Tayoq uzunligi = mahsulot/variantdagi `piece` konversiyasi `factor` i, bo'lmasa `piece_length_meters`. Bu algoritm frontend `calcLine` funksiyasi bilan bir xil natija berishi shart (test: umumiy test to'plami, 16-bo'lim).

### 8.3. Chegirma (faqat so'mda)
- Chek darajasida bitta `discountAmount` (butun so'm), qator darajasida chegirma yo'q.
- `0 ≤ discountAmount ≤ subtotal`. Foiz hech qayerda yo'q.
- **Kassir chegirma bera oladi** (summa kiritiladi). `business_rules.cashier_max_discount` belgilangan bo'lsa undan katta chegirma `422 discount_too_large` bilan rad etiladi (administrator bera oladi). Standart: cheklov yo'q.
- `totalAmount = subtotal − discountAmount`.
- Foyda hisobida chegirma proporsional ravishda qatorlarga taqsimlanadi (hisobotlarda qator bo'yicha foyda to'g'ri chiqishi uchun).

### 8.4. QQS
Narxlarga **kiritilgan** deb olinadi: `vat = total × v / (100 + v)`. Faqat ma'lumot sifatida chekda ko'rsatiladi, jamiga ta'sir qilmaydi. `v = 0` bo'lsa ko'rsatilmaydi.

### 8.7. Tannarx va foyda
- Sotuv paytida qator uchun `cost_per_base` = mahsulot/variant joriy `cost_price` (nusxa). Agar tannarx noma'lum bo'lsa: `lineTotal × (1 − estimated_margin_pct/100)` taxmin sifatida.
- `profit = totalAmount − Σ(baseQty × cost_per_base)` (chegirma hisobga olingan).
- Foyda va tannarx faqat `view_cost_price` huquqi bor foydalanuvchiga ko'rinadi.
- Nasiya sotuvda foyda sotuv paytida to'liq hisoblanadi (hisobotda "naqd tushum" va "foyda" alohida ko'rsatiladi).

### 8.8. To'lov va nasiya
- To'lov usullari **dinamik** (7.2-band). `payment_methods.enabled = false` bo'lsa `422 payment_method_disabled`.
- **Aralash to'lov:** chek bir nechta usul bilan to'lanishi mumkin (`payments: [{methodId, amount}]`), masalan 600 000 naqd + 400 000 karta. Qoida: `Σ amount + qarzga yoziladigan qism = total`. Bitta usulli sotuv shu qoidaning xususiy holi.
- **Nasiya** shartlari: `give_debt` huquqi, `customerId` majburiy (`422 debtor_required`), mijoz faol.
  - Oldindan to'lov: `payments` dagi `debt` bo'lmagan qatorlar yig'indisi (0 ≤ x ≤ total), istalgan faol usul bilan.
  - `remainingDebt = total − paidAmount`.
  - `customer.total_debt + remainingDebt ≤ credit_limit`, aks holda `422 credit_limit_exceeded`.
  - `remainingDebt = 0` bo'lsa chek oddiy sotuv sifatida yoziladi (`payment_summary` to'lov usullariga qarab).
  - Muddati o'tgan mijozga yangi nasiya: ogohlantirish, MVP da ruxsat (keyin `manage_users` tasdig'i talab qilish mumkin, sozlama).
  - Nasiyadan keyin `due_date = max(joriy muddat, bugun + default_credit_days)`, agar joriy muddat o'tgan bo'lsa yangi sana qo'yiladi.
- **Qarz to'lovi**: `POST /customers/:id/payments {amount, methodId}`; `0 < amount ≤ total_debt`, aks holda `422`. `debt_ledger` ga yoziladi, `last_paid_date = bugun`, kassaga tushgan pul sifatida smena hisobotiga kiradi (`type = debt_payment` chek).
- Mijoz tanlangan bo'lsa to'lov usulidan qat'i nazar chekda mijoz nomi saqlanadi.

### 7.9. Sotuvni bekor qilish (storno)
`POST /sales/:id/void` (huquq: `manage_users` yoki alohida `void_sale`; MVP da `manage_users`). Chek `voided` bo'ladi, qoldiq teskari harakat bilan qaytariladi (`sale_void`), nasiya bo'lsa qarz kamaytiriladi, smena hisobotiga ta'siri aks etadi, audit yoziladi. Faqat shu smena ichida yoki administrator tomonidan. Qismiy qaytarish keyingi bosqichda.

### 9.6. Kassa va sotuv
| Metod | Yo'l | Izoh |
|---|---|---|
| POST | `/sales/quote` | Savatni hisoblab beradi (saqlamaydi): qatorlar, narx, jami, QQS, ogohlantirishlar (qoldiq yetmasligi). Frontend savatni shu bilan tekshiradi |
| POST | `/sales` | Sotuvni amalga oshiradi (8-bo'lim), `Idempotency-Key` majburiy |
| GET | `/sales?from=&to=&cashierId=&customerId=&shiftId=&q=` | `view_pos` (kassir faqat o'zinikini, `view_analytics` hammasini) |
| GET | `/sales/:id` | chek ma'lumoti (chop etish uchun) |
| POST | `/sales/:id/void` | storno |
| GET | `/sales/:id/receipt` | chek PDF/HTML (ixtiyoriy) |

`POST /sales` so'rovi:
```json
{
  "clientId": "0191...",
  "lines": [
    { "productId": "…", "variantId": "…", "unit": "meter", "qty": 12, "cuts": [{"lengthMeters": 6, "quantity": 2}] },
    { "productId": "…", "unit": "box", "qty": 2 }
  ],
  "discountAmount": 30000,
  "customerId": "…",
  "payments": [
    { "methodId": "<naqd>", "amount": 100000 },
    { "methodId": "<click>", "amount": 50000 }
  ],
  "onCredit": true
}
```
`onCredit = true` bo'lsa qolgan summa mijozning nasiyasiga yoziladi (`customerId` majburiy, limit tekshiriladi). Javob: to'liq chek (`Sale` + `lines` + `payments`), `receiptNumber`, mijozning yangi qarzi, smena ID.

## 20. Ilova A. `POST /sales` bajarilish algoritmi (psevdokod)

```
BEGIN (isolation: READ COMMITTED + qator qulfi)
  idempotency: key bo'yicha oldingi natija bo'lsa uni qaytar
  perm tekshir: view_pos; nasiya bo'lsa give_debt
  shift = ochiq smena; require_shift bo'lsa: smena bor va egasi == joriy foydalanuvchi
  to'lov usullari enabled tekshir; kassir chegirmasi cashier_max_discount dan oshmasin
  lines ni tartiblab (productId, variantId) bo'yicha mahsulotlarni FOR UPDATE ol
  har qator uchun:
     product/variant topilganini va o'chirilmaganini tekshir
     unit sotiladiganligi (factor, narx > 0)
     qty ni birlik aniqligiga keltir (> 0)
     cuts bo'lsa: faqat meter/meter; qty va baseQty ni 8.2 bo'yicha hisobla
     unitPrice, lineTotal, baseQty, costPerBase
  subtotal = Σ lineTotal; discount 0..subtotal; total = subtotal - discount
  qoldiq: (product,variant) bo'yicha Σ baseQty; allow_negative_stock=false bo'lsa yetarliligini tekshir
  to'lov:
     payments: har method enabled, amount > 0; paid = Σ payments
     onCredit: give_debt, customer majburiy, remaining = total - paid, limit tekshir
     aks holda: paid == total shart (remaining = 0)
  profit = total - Σ(baseQty * costPerBase)  (yoki taxminiy)
  sales + sale_lines + sale_payments yoz (nomlar nusxasi bilan, number ketma-ket)
  qoldiqni ayir, stock_movements yoz
  nasiya bo'lsa: customers.total_debt += remaining, due_date yangila, debt_ledger yoz
  audit_logs yoz
  idempotency natijasini saqla
COMMIT
→ events: stock.changed (har bir mahsulot), sale.created, shift.changed
```
