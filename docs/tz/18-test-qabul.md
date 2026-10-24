# Test strategiyasi va qabul mezonlari

> Manba: `frontend/docs/BACKEND_TZ.md` v1.3. Bo'lim raqamlari asl TZ dagidek qoldirilgan.

Unit, integratsiya, kontrakt, E2E, yuklama va xavfsizlik testlari hamda topshirishdagi qabul mezonlari.

---

## 16. Test strategiyasi

- **Unit:** hisob-kitob funksiyalari (konversiya, narx, kesim `net`/`bars`, o'rtacha tannarx, chegirma, QQS, nasiya limiti). Frontend `lib/units.ts` va `store.ts` dagi `calcLine` bilan **bir xil kirishlar to'plamida bir xil natija** (umumiy golden-fayl test).
- **Integratsiya (haqiqiy PostgreSQL, testcontainers):** sotuv oqimlari, parallel sotuv (bir mahsulotga 20 ta bir vaqtda so'rov: qoldiq manfiyga tushmasligi), idempotentlik, smena qoidalari, huquqlar matritsasi (har endpoint × har rol), oxirgi administrator qoidasi, "ishlatilmoqda" qoidalari.
- **Kontrakt:** OpenAPI bo'yicha avtomatik tekshiruv; frontend generatsiya qilingan tiplar bilan build.
- **E2E:** asosiy foydalanuvchi oqimlari (login → smena → sotuv → chek → Z-hisobot; kirim; nasiya va qarz to'lovi).
- **Yuklama:** k6 — 10 kassa × 5 chek/daqiqa, hisobotlar bilan aralash.
- **Xavfsizlik:** huquq buzish urinishlari, IDOR, SQL in'ektsiya, rate limit, token qayta ishlatish.
- **Qoplama maqsadi:** hisob-kitob va pul modullari ≥ 90%, umumiy ≥ 75%.

## 18. Qabul mezonlari

1. Barcha 9-bo'lim endpointlari OpenAPI da hujjatlangan va ishlaydi; kontrakt testlari o'tadi.
2. Huquqlar matritsasi testi: har bir endpoint ruxsatsiz rolda `403` qaytaradi; `view_cost_price`siz javobda tannarx/foyda yo'q.
3. 20 ta parallel so'rov bir xil mahsulotga: qoldiq hech qachon manfiy bo'lmaydi (`allow_negative_stock = false` da), jami ayirilgan miqdor muvaffaqiyatli cheklar yig'indisiga teng.
4. Bir xil `Idempotency-Key` bilan 5 marta `POST /sales`: bitta chek, bitta qoldiq ayirish.
5. `stock` = Σ `stock_movements.qty_base` har bir mahsulot/variant uchun (yaxlitlik tekshiruvi skripti xatosiz).
6. `customers.total_debt` = oxirgi `debt_ledger.balance_after` barcha mijozlar uchun.
7. Hisob-kitob golden-testlari frontend bilan bir xil natija beradi (kesim `net` va `bars`, konversiyalar, chegirma, QQS, nasiya).
8. Oxirgi administratorni o'chirish/nofaol qilish/huquqini olish rad etiladi.
9. Ishlatilayotgan birlik/kategoriya/guruh/rolni o'chirish `409 in_use`.
10. Smenasiz (`require_shift = true`) sotuv rad etiladi; boshqa xodim smenasida sotish rad etiladi; Z-hisobot summalari cheklar bilan mos.
11. Mavjud brauzer ma'lumoti importi: yozuvlar soni va jami qarz/qoldiq qiymati manba bilan mos (import hisoboti).
12. Yuklama sinovi 13-bo'limdagi p95 ko'rsatkichlariga mos.
13. Zaxiradan tiklash sinovi muvaffaqiyatli o'tgan (hujjatlashtirilgan).
14. Ikkinchi filial qo'shilganda (kod o'zgarishisiz): qoldiq, smena, chek raqami va hisobotlar filial bo'yicha ajraladi, mijoz va katalog umumiy; foydalanuvchi biriktirilmagan filialga `403` oladi.
15. Production da demo foydalanuvchilar mavjud emas, HTTPS majburiy, loglarda parol/token yo'q.
