# Autentifikatsiya va xavfsizlik

> Manba: `frontend/docs/BACKEND_TZ.md` v1.3. Bo'lim raqamlari asl TZ dagidek qoldirilgan.

Login, tokenlar, sessiyalar, parollar, rate limit va umumiy xavfsizlik talablari.

**Bog'liq qismlar:** [Xodimlar, rollar va huquqlar](04-xodimlar-rollar.md)

---

## 6. Autentifikatsiya va xavfsizlik

### 6.1. Kirish
- `POST /auth/login` `{ username | email, password }` → `{ accessToken, refreshToken, user }`.
- Access token: JWT, 15 daqiqa. Refresh token: tasodifiy, 30 kun, bazada **hash** ko'rinishida saqlanadi, har ishlatilganda aylantiriladi (rotation), qayta ishlatilsa butun oila bekor qilinadi.
- `POST /auth/refresh`, `POST /auth/logout` (joriy sessiya), `POST /auth/logout-all`.
- `GET /auth/me` — joriy foydalanuvchi va huquqlar.
- Qurilma/sessiyalar ro'yxati: `GET /auth/sessions`, `DELETE /auth/sessions/:id`.

### 6.2. Parollar
- Argon2id (yoki bcrypt cost ≥ 12). Frontenddagi SHA-256 + salt faqat vaqtinchalik demo, serverda ishlatilmaydi.
- Minimal 8 belgi (hozirgi frontend 4; ishlab chiqarishda 8 ga oshiriladi), ro'yxatdagi mashhur parollar taqiqlanadi.
- Birinchi kirishda demo parolni majburan almashtirish (`mustChangePassword`).
- Ketma-ket 5 ta noto'g'ri urinishdan keyin 15 daqiqaga bloklash (login + IP bo'yicha), `429`.

### 6.3. Umumiy xavfsizlik
- Faqat HTTPS (HSTS). CORS faqat ruxsat etilgan frontend domenlari.
- Rate limit: umumiy 300 so'rov/daqiqa/foydalanuvchi, login 10/daqiqa/IP.
- Kirish ma'lumotlari DTO validatsiyasi (class-validator/zod), SQL faqat parametrlangan.
- Javoblarda parol, hash, salt hech qachon qaytmaydi.
- Maxfiy sarlavhalar va parollar loglarga yozilmaydi.
- Zaxira nusxalar shifrlanadi.
- Xavfsizlik sarlavhalari (helmet), `Content-Security-Policy`.
- Demo foydalanuvchilar (`admin/1234`) **faqat** `local` va `staging` muhitida seed bilan yaratiladi, `production` da yo'q.

### 9.1. Auth
| Metod | Yo'l | Izoh |
|---|---|---|
| POST | `/auth/login` | public |
| POST | `/auth/refresh` | refresh token |
| POST | `/auth/logout`, `/auth/logout-all` | |
| GET | `/auth/me` | joriy foydalanuvchi, huquqlar, biriktirilgan filiallar, tanlangan filialdagi smena holati |
| POST | `/auth/change-password` | joriy va yangi parol |
| GET/DELETE | `/auth/sessions`, `/auth/sessions/:id` | |
