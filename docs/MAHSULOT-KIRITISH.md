# Real mahsulotlarni kiritish yo'riqnomasi (ikki kompyuterdan parallel)

Maqsad: do'kondagi har bir mahsulotni rasmidan aniqlab, demo serverga (`https://demo.ombor-control.uz`) to'g'ri
kategoriya, birlik, variant va narx bilan kiritish va internetdan professional rasmini biriktirish.
Ikkala kompyuter ham **bitta bazaga** (demo) yozadi — lokal bazaga emas. Keyin demo → production ko'chiriladi.

## 1. Tayyorgarlik (har kompyuterda bir marta)

```
git -C backend pull            # tools/addprod.py va shu yo'riqnoma
export XOSTAVAR_API=https://demo.ombor-control.uz/api/v1
export XOSTAVAR_LOGIN=<sizga berilgan login>       # 1-kompyuter: admin, 2-kompyuter: laptop2
export XOSTAVAR_PASSWORD=<parol>
python3 backend/tools/addprod.py settings          # kategoriya, birlik, andozalarni ko'rish — ulanish tekshiruvi
```
Rasmlar `real-mahsulotlar-rasimlari/` papkasida; fayl nomida mahsulot nomi va narx bo'ladi
(masalan `numix-reliance-narx:100,000.jpg` → narx 100 000 so'm). Rasm papkasi git'ga kirmaydi.

## 2. Har bir rasm uchun tartib

1. **Rasmni ko'rib aniqlash**: brend, seriya, tur, o'lcham/hajm, rang kodi, yorliqdagi matn. Fayl nomidagi narx = chakana narx.
2. **Dublikat tekshiruvi** (majburiy): `addprod.py search "<brend yoki nom>"`. Topilsa — qo'shilmaydi, kerak bo'lsa `update`.
3. **Internetdan ma'lumot**: hajm/o'lcham, texnik tavsif (qisqa), rasm. Manba: ishlab chiqaruvchi sayti, uzum/olcha/wert/stroyka kabi do'konlar.
4. **spec.json yozish** (namuna pastda) va `addprod.py add spec.json`. 409 `duplicate_code` kelsa — SKU band, `search` bilan tekshiring.
5. **Rasm**: `"image"` maydoni (URL yoki fayl) bilan `add` da, yoki keyin `addprod.py image <SKU> <URL|fayl>`.
6. **Hisobot**: nom, kategoriya, SKU, variantlar va narx, rasm manbasi, tasdiqlanmagan narsalar (hajm, rang nomi).
7. **Rasmni ajratish** (adashmaslik uchun): ishlov berilgan rasm(lar) `real-mahsulotlar-rasimlari/qoshilgan/` ga SKU prefiksi bilan ko'chiriladi:
   `addprod.py done NUMIX-REL real-mahsulotlar-rasimlari/photo_1.jpg real-mahsulotlar-rasimlari/photo_2.jpg`
   → `qoshilgan/NUMIX-REL__photo_1.jpg`. Asosiy papkada faqat hali kiritilmagan rasmlar qoladi.

## 3. Qoidalar

**Nom** — lotin, o'zbekcha, aniq: `Brend Seriya — mahsulot turi (qo'shimcha)`. Masalan
`Numix Reliance molotkovaya bo'yoq (bolg'a effektli emal)`, `Akfix 310 silikon germetik 280 ml`. Hajm/o'lcham variantda bo'lmasa — nomda.

**SKU** — faqat `A-Z`, `0-9`, `-`; `BREND-SERIYA` (mahsulot), variant `BREND-SERIYA-KOD` (rang kodi, o'lcham, hajm):
`NUMIX-REL` / `NUMIX-REL-407`, `AKFIX-310` / `AKFIX-310-OQ`, `ARM` / `ARM-12`. Brend bo'lmasa tur bo'yicha: `KRAN-SHAR` / `KRAN-SHAR-15`.
Bir xil qoida ikkala kompyuterda — shunda bir mahsulot ikki xil SKU bilan ikki marta tushmaydi.

**Kategoriya** — mavjud 16 tadan tanlanadi (`settings` buyrug'i). Yangi kategoriya, birlik yoki o'lcham andozasi
**faqat 1-kompyuterdan** qo'shiladi (sozlamalar butun ro'yxat sifatida saqlanadi — ikki tomondan o'zgartirilsa biri yo'qoladi).
2-kompyuter kerak bo'lsa hisobotda "yangi kategoriya/andoza kerak: …" deb yozadi.

**Birlik** — mahsulot qanday sotilsa shu: `piece` (dona), `kg`, `meter`, `m2`, `liter`, `bag` (qop), `box` (quti), `roll`, `pack`, `pair`, `set`.
Prokat (armatura, truba, ugolok, shveller) — `meter`, `isDivisible: true`, kategoriya shabloni `piece` (hlыst) konversiyasini beradi, variantga `kg` koeffitsienti qo'shiladi
(`factor` = 1 kg necha metr, ya'ni 1 / (kg/m)). Qadoqli tovar — `piece`, qadoq `conversions: [{"unit":"box","factor":12}]` (1 quti = 12 dona).

**Variantlar** — rang kodi, o'lcham, hajm, quvvat bo'yicha farqlansa `isVariable: true`; har variantga nom, SKU, narx.
Bitta turdagi tovar bo'lsa `isVariable: false` va `retailPrice`. Narx butun son (so'm).

**Tavsif** — 1–3 jumla: nima uchun, qayerda ishlatiladi, asosiy texnik raqamlar (sarf, qurish vaqti, GOST). Marketing matni yozilmaydi.

**Rasm** — professional (ishlab chiqaruvchi yoki do'kon sayti), oq/toza fonda, kamida 600 px; sotuvchi logotipi, telefon, narx yozuvi bo'lmasin
(bo'lsa kesib tashlanadi). Do'konda olingan surat faqat aniqlash uchun, bazaga yuklanmaydi. Format JPEG/PNG/WebP, 8 MB gacha.

**Noaniqlik** — hajm, rang nomi yoki o'lcham tasdiqlanmasa mahsulot baribir qo'shiladi, hisobotda "tasdiqlash kerak" deb belgilanadi.

## 4. spec.json namunalari

Variantli (rang kodlari):
```json
{
  "categoryName": "Bo'yoqlar",
  "name": "Numix Reliance molotkovaya bo'yoq (bolg'a effektli emal)",
  "sku": "NUMIX-REL", "baseUnit": "piece", "isDivisible": false, "conversions": [],
  "description": "Metall va rux yuzalar uchun antikorroziya emal; zang o'zgartirgich + grunt + emal bitta idishda. 2 qatlam, 20 °C da 2 soatda quriydi, sarfi 130–150 g/m².",
  "isVariable": true,
  "variants": [{ "name": "407 (mis tus)", "sku": "NUMIX-REL-407", "retailPrice": 100000 }],
  "image": "https://example.uz/numix-reliance.jpg"
}
```
Variantsiz, qadoqli:
```json
{
  "categoryName": "Xo'jalik mollari",
  "name": "Montaj lentasi perforatsiyali 20 mm (25 m)",
  "sku": "MLENT-20", "baseUnit": "roll", "isDivisible": false,
  "conversions": [{ "unit": "box", "factor": 20 }],
  "isVariable": false, "retailPrice": 45000,
  "image": "/home/user/rasm.jpg"
}
```

## 5. Konfliktlarning oldini olish

- Rasmlar ikki papkaga **takrorlanmasdan** bo'linadi; bir mahsulot ikki kompyuterga tushmaydi.
- `add` dan oldin `search` — majburiy; o'xshash nom topilsa skript o'zi to'xtaydi (`--force` faqat ongli ravishda).
- SKU va shtrix-kod tizim bo'ylab yagona — takror bo'lsa server 409 qaytaradi, ikkita nusxa paydo bo'lmaydi.
- Sozlamalar (kategoriya/andoza/birlik) faqat 1-kompyuterdan o'zgartiriladi.
- Har kompyuter o'z logini bilan ishlaydi (audit jurnalida kim qo'shgani ko'rinadi).

## 6. Keyin: demo → production

`docs/DEPLOY.md` dagi "Lokal → demo" usuli bilan: demo bazasi `pg_dump -Fc` + `uploads` volume → production'ga tiklash.
Bu production'dagi foydalanuvchilar va parollarni ham almashtiradi — ko'chirgandan keyin admin parolini darhol o'zgartiring.
