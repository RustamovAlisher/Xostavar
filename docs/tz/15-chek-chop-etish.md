# Chek va hujjat chop etish

> Manba: `frontend/docs/BACKEND_TZ.md` v1.3. Bo'lim raqamlari asl TZ dagidek qoldirilgan.

Kichik termo chek va A4 hujjat formatlari, qayta chop etish, chop etish talablari.

**Bog'liq qismlar:** [Sozlamalar (lug'atlar)](06-sozlamalar.md), [Kassa va sotuv](09-kassa-sotuv.md)

---

### 12.1. Chek va hujjat chop etish

Printer: **Xprinter** (termo chek printeri; odatda 58 yoki 80 mm, USB/LAN/Bluetooth, ESC/POS buyruqlarini qo'llaydi). Aniq model va chek kengligi o'rnatish paytida tasdiqlanadi.

Ikki format bo'lishi shart:

| Format | Maqsad | Mazmun |
|---|---|---|
| **Kichik chek (58/80 mm)** | Do'konda mijozga beriladigan chek | Do'kon nomi/manzil/telefon (filial bo'yicha), chek raqami, sana, kassir, mijoz, qatorlar (`miqdor birlik × narx = summa`, kesim bo'lsa o'lchamlari), Jami, Chegirma, QQS (kiritilgan), To'lov summasi, to'lov usullari, qarz bo'lsa nasiya va umumiy qarz, pastki matn, **"Ichki hisob cheki"** |
| **A4 hujjat** | Yirik mijoz/korxona uchun hisob-faktura, yuk xati ko'rinishidagi hujjat | Sarlavha (do'kon rekvizitlari), hujjat raqami va sana, xaridor, jadval (№, nomi, birlik, miqdor, narx, summa), jami, chegirma, QQS, "so'z bilan" yozilgan summa (ixtiyoriy), imzo joylari (topshirdi/qabul qildi) |

Talablar:
- Formatni tanlash: chek chiqqanda "Kichik chek" yoki "A4" tugmasi; standart format sozlamada (`default_print_format`), qog'oz kengligi (58/80 mm) va nusxalar soni sozlanadi.
- Mavjud sotuvni istalgan vaqtda qayta chop etish (`GET /sales/:id/receipt?format=thermal80|thermal58|a4`), kopiyada "NUSXA" belgisi.
- MVP: brauzer orqali chop etish (CSS `@page` bilan kichik chek va A4 o'lchami). Xprinter Windows drayveri orqali ishlaydi. Dialog chiqmasdan chop etish kerak bo'lsa (kassada tezlik uchun) brauzerni kiosk-chop etish rejimida ishga tushirish yoki lokal chop etish agenti (QZ Tray yoki shunga o'xshash) ishlatiladi. Naqd pul tortmasini ochish ESC/POS buyrug'i ham shu agent orqali, keyingi bosqichda.
- Server tomonida chek HTML/PDF shabloni (sozlanadigan logotip va matn) tayyorlanadi, frontend ham shu ma'lumot bilan chop etadi.
