# Sozlamalar (lug'atlar)

> Manba: `frontend/docs/BACKEND_TZ.md` v1.3. Bo'lim raqamlari asl TZ dagidek qoldirilgan.

Do'kon rekvizitlari, biznes qoidalari, birliklar, kategoriyalar, o'lcham andozalari, mijoz guruhlari, dinamik to'lov usullari, yetkazib beruvchilar va ularning cheklovlari.

**Bog'liq qismlar:** [Xodimlar, rollar va huquqlar](04-xodimlar-rollar.md), [Mahsulotlar katalogi](07-katalog.md)

---

### 7.2. Sozlamalar (lug'atlar)

**`store_settings`** (bitta qator): `name` (bo'sh bo'lmaydi), `subtitle`, `address`, `phone`, `tax_id` (STIR, chekda "STIR:" qatori), `receipt_footer`, `print_format` (`thermal`|`a4`, standart `thermal` — chek oynasida birinchi tanlanadigan format), `paper_width_mm` (`58`|`80`, standart `80` — termo chek kengligi). Kirish sahifasi va yon panelda `name` va `subtitle` ko'rsatiladi. Chekda `address`, `phone`, `receipt_footer` uchun filialning qiymati bo'lsa o'sha, bo'lmasa `store_settings` dagisi ishlatiladi. `name`, `subtitle`, `tax_id` va chop etish sozlamalari umumiy.
**`business_rules`** (bitta qator):
`piece_length_meters numeric` (yangi metrli mahsulot uchun shablon, > 0), `default_cut_length_meters` (> 0), `cut_deduction_mode` (`net`|`bars`), `default_min_stock numeric`, `default_credit_days int`, `default_credit_limit bigint`, `vat_pct numeric(5,2)` (0–100), `estimated_margin_pct numeric(5,2)` (0–100), `quick_down_payment_pcts int[]` (1–99), `allow_negative_stock bool`, `require_shift bool`, `cashier_max_discount bigint null` (kassir bera oladigan eng katta chegirma summasi, `null` = cheklanmagan, kelishilgan standart).
**`units`** — `id text pk` (masalan `piece`, `kg`, `meter`, `m2`, `liter`, `bag`, `box`, `can`, `roll`, `pack`; faqat `[a-z0-9_]`), `name`, `short` (unikal), `precision smallint` (0–3).
**`categories`** — `id`, `name` (unikal), `icon` (emoji), `description`, `default_base_unit` fk→units, `default_is_divisible bool`, `default_conversions jsonb` (`[{unit, factor}]`), `sort_order`.
**`size_presets`** — `id`, `category_id` fk, `name`, `kg_per_meter numeric nullable`; (`category_id`, `name`) unikal.
**`customer_groups`** — `id`, `name` (unikal).
**`payment_methods`** — **dinamik ro'yxat**: `id uuid`, `code` (unikal), `label`, `kind` (`cash`|`card`|`transfer`|`other`|`debt`), `enabled`, `system bool`, `sort_order`. Egasi Sozlamalar sahifasida yangi usul qo'sha oladi (masalan Click, Payme, Uzum, Humo terminali), `kind` ni tanlaydi. Hisobotlar va smena hisoboti `kind` bo'yicha guruhlanadi. Tizim usullari (`cash`, `card`, `transfer`, `debt` (nasiya)) o'chirilmaydi, faqat nomi o'zgaradi va yoqiladi/o'chiriladi. Kamida bitta `debt` bo'lmagan usul `enabled` bo'lishi shart. Ishlatilgan usulni o'chirib bo'lmaydi (`409 in_use`), faqat o'chirib qo'yish mumkin. Tizim usulining va cheklarda ishlatilgan usulning `kind` i **o'zgarmaydi** (`409 in_use`). Yangi usul faqat `cash`|`card`|`transfer`|`other` turida qo'shiladi, `debt` turi faqat tizim usulida bo'ladi. `label` unikal (katta-kichik harfga sezgir emas). Kassada nasiya usuli faqat `give_debt` huquqi bor xodimga ko'rinadi.
**`suppliers`** — `id`, `name` (unikal), `phone`, `note`.

Qo'shimcha cheklovlar (frontend `validateSettings` bilan bir xil):
- `units.id` faqat yangi birlikda kiritiladi, keyin o'zgarmaydi. `name` va `short` bo'sh bo'lmaydi, `short` unikal.
- Kategoriya: `name` bo'sh bo'lmaydi va unikal. `default_base_unit` mavjud birlik. `default_conversions` da birlik mavjud, asosiy birlikdan farqli, takrorlanmaydi, `factor > 0`. **Oxirgi kategoriyani o'chirib bo'lmaydi.** Kategoriya o'chirilsa uning o'lcham andozalari ham o'chadi.
- O'lcham andozasi: `name` bo'sh bo'lmaydi va kategoriya ichida unikal. `kg_per_meter` faqat asosiy birligi `meter` bo'lgan kategoriyada, kiritilsa > 0.
- Mijoz guruhi: `name` bo'sh bo'lmaydi va unikal. **Oxirgi guruhni o'chirib bo'lmaydi.**
- Yetkazib beruvchi va rol: `name` bo'sh bo'lmaydi va unikal.
- `business_rules`: `default_credit_days` butun son ≥ 0, `default_min_stock ≥ 0`, `default_credit_limit ≥ 0`.

Qoidalar: ishlatilayotgan birlik, kategoriya, mijoz guruhi, rolni o'chirish `409 in_use`. Birlik "ishlatilmoqda" deb sanaladi, agar biror mahsulot/variant konversiyasi, kategoriya shabloni, chek qatori yoki kirim yozuvida uchrasa. Guruh/rol nomi o'zgarsa unga bog'liq yozuvlar fk orqali avtomatik yangilanadi (frontendda nom bo'yicha bog'langan, backendda `id` bo'yicha).

### 9.3. Sozlamalar
| Metod | Yo'l | Perm |
|---|---|---|
| GET | `/settings` — barcha lug'atlar bir javobda (frontend `AppSettings` shakli) | autentifikatsiyalangan (maxfiy bo'lmagan qismi) |
| PUT | `/settings` — butun to'plamni saqlash (frontend "Saqlash" tugmasi), tranzaksiya ichida, versiya bilan | `manage_settings` |
| GET/POST/PATCH/DELETE | `/units`, `/categories`, `/size-presets`, `/customer-groups`, `/suppliers`, `/payment-methods`, `/roles` | `manage_settings` |
| POST | `/settings/reset` — standart qiymatlarga qaytaradi, lekin **ishlatilayotgan** maxsus yozuvlarni saqlab qoladi (mahsulotdagi kategoriya va birliklar, mijozdagi guruh, xodimdagi rol, cheklarda ishlatilgan to'lov usuli); javobda nechta yozuv saqlab qolingani | `manage_settings` |

`PUT /settings` serverda tekshiradi (frontend tekshiruvi bilan bir xil + qo'shimcha): bo'sh/takroriy nomlar, birlik kodi formati va unikalligi, koeffitsient > 0, QQS/foyda 0–100, tezkor foizlar 1–99, kamida bitta yoqilgan to'lov usuli, ishlatilayotgan yozuvlarni o'chirmaslik (`409 in_use`, `details` da qaysi yozuv ishlatayotgani).
