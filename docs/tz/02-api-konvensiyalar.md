# API konvensiyalari va umumiy qoidalar

> Manba: `frontend/docs/BACKEND_TZ.md` v1.3. Bo'lim raqamlari asl TZ dagidek qoldirilgan.

Barcha endpointlar uchun umumiy: filial konteksti, format, pul va miqdor turlari, idempotentlik, sahifalash, xato formati, jadvallar uchun umumiy maydonlar, o'chirish qoidalari.

**Bog'liq qismlar:** [Autentifikatsiya va xavfsizlik](03-auth-xavfsizlik.md), [Filiallar va ikki darajali admin](05-filiallar.md)

---

## 5. Umumiy API konvensiyalari

- **Filial konteksti:** filialga tegishli endpointlar `X-Branch-Id: <uuid>` sarlavhasini talab qiladi (yo'q bo'lsa foydalanuvchining standart filiali ishlatiladi; foydalanuvchiga biriktirilmagan filial `403`). Umumiy resurslar (katalog, mijozlar, sozlamalar) filialga bog'liq emas. Hisobotlarda `?branchId=` yoki `?branchId=all` (faqat `all_branches`).
- **Bazaviy yo'l:** `/api/v1`. Mos kelmaydigan o'zgarishlar uchun `/v2`.
- **Format:** JSON, UTF-8. Sana-vaqt ISO 8601 UTC (`2026-10-13T09:15:00.000Z`). Faqat sana maydonlari `YYYY-MM-DD` (masalan nasiya muddati).
- **Pul:** butun son (so'm), `bigint`/`integer`. Hech qachon `float`.
- **Miqdor:** `numeric(18,4)` bazada, API da son sifatida. Asosiy birlik aniqligi 4 xona ichki, ko'rsatish birlik `precision` bo'yicha.
- **Identifikatorlar:** UUID v7 (vaqt bo'yicha tartiblangan). Frontend ham yangi yozuvlar uchun UUID yaratishi mumkin (oflayn rejim uchun, 10-bo'lim).
- **Autentifikatsiya:** `Authorization: Bearer <accessToken>`.
- **Idempotentlik:** pul/qoldiqni o'zgartiruvchi POST so'rovlar (`/sales`, `/stock-in`, `/debts/:id/payments`, `/shifts/open|close`) `Idempotency-Key: <uuid>` sarlavhasini talab qiladi. Bir xil kalit bilan takror so'rovga birinchi natija qaytariladi (kamida 24 soat saqlanadi).
- **Sahifalash:** `?page=1&pageSize=50` yoki kursor (`?cursor=...&limit=50`) katta ro'yxatlar uchun (tranzaksiyalar, audit). Javob: `{ "items": [], "total": 123, "page": 1, "pageSize": 50 }`.
- **Qidiruv/filtr:** `?q=`, `?categoryId=`, `?from=&to=`. Saralash: `?sort=-createdAt`.
- **Optimistik bloklash:** o'zgartiriladigan resurslarda `version` (integer) maydoni; `PUT/PATCH` da `If-Match: <version>` yoki bodyda `version`. Mos kelmasa `409 version_conflict`.

### 5.1. Xato formati
```json
{
  "error": {
    "code": "insufficient_stock",
    "message": "Omborda faqat 5 dona bor",
    "details": { "productId": "...", "available": 5, "requested": 20 },
    "requestId": "7f1c..."
  }
}
```
HTTP kodlari: `400` validatsiya, `401` autentifikatsiya, `403` huquq yo'q, `404`, `409` ziddiyat (versiya, takror, biznes qoida), `422` biznes validatsiya, `429` rate limit, `500`. Foydalanuvchiga ko'rsatiladigan `message` o'zbek tilida, `code` mashina uchun.

### 5.2. Asosiy xato kodlari
`validation_failed`, `unauthorized`, `forbidden`, `not_found`, `version_conflict`, `duplicate_code` (SKU/shtrix-kod takror), `insufficient_stock`, `shift_required`, `shift_owned_by_other`, `credit_limit_exceeded`, `debtor_required`, `payment_method_disabled`, `price_missing`, `unit_not_allowed`, `in_use` (ishlatilayotgan yozuvni o'chirish), `last_admin`, `self_action_forbidden`.

## 7. Ma'lumotlar modeli

Quyidagi jadvallar ro'yxat. Barcha jadvallarda `id uuid pk`, `created_at timestamptz`, `updated_at timestamptz`; o'zgartiriladiganlarda `version int`. Yumshoq o'chirish (`deleted_at`) faqat ko'rsatilgan jadvallarda. Maydon nomlari bazada `snake_case`, API da `camelCase`.

## 8. Biznes qoidalari (server hisob-kitoblari)

**Eng muhim talab:** savat summasi, qoldiq ayirish, tannarx, foyda, qarz — **faqat serverda** hisoblanadi va tranzaksiya ichida bajariladi. Frontend hisoblari faqat ko'rsatish uchun (oldindan ko'rish). Server mijozdan kelgan narx/summaga ishonmaydi: faqat `productId`, `variantId`, `unit`, `qty`, `cuts` qabul qilinadi.

### 8.11. O'chirish qoidalari
- Mahsulotni o'chirish `delete_product`; sotuv/kirim tarixi bor mahsulot **yumshoq** o'chiriladi (`deleted_at`), tarixiy cheklar nusxalar bilan saqlanadi.
- Mijozni o'chirish `manage_users` va faqat `total_debt = 0`.
- Xodimni o'chirish yumshoq (audit va cheklardagi ismlar saqlanadi).
- Filial o'chirilmaydi, faqat nofaol qilinadi (7.0.1).

## 9. API spetsifikatsiyasi

Quyida resurslar. `Perm` ustuni kerakli huquq. Hamma ro'yxat endpointlari sahifalanadi.
