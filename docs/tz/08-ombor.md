# Ombor: qoldiq, kirim, tannarx

> Manba: `frontend/docs/BACKEND_TZ.md` v1.3. Bo'lim raqamlari asl TZ dagidek qoldirilgan.

Qoldiq harakati jurnali, kirim hujjatlari, qoldiqni tekshirish va ayirish, o'rtacha tannarx, ombor API.

**Bog'liq qismlar:** [Filiallar va ikki darajali admin](05-filiallar.md), [Mahsulotlar katalogi](07-katalog.md)

---

### 7.4. Ombor harakati

**`stock_movements`** (o'zgarmas jurnal, qoldiqning haqiqat manbai bilan tekshiruv uchun)
`id`, `branch_id`, `product_id`, `variant_id null`, `type` (`stock_in`|`sale`|`sale_void`|`adjustment`|`write_off`|`transfer_out`|`transfer_in`), `qty_base numeric` (+/−, asosiy birlikda), `unit` (kiritilgan birlik), `qty_unit numeric`, `cost_per_base numeric null`, `ref_type`, `ref_id` (chek, kirim hujjati), `balance_after numeric`, `user_id`, `created_at`.

**`stock_receipts`** (kirim hujjati): `id`, `branch_id`, `number` (ketma-ket, filial bo'yicha), `supplier_id null`, `supplier_name`, `invoice text null`, `date`, `user_id`, `note`. **`stock_receipt_lines`**: `receipt_id`, `product_id`, `variant_id null`, `unit`, `qty`, `qty_base`, `cost_per_unit`, `cost_per_base`, `total_cost`.

### 8.5. Qoldiq
- Sotuvda har bir (mahsulot, variant) bo'yicha jami `baseQty` hisoblanadi (bir chekdagi bir nechta qator birlashtiriladi). Qoldiq **sotuv amalga oshirilayotgan filialning** `stock_levels` qatoridan tekshiriladi va ayriladi.
- Agar `allow_negative_stock = false`: `stock − Σ baseQty ≥ 0` bo'lishi shart, aks holda `422 insufficient_stock` (butun chek rad etiladi, qisman bajarilmaydi).
- Qoldiq yangilanishi **qator qulfi** bilan: `SELECT ... FOR UPDATE` (mahsulot/variant ID lari tartiblangan holda, deadlock oldini olish uchun) yoki `UPDATE ... SET stock = stock - $1 WHERE id = $2 AND stock >= $1` atomik shartli yangilanish.
- Har bir o'zgarish `stock_movements` ga yoziladi (`balance_after` bilan).
- Variantli mahsulotda ota qoldig'i **saqlanmaydi**, variantlar yig'indisi sifatida hisoblanadi (filial bo'yicha yoki barcha filiallar jami).

### 8.6. Kirim va o'rtacha tannarx
- O'rtacha tannarx **filial bo'yicha** yuritiladi (`stock_levels.cost_price`). Kirim istalgan ruxsat etilgan birlikda: `baseQty = qty × factor`, `costPerBase = costPerUnit / factor`.
- Yangi o'rtacha tannarx: agar `costPerUnit > 0`: `(max(0, stock) × oldCost + baseQty × costPerBase) / (max(0, stock) + baseQty)`, eski tannarx bo'lmasa yoki qoldiq 0 bo'lsa `costPerBase`. `costPerUnit = 0` bo'lsa tannarx o'zgarmaydi. 2 xonagacha yaxlitlanadi.
- Kirim hujjati bir nechta qatorli bo'lishi mumkin (MVP da frontend bitta qatorli yuboradi, API ko'p qatorli).
- Kirim tannarxi bilan birga ixtiyoriy yangi sotish narxini yangilash (Billz kabi): `newRetailPrice` (alohida huquq `edit_product`).

### 9.5. Ombor
Barcha ombor endpointlari tanlangan filial (`X-Branch-Id`) ichida ishlaydi; `GET /stock-levels?productId=&branchId=all` bir mahsulotning barcha filiallardagi qoldig'ini ko'rsatadi (`all_branches` yoki tegishli filiallar bo'yicha).

| Metod | Yo'l | Perm |
|---|---|---|
| POST | `/stock-in` `{ supplierId?, supplierName?, invoice?, lines: [{productId, variantId?, unit, qty, costPerUnit, newRetailPrice?}] }` + `Idempotency-Key` | `stock_in` |
| GET | `/stock-in?from=&to=&productId=` | `view_inventory` |
| GET | `/stock-movements?productId=` | `view_inventory` |
| POST | `/stock-adjustments` `{productId, variantId?, newStock | delta, reason}` (inventarizatsiya, qo'lda tuzatish) | `edit_product` + audit |
| PATCH | `/stock-levels/:id` `{minStock?, costPrice?}` — joriy filialda kam qoldiq chegarasi va (ixtiyoriy) tannarxni qo'lda belgilash. Frontend buni katalog formasidagi "Min qoldiq" va "Tannarx" maydonlaridan yuboradi | `edit_product` yoki `stock_in` (`costPrice` uchun qo'shimcha `view_cost_price`), audit |

Kirim qoidalari (frontend bilan mos): variantli mahsulotda variant tanlanishi shart; `qty > 0`; `costPerUnit ≥ 0`, **`0` yoki bo'sh bo'lsa o'rtacha tannarx o'zgarmaydi**; yetkazib beruvchi ro'yxatdan tanlanadi yoki erkin matn bilan yoziladi (`supplierName`, ro'yxatda bo'lmasa avtomatik qo'shilmaydi); hujjat raqami ixtiyoriy. Javobda filialdagi yangi qoldiq va yangi o'rtacha tannarx.
