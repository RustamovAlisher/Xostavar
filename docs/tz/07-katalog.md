# Mahsulotlar katalogi

> Manba: `frontend/docs/BACKEND_TZ.md` v1.3. Bo'lim raqamlari asl TZ dagidek qoldirilgan.

Universal mahsulot modeli: asosiy birlik, konversiyalar, variantlar, shtrix-kodlar, filial narxi, birlik va narx hisob-kitobi, mahsulotlar API.

**Bog'liq qismlar:** [Sozlamalar (lug'atlar)](06-sozlamalar.md), [Ombor: qoldiq, kirim, tannarx](08-ombor.md)

---

### 7.3. Mahsulotlar

**`products`**
| Maydon | Tur | Izoh |
|---|---|---|
| `id` | uuid | |
| `name` | text | majburiy |
| `category_id` | fk | majburiy |
| `sku` | text | unikal (butun katalog bo'yicha, variant SKU lari bilan birga) |
| `description` | text | |
| `base_unit` | fk→units | qoldiq va tannarx shu birlikda |
| `is_divisible` | bool | kasr miqdor mumkin (`false` bo'lsa butun) |
| `retail_price` | bigint | asosiy birlik uchun, variantsiz mahsulotda majburiy (> 0) |
| `wholesale_price` | bigint null | |
| ~~`cost_price`~~, ~~`stock`~~, ~~`min_stock`~~ | | **Bu maydonlar mahsulot jadvalida emas.** Ular filial bo'yicha `stock_levels` da (pastda). API javobida joriy filial uchun shu nomlar bilan qaytariladi (`costPrice`, `stock`, `minStock`) |
| `is_variable` | bool | variantli bo'lsa narx/qoldiq variantlarda |
| `deleted_at`, `version` | | |

**`product_barcodes`** — `product_id`, `barcode` (unikal butun tizimda). Variant va qadoq shtrix-kodlari ham shu jadvalda (`variant_id` null bo'lishi mumkin, `unit` null yoki qadoq birligi).
**`product_variants`** — `id`, `product_id`, `name`, `sku` (unikal), `retail_price`, `wholesale_price`, `deleted_at`.
**`stock_levels`** — qoldiq, kam qoldiq chegarasi va o'rtacha tannarx **filial bo'yicha**: `id`, `branch_id`, `product_id`, `variant_id null`, `stock numeric(18,4) default 0`, `min_stock numeric(18,4) null`, `cost_price numeric(18,4) null`, `version`. Unikal: (`branch_id`, `product_id`, `variant_id`). Variantsiz mahsulot uchun `variant_id = null`. Yangi mahsulot yaratilganda barcha filiallar uchun nol qoldiqli qator yaratiladi (yoki birinchi harakatda sust yaratiladi).
**`branch_prices`** — filial bo'yicha narx: `id`, `branch_id`, `product_id`, `variant_id null`, `retail_price bigint`, `wholesale_price bigint null`. Unikal: (`branch_id`, `product_id`, `variant_id`). Qator bo'lmasa `products`/`product_variants` dagi umumiy narx ishlatiladi. Qadoq narxi (`unit_conversions.price`) umumiy; agar qadoq narxi qo'lda belgilanmagan bo'lsa u filial narxidan hisoblanadi (`retail_price × factor`).
**`unit_conversions`** — `id`, `product_id`, `variant_id null`, `unit` fk, `factor numeric(18,6) > 0`, `price bigint null` (shu birlik uchun alohida narx; bo'sh bo'lsa `retail_price × factor`), `barcode text null`. Unikal: (`product_id`, `variant_id`, `unit`). Variantdagi yozuv otadagi bir xil birlikni ustidan yozadi (masalan Ø12 uchun kg koeffitsienti Ø16 dan farq qiladi).

Cheklovlar:
- `unit != base_unit` konversiyada; bitta birlik ikki marta kiritilmaydi.
- Variantli mahsulotda `retail_price` ota darajasida 0 va ishlatilmaydi; `stock_levels` faqat variantlar uchun yuritiladi.
- SKU va shtrix-kodlar mahsulot, variant va qadoq bo'yicha **umumiy** unikal (katta-kichik harfga sezgir emas).
- `stock_levels.stock` CHECK ≥ 0 (agar `allow_negative_stock = false` bo'lsa, ilova darajasida ham tekshiriladi).

**Hisoblanadigan:** sotiladigan birliklar = asosiy birlik + konversiyalar, narxi > 0 bo'lganlari.

Qo'shimcha qoidalar (frontend bilan mos):
- **Avtomatik SKU.** `sku` bo'sh kelsa server yaratadi: nomning birinchi ikki so'zi (lotin, katta harf, `-` bilan, 12 belgigacha), bo'lmasa kategoriya kodi, keyin `-` va 4 ta tasodifiy belgi (`ARMATURA-POLAT-7K2Q`). Variant SKU bo'sh bo'lsa: `<ota SKU>-<variant nomi slug>` (`ARM-12-MM-A500C`). Takror bo'lsa oxiriga `-2`, `-3` qo'shiladi. Shtrix-kodlar vergul, nuqtali vergul yoki bo'sh joy bilan ajratib kiritiladi, takrorlar olib tashlanadi.
- **Kategoriya shabloni.** Yangi mahsulot yaratilganda (asosiy birlik qo'lda o'zgartirilmagan bo'lsa) `base_unit`, `is_divisible` va `conversions` kategoriyadan olinadi. Bu frontendda bajariladi, server faqat tayyor qiymatni tekshiradi.
- **Metrli tovar yordamchilari.** Frontend `kg` konversiyasini "1 m = X kg" ko'rinishida oladi (`factor = 1 / X`), `piece` ni "1 tayoq = X m" (`factor = X`). Variantdagi `kg/m` otadagi qiymatdan ustun turadi.
- **Variantni olib tashlash.** Mahsulot tahrirlanganda variant ro'yxatdan olib tashlansa yoki mahsulot variantlidan oddiyga o'tkazilsa (frontend "N ta variant va qoldig'i o'chadi" deb ogohlantiradi), server variantni **yumshoq** o'chiradi. Biror filialda qoldig'i 0 dan farqli bo'lsa `409 in_use` (`details` da filiallar va qoldiq). Avval qoldiqni 0 ga tuzatish (`/stock-adjustments`) kerak.
- **Katalog formasida qoldiq yo'q.** Mahsulot qo'shish/tahrirlashda `stock` qabul qilinmaydi (tovar faqat kirim orqali keladi). Formadagi **min. qoldiq** va **tannarx** maydonlari filialga tegishli (`stock_levels`): ular joriy filial (`X-Branch-Id`) qatoriga yoziladi, qator yo'q bo'lsa yaratilmaydi (mahsulot omborga faqat kirim bilan qo'shiladi, 7.0.1). Tannarxni qo'lda o'zgartirish `view_cost_price` talab qiladi, aks holda maydon e'tiborsiz qoldiriladi.
- **Ulgurji narx** (`wholesale_price`) saqlanadi va ko'rsatiladi, lekin MVP da kassada ishlatilmaydi (kassa faqat chakana narx bilan sotadi).

### 8.1. Birlik konversiyasi va narx
- `factor(unit)`: asosiy birlik uchun 1; boshqa birlik uchun variantdagi, bo'lmasa otadagi konversiya `factor`. Topilmasa `422 unit_not_allowed`.
- **Asosiy narx** = tanlangan filialning `branch_prices` qatori (variant, bo'lmasa mahsulot), u bo'lmasa umumiy `retail_price`.
- `unitPrice(unit)`: asosiy birlik uchun `round(asosiy narx)`; boshqasi uchun konversiyadagi `price`, bo'lmasa `round(asosiy narx × factor)`. `unitPrice ≤ 0` bo'lgan birlik sotuvga yaroqsiz (`422 price_missing`).
- `baseQty = qty × factor`, 4 xonagacha yaxlitlanadi.
- Miqdor aniqligi: `unit.precision` (asosiy birlik `is_divisible = false` bo'lsa 0). Aniqlikdan ortiq xona rad etiladi yoki yaxlitlanadi (kelishilgan: yaxlitlanadi, javobda aks etadi).
- `lineTotal = round(unitPrice × qty)`. Yaxlitlash faqat qator darajasida, jami = qatorlar yig'indisi (chekda hisob mos tushishi uchun).

### 9.4. Mahsulotlar
| Metod | Yo'l | Perm |
|---|---|---|
| GET | `/products?q=&categoryId=&lowStock=true&page=` | `view_inventory` yoki `view_pos` |
| GET | `/products/:id` | shu |
| GET | `/products/lookup?code=` — SKU/shtrix-kod bo'yicha aniq moslik (qadoq shtrix-kodi bo'lsa `unit` ham qaytadi) | `view_pos` |
| POST | `/products` | `add_product` |
| PUT | `/products/:id` (versiya bilan) | `edit_product` |
| DELETE | `/products/:id` | `delete_product` |
| POST | `/products/import` (CSV/XLSX), `GET /products/export` | `add_product` / `view_inventory` |
| GET | `/products/:id/history` — kirim va audit | `view_inventory` |

Javob shakli frontend `Product` bilan bir xil (`variants`, `conversions` ichma-ich). `costPrice`, `wholesalePrice` faqat `view_cost_price` bilan.

- `GET /products?inBranch=true` — faqat joriy filial omboridagi mahsulotlar (kassa va ombor sahifasi uchun), har birida `stock`, `minStock`, `costPrice` joriy filial bo'yicha.
- `GET /products?withBranchStock=<branchId>` — butun katalog, har mahsulotda `inBranch: boolean` va shu filialdagi qoldiq (kirim oynasidagi "omborda yo'q / 12 m" belgisi uchun).
- Qidiruv (`q`) nom, SKU, shtrix-kod (qadoq kodlari bilan), variant nomi va SKU bo'yicha. Variant orqali topilsa javobda `matchedVariantIds`.
- Ro'yxatda filtr: `categoryId`; kategoriya bo'yicha sonlar `GET /products/facets?inBranch=true` (kassadagi kategoriya tugmalaridagi sonlar uchun).

## 21. Ilova B. Namuna ma'lumot: armaturada konversiya

`Armatura Ø12 mm A500C`: asosiy birlik `meter`, `retail_price = 12 500` so'm/m.
Konversiyalar: `kg` — `factor = 1.1261` (1 kg = 1.1261 m, ya'ni 1 m = 0.888 kg), `piece` — `factor = 11.7` (1 tayoq = 11.7 m).
Sotuvda `qty = 1, unit = piece` → `baseQty = 11.7 m`, `unitPrice = round(12 500 × 11.7) = 146 250`, qoldiq 11.7 m ga kamayadi.
`qty = 10, unit = kg` → `baseQty = 11.261 m`, `unitPrice = round(12 500 × 1.1261) = 14 076`/kg, `lineTotal = 140 760`.
