# Xodimlar, rollar va huquqlar

> Manba: `frontend/docs/BACKEND_TZ.md` v1.3. Bo'lim raqamlari asl TZ dagidek qoldirilgan.

Rollar, huquq kodlari, server tomonidagi majburiy qoidalar (oxirgi admin, o'z-o'zini o'zgartirish, filial admini cheklovlari), `users` va `roles` jadvallari, xodimlar API.

**Bog'liq qismlar:** [Autentifikatsiya va xavfsizlik](03-auth-xavfsizlik.md), [Filiallar va ikki darajali admin](05-filiallar.md)

---

## 3. Foydalanuvchilar, rollar va huquqlar

### 3.1. Standart rollar
Rollar sozlanadi (Sozlamalar > Rollar), quyidagilar boshlang'ich:

| Rol | Vazifasi |
|---|---|
| Super Admin | Hamma narsa, xodim va sozlamalar |
| Kassir | Sotuv, nasiya sotuvi, qarz to'lovi qabul qilish |
| Omborchi | Mahsulot qo'shish/tahrirlash, kirim |
| Buxgalter | Statistika, tannarx va foyda, audit, nasiya hisobi, xarajatlar |
| **Egasi / Bosh admin (Owner)** | Hamma narsa, **barcha filiallar**, ularning xodimlari, katalog, narxlar, sozlamalar, umumiy hisobotlar. Rolga `all_branches` belgisi beriladi. Frontendda bu rol hozircha "Super Admin" nomi bilan, "Bosh admin" sahifasi unga tegishli |
| **Filial admini** | **Faqat o'ziga biriktirilgan filial** ichida: kassa, ombor qoldig'i va kirim, statistika, nasiya, harakatlar tarixi, shu filial xodimlari. Katalog (mahsulot qo'shish/tahrirlash/o'chirish, narx), sozlamalar va filiallarni boshqarishga **huquqi yo'q** |

### 3.2. Huquqlar (permissions)
Frontenddagi `Permission` bilan bir xil kodlar:

| Kod | Ma'nosi |
|---|---|
| `view_pos` | Kassada sotuv qilish |
| `view_inventory` | Mahsulotlar va qoldiqni ko'rish |
| `view_analytics` | Moliya va statistika |
| `view_debts` | Mijozlar va nasiya sahifasi, qarz to'lovini qabul qilish |
| `view_audit_logs` | Harakatlar tarixi |
| `view_users` | Xodimlar ro'yxatini ko'rish |
| `add_product` | Mahsulot qo'shish |
| `edit_product` | Mahsulotni tahrirlash |
| `delete_product` | Mahsulotni o'chirish |
| `stock_in` | Kirim qilish |
| `give_debt` | Nasiyaga sotish, mijozni tahrirlash |
| `view_cost_price` | Tannarx va foydani ko'rish |
| `manage_users` | Xodimlarni qo'shish/tahrirlash/o'chirish, huquq berish, mijozni o'chirish, smenani majburan yopish |
| `manage_branches` | Filiallarni yaratish/tahrirlash/nofaol qilish, barcha filiallar umumiy ko'rinishi ("Bosh admin" sahifasi). **Faqat Egasi** |
| `manage_settings` | Sozlamalarni o'zgartirish |
| `view_expenses` | Xarajatlar va foyda-zarar hisobotini ko'rish |
| `manage_expenses` | Xarajat qo'shish/tahrirlash/o'chirish |

### 3.3. Majburiy qoidalar (server tomonida)
1. Har bir endpoint kerakli huquqni **serverda** tekshiradi. Frontenddagi yashirish xavfsizlik hisoblanmaydi.
2. `view_cost_price` bo'lmasa javobdan `costPrice`, `profit`, tannarxga oid maydonlar **olib tashlanadi** (null emas, umuman yo'q).
3. Foydalanuvchi o'z huquqini, o'z holatini (faol/nofaol) o'zgartira olmaydi va o'zini o'chira olmaydi. O'z profilini (ism, login, email, telefon, parol) tahrirlay oladi. O'z rolini o'zgartirsa faqat rol nomi yangilanadi, huquqlari o'zgarmaydi. Filial doirasidagi admin o'z filialini o'zgartira olmaydi.
4. Tizimda kamida bitta **faol** foydalanuvchi `manage_users` huquqi bilan qolishi shart. Buni buzadigan amal (o'chirish, nofaol qilish, huquqni olib tashlash) rad etiladi (409).
5. Nofaol foydalanuvchining barcha sessiyalari darhol bekor qilinadi.
6. Foydalanuvchi nomi (`username`) va email katta-kichik harfga sezgir bo'lmagan holda unikal.
7. Har bir xodimga **qaysi filiallarda ishlashi** belgilanadi (`user_branches`). Xodim faqat o'ziga biriktirilgan filiallarning ma'lumotlarini ko'radi va o'zgartiradi. Barcha filiallarni ko'ruvchi (bosh ofis) rol uchun `all_branches` belgisi.
8. **Filial doirasidagi admin** (biriktirilgan filiali bor va `manage_users` huquqi bor xodim) uchun server majburan tekshiradi (8.12):
   - faqat **o'z filiali** xodimlarini ko'radi, yaratadi, tahrirlaydi, nofaol qiladi, o'chiradi; boshqa filial xodimi uchun `403`;
   - yangi/tahrirlangan xodimning filiali majburan admin filialiga tenglanadi (so'rovdagi `branchIds` e'tiborsiz);
   - `manage_branches` va `manage_settings` huquqini yoki shu huquqlarni o'z ichiga olgan rolni (masalan Super Admin) **bera olmaydi**;
   - o'zida **yo'q** huquqni boshqaga bera olmaydi; xodimda allaqachon bor, lekin admin bera olmaydigan huquqlar saqlanib qoladi (tahrirda o'chirib yuborilmaydi);
   - harakatlar tarixi (audit) va mahsulot tarixini faqat o'z filiali yozuvlari bo'yicha ko'radi;
   - kirimni faqat o'z filialiga qila oladi.
9. `manage_branches` va `manage_settings` faqat `all_branches` roliga beriladi; boshqa rolga berishga urinish `422`.

### 7.1. Foydalanuvchilar va rollar

**`roles`** — `id`, `name` (unikal, katta-kichik sezgir emas), `permissions text[]`, `all_branches bool` (barcha filiallarni ko'radi, masalan Egasi).
**`users`** — `id`, `name`, `username` (unikal, lower), `email` (unikal, lower, nullable), `phone`, `role_id` fk, `permissions text[]` (rol shablonidan nusxa, xodimga alohida o'zgartiriladi), `password_hash`, `must_change_password bool`, `active bool`, `last_login_at`, `deleted_at`.
**`sessions`** — `id`, `user_id`, `refresh_hash`, `family_id`, `user_agent`, `ip`, `expires_at`, `revoked_at`.

Qoidalar (frontend bilan mos):
- `username`: `^[a-z0-9._-]{3,}$` (kichik harfga keltirilib saqlanadi). `name` bo'sh bo'lmaydi. `email` kiritilsa `\S+@\S+\.\S+` formatida bo'ladi. Frontend email bo'sh bo'lsa `username@temirbaza.uz` qo'yadi: backend buni qilmaydi, `email = null` saqlanadi.
- **Rol — huquqlar shabloni.** Xodim yaratilganda `permissions` roldan nusxalanadi. Rol shablonini keyin o'zgartirish mavjud xodimlarga **avtomatik qo'llanmaydi**.
- Xodimning roli o'zgarganda frontend so'raydi: huquqlarni yangi rol shabloniga moslashtirsinmi yoki joriy huquqlar qolsinmi. API da bu `PATCH /users/:id` dagi `resetPermissionsToRole: boolean` (standart `false`). Filial admini uchun natija 3.3 (8) bo'yicha filtrlanadi.

### 9.2. Xodimlar va rollar
| Metod | Yo'l | Perm |
|---|---|---|
| GET | `/users` | `view_users` |
| POST | `/users` `{name, username, email?, phone?, roleId, permissions[], active, password}` | `manage_users` |
| PATCH | `/users/:id` `{name?, username?, email?, phone?, roleId?, resetPermissionsToRole?, active?, password?, branchIds?}` (7.1) | `manage_users` (o'z huquq/holatini o'zgartirib bo'lmaydi) |
| PUT | `/users/:id/permissions` | `manage_users` |
| POST | `/users/:id/toggle-active` | `manage_users` |
| POST | `/users/:id/reset-password` | `manage_users` |
| DELETE | `/users/:id` | `manage_users` |
| GET | `/roles` | `view_users` |
