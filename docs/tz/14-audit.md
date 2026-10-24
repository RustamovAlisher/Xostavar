# Audit jurnali

> Manba: `frontend/docs/BACKEND_TZ.md` v1.3. Bo'lim raqamlari asl TZ dagidek qoldirilgan.

Audit jadvali, qaysi hodisalar yoziladi, audit API va filial bo'yicha cheklov.

**Bog'liq qismlar:** [Xodimlar, rollar va huquqlar](04-xodimlar-rollar.md), [Filiallar va ikki darajali admin](05-filiallar.md)

---

### 7.8. Audit

**`audit_logs`**: `id`, `ts`, `branch_id null`, `user_id`, `user_name`, `user_role` (nusxa), `action` (`add`|`edit`|`delete`|`stock_in`|`sale`|`debt_payment`|`user_update`; backendda qo'shimcha: `shift_open`, `shift_close`, `sale_void`, `stock_adjust`, `settings_reset`, `password_reset`. Frontend hozir smena yopilishini `edit` + `Kassa`, sozlamalarni `edit` + `Sozlamalar` deb yozadi; import paytida shunday qoladi, frontend yangi kodlarni "Boshqa" sifatida ko'rsatadi), `module` (`Mahsulotlar`|`Kassa`|`Nasiya / Qarz`|`Xodimlar`|`Filiallar`|`Sozlamalar`), `target_id`, `target_name`, `details text`, `diff jsonb` (`{before, after}`), `ip`, `request_id`. Faqat qo'shiladi, o'zgartirilmaydi va o'chirilmaydi. Indeks: (`ts desc`), (`module`, `ts`), (`target_id`).

## 11. Audit va jurnal

Audit yoziladigan hodisalar: mahsulot qo'shish/tahrirlash/o'chirish (oldin/keyin farq bilan), kirim, sotuv, storno, qarz to'lovi, mijoz yaratish/tahrirlash/o'chirish, xodim qo'shish/o'zgartirish/huquq/holat/o'chirish, parol almashtirish va tiklash, sozlamalar saqlash/tiklash, smena ochish/yopish, muvaffaqiyatsiz kirish urinishlari (alohida xavfsizlik jurnali), qoldiqni qo'lda tuzatish.

Audit yozuvi biznes tranzaksiyasi bilan **bir tranzaksiyada** yoziladi (yoki outbox orqali kafolatlangan). Saqlash muddati: kamida 3 yil.

### 9.10. Audit
`GET /audit-logs?module=&action=&userId=&branchId=&q=&from=&to=` (`view_audit_logs`), faqat o'qish. `q` obyekt nomi, xodim ismi va tafsilot matni bo'yicha qidiradi. Javobda `facets.byAction` (har amal turi bo'yicha yozuvlar soni, filtr tugmalaridagi sonlar uchun) va `total`. Frontend 200 tadan "Yana ko'rsatish" bilan yuklaydi (kursor sahifalash). Biriktirilgan filiali bor foydalanuvchiga javob **majburan** shu filial yozuvlari bilan cheklanadi (`branch_id` bo'sh yozuvlar ham ko'rsatilmaydi); `branchId` boshqa filialni so'rasa `403`.
