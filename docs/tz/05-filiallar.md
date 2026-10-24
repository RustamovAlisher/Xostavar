# Filiallar va ikki darajali admin

> Manba: `frontend/docs/BACKEND_TZ.md` v1.3. Bo'lim raqamlari asl TZ dagidek qoldirilgan.

Ko'p filialli sxema: qaysi ma'lumot umumiy va qaysi filialga tegishli, filial ombori, filialni nofaol qilish, Bosh admin sahifasi va filial konteksti qoidalari.

**Bog'liq qismlar:** [Xodimlar, rollar va huquqlar](04-xodimlar-rollar.md), [Ombor: qoldiq, kirim, tannarx](08-ombor.md)

---

### 7.0. Filiallar (kelajak uchun asos)

**Qaror:** ma'lumotlar modeli boshidan ko'p filialli. Birinchi versiyada bitta filial yaratiladi (`code = 'main'`), shuning uchun foydalanuvchi uchun hech narsa murakkablashmaydi, lekin keyin filial qo'shish sxema o'zgartirishsiz bajariladi.

**`branches`** — `id`, `code` (unikal), `name`, `address`, `phone`, `receipt_footer` (chek pastki matni filial bo'yicha o'zgarishi mumkin), `timezone` (standart `Asia/Tashkent`), `active`, `is_main`, `created_at`. Frontend filial formasida kod maydoni yo'q (faqat nom, manzil, telefon): `code` berilmasa server nomdan avtomatik yasaydi (lotin harflar va raqamlar, katta harf, 10 belgigacha, takror bo'lsa `-2`, `-3` qo'shiladi). Kod chek raqamida ishlatilgani uchun yaratilgandan keyin o'zgarmaydi.
**`user_branches`** — `user_id`, `branch_id`, `is_default`. Rol `all_branches` bo'lsa jadval talab qilinmaydi.

Qaysi ma'lumot **umumiy**, qaysi **filialga tegishli**:

| Ma'lumot | Qamrov | Izoh |
|---|---|---|
| Mahsulot katalogi (nom, SKU, shtrix-kod, birliklar, konversiyalar, variantlar) | Umumiy | Bir marta kiritiladi, hamma filialda ko'rinadi |
| Sotish narxi (`retail_price`, `wholesale_price`) | Umumiy standart + **filial bo'yicha o'zgartirish (MVP)** | Filialda narx farq qilishi mumkin: `branch_prices` jadvali. Filialda alohida narx bo'lmasa umumiy narx ishlatiladi |
| **Qoldiq, kam qoldiq chegarasi, o'rtacha tannarx** | **Filialga tegishli** | `stock_levels` jadvali (7.3-band) |
| Kirim hujjatlari, qoldiq harakati | Filialga tegishli | `branch_id` majburiy |
| Smena | Filialga tegishli | Har filialda bir vaqtda bitta ochiq smena |
| Sotuv (chek), chek raqami | Filialga tegishli | Chek raqami filial kodi bilan: `MAIN-20261013-0001` |
| Mijozlar va ularning qarzi | Umumiy (**kelishilgan**: mijoz istalgan filialdan xarid qiladi, qarz va limit umumiy) | Mijoz istalgan filialdan xarid qila oladi, umumiy limit |
| Qarz to'lovi | Filialga tegishli (qaysi kassaga tushgani), qarzga ta'siri umumiy | `debt_ledger.branch_id` |
| Sozlamalar lug'atlari (birliklar, kategoriyalar, guruhlar, yetkazib beruvchilar, rollar) | Umumiy | |
| Biznes qoidalari | Umumiy, filial bo'yicha o'zgartirish mumkin (keyin) | `business_rules.branch_id null` = umumiy |
| Do'kon rekvizitlari (nom, manzil, telefon, chek matni) | Filialga tegishli | `branches` da |
| Audit jurnali | Umumiy, `branch_id` belgisi bilan | |

**Egasi** (`all_branches` roli) barcha filiallarni, ularning xodimlarini, smenalarini va hisobotlarini bitta ekranda ko'radi (`?branchId=all`), filial bo'yicha taqqoslaydi. Oddiy xodim faqat biriktirilgan filialni ko'radi.

### 7.0.1. Filial bilan ishlash qoidalari (frontend 1.2 bilan mos)

- **Ikki alohida ro'yxat: "Mahsulotlar bazasi" va filial "Ombori".**
  - *Mahsulotlar bazasi* (katalog) umumiy: faqat nom, o'lcham/variant, birlik, konversiya, kategoriya, narx. **Qoldiq yo'q.** Faqat katalog huquqi bor xodim (`add_product`/`edit_product`/`delete_product`, ya'ni Egasi) boshqaradi.
  - *Filial ombori* — shu filialga **kirim qilingan** mahsulotlar. Mahsulot omborda ko'rinishi uchun shu filialda `stock_levels` qatori bo'lishi shart; qator birinchi kirimda yaratiladi va keyin (qoldiq 0 bo'lsa ham) saqlanadi. Katalogda yangi mahsulot yaratish yoki tahrirlash hech bir filial omboriga mahsulot qo'shmaydi.
  - Kassa (sotuv), ombor sahifasi, kam qoldiq va statistika **faqat joriy filial ombordagi** mahsulotlar bilan ishlaydi. Omborda yo'q mahsulotni sotib bo'lmaydi (`422 not_in_branch`).
  - Yangi filialning ombori bo'sh. API: `GET /products` (katalog, qoldiqsiz), `GET /stock-levels` (joriy filial ombori, faqat `stock_levels` qatori borlar).
- **Yangi tovar kelganda** (kirim): admin ro'yxatdan **tayyor mahsulotni** (yoki variantini) tanlaydi, kelgan miqdorni yozadi va filialni belgilaydi. Mahsulot nomi/o'lchami qayta kiritilmaydi. Egasi har qanday filialga, filial admini faqat o'z filialiga kirim qiladi.
- **Yangi filial yaratilganda:** `branches` qatori, `stock_levels` bo'sh, smena yo'q. Birinchi chek uchun smena ochilishi shart (`require_shift`).
- **Filialni nofaol qilish** (`active = false`) faqat: (a) kamida bitta boshqa faol filial qolsa, (b) filialda ochiq smena bo'lmasa, (c) so'rov yuborayotgan foydalanuvchi shu filialda "joriy" bo'lmasa (server uchun: shu filial kontekstida ishlayotgan sessiya bo'lmasa shart emas, frontend bloklaydi). Aks holda `409`. Nofaol filialga biriktirilgan xodim tizimga kira olmaydi (`403 branch_inactive`), tarixiy ma'lumot saqlanadi. Filial **o'chirilmaydi**.
- **Filial nomi** (`name`) unikal (katta-kichik harfga sezgir emas), bo'sh bo'lmaydi.
- **Mijoz va nasiya umumiy:** mijoz istalgan filialdan xarid qiladi. Chek va qarz to'lovi `branch_id` bilan yoziladi.
- **Bosh admin sahifasi** (`manage_branches`): barcha filiallar bo'yicha bugungi savdo, 30 kunlik savdo, ombor qiymati (faqat `view_cost_price` bilan), omborda nechta xil tovar, smena holati, xodimlar soni. Endpoint: `GET /branches/overview` (9.0).

**Filiallararo ko'chirish (transfer)** keyingi bosqich: `stock_transfers` (`from_branch`, `to_branch`, qatorlar, holat `draft → sent → received`), qoldiq ikki filialda tranzaksiya bilan o'zgaradi.

### 8.12. Filial va admin darajalari (server qoidalari)
1. Har so'rovda **filial konteksti** aniqlanadi: `X-Branch-Id` yoki foydalanuvchining standart filiali. Kirishda standart filial: biriktirilgan filial; barcha filiallarga kirishi bor xodimda oxirgi tanlangan filial (frontend eslab qoladi), u nofaol bo'lsa birinchi faol filial. Foydalanuvchiga biriktirilmagan filial `403 branch_forbidden`. Biriktirilgan filiali bor foydalanuvchi uchun `branchId=all` rad etiladi.
2. Qoldiq, smena, chek, kirim, qarz to'lovi, audit yozuvi **faqat kontekstdagi filial** bo'yicha yoziladi va o'qiladi.
3. Savat va chek filial o'zgarganda saqlanmaydi: chek faqat bitta filialda tuziladi, `branch_id` serverda kontekstdan olinadi (klientdan qabul qilinmaydi).
4. 3.3 (8–9) qoidalari: filial doirasidagi admin cheklovlari **faqat serverda** majburlanadi, frontend ularni faqat yashiradi.
5. O'rtacha tannarx **filial bo'yicha** yuritiladi (8.6). Frontend hozir butun kompaniya qoldig'i bo'yicha bitta tannarx hisoblaydi, bu farq 14.4 da keltirilgan va qaror talab qiladi.

### 9.0. Filiallar
| Metod | Yo'l | Perm |
|---|---|---|
| GET | `/branches` | autentifikatsiyalangan (faqat o'ziga biriktirilganlar, `all_branches` bo'lsa hammasi) |
| GET | `/branches/overview?from=&to=` (har filial: bugungi savdo va cheklar soni, 30 kunlik (davr) savdo, omborda xil tovar soni (qoldig'i > 0 pozitsiyalar), ombor qiymati*, smena holati (ochiq/yopiq, kim ochgan), faol xodimlar soni; **jami** qatori: barcha filiallar bugungi va 30 kunlik savdosi, jami ombor qiymati*, faol/jami filiallar soni). Savdo = `type = sale` cheklarining `total_amount` yig'indisi | `manage_branches` (*qiymat uchun `view_cost_price`; tannarx noma'lum bo'lsa sotish narxi olinadi) |
| POST | `/branches` `{name, address?, phone?, code?}` | `manage_branches` |
| PATCH | `/branches/:id` (nom, manzil, telefon, chek matni) | `manage_branches` |
| POST | `/branches/:id/deactivate`, `/branches/:id/activate` | `manage_branches` (7.0.1 shartlari, aks holda `409`) |
| PUT | `/users/:id/branches` `{branchIds[], defaultBranchId}` | `manage_users` (filial admini uchun faqat o'z filiali, 3.3 (8)) |
| POST | `/stock-transfers` (keyingi bosqich) | `stock_in` |
