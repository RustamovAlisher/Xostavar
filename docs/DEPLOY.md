# Serverga joylash (Docker + hostdagi Nginx)

Xostavar serverdagi boshqa loyihalardan to'liq ajratilgan holda ishlaydi:
o'zining Postgres/Redis konteyneri, alohida volume va tarmoq (`xostavar_*`),
faqat `127.0.0.1:8700` da ochiladi (boshqa loyihalar 80xx–90xx portlarni ishlatadi). Tashqariga hostdagi Nginx chiqaradi.

## Tuzilma
Server papkasi (ikkala repo yonma-yon):
```
~/xostavar/backend    # backend repo
~/xostavar/frontend   # frontend repo
```

## Birinchi marta
1. Kodni joylash (private repo bo'lsa lokal kompyuterdan):
   `rsync -az --exclude node_modules --exclude dist --exclude .git backend frontend user@server:~/xostavar/`
2. `cd ~/xostavar/backend/deploy && cp .env.prod.example .env.prod` va to'ldiring
   (`openssl rand -hex 24` / `openssl rand -hex 32`). `chmod 600 .env.prod`.
3. `SKIP_PULL=1 ./deploy.sh`
4. Nginx: `nginx-site.conf.example` → `/etc/nginx/sites-available/ombor-control`,
   `ln -s` ni `sites-enabled` ga, `sudo nginx -t && sudo systemctl reload nginx`,
   so'ng `sudo certbot --nginx -d ombor-control.uz -d www.ombor-control.uz`.
5. `https://ombor-control.uz` → login `admin`, parol `ADMIN_PASSWORD`; birinchi kirishda almashtiriladi.

## Yangilash
Kodni yangilang (git pull yoki rsync), so'ng `SKIP_PULL=1 ./deploy.sh`
(yangilashdan oldin avtomatik zaxira olinadi, migratsiyalar ishga tushganda qo'llanadi).

## Zaxira va tiklash
- `backup` xizmati faqat env faylida `BACKUP_ENABLED=1` bo'lgan muhitda ishlaydi. **Hozir (2026-11-03 dan) demo'da yoqilgan, production'da o'chiq** — real mahsulotlar demo bazaga kiritilmoqda. Do'kon production'ga ko'chgach `.env.prod` da `BACKUP_ENABLED=1`, `.env.demo` da `0` qilib, ikkala muhitda `deploy.sh` / `demo.sh update` ishga tushiring (o'chiq muhitda eski `backup` konteyneri o'zi olib tashlanadi).
- Har kuni `BACKUP_TIMES` soatlarida (standart 14:00 va 22:00, Toshkent) `deploy/backups/<BACKUP_NAME>-*.dump` ga yozadi (`xostavar-*` production, `xostavar-demo-*` demo), `BACKUP_KEEP_DAYS` kundan eskisini o'chiradi.
- Telegram: env faylda `TELEGRAM_BOT_TOKEN` va `TELEGRAM_CHAT_ID` to'ldirilsa har zaxira guruhga fayl bo'lib boradi (sarlavhada `BACKUP_NAME`), xatoda ogohlantirish keladi.
- Qo'lda darhol zaxira: production `./backup-now.sh`, demo `./demo.sh backup`.
- Server tashqarisiga nusxa: lokal kompyuterda `deploy/pull-backups.sh` (ikkala muhitning zaxiralarini rsync bilan `~/xostavar-zaxira/` ga tortadi).
- Tiklash: `./restore.sh backups/<fayl>.dump` (demo: `ENV_FILE=.env.demo PROJECT=xostavar-demo ./restore.sh ...`).
- Zaxirani server tashqarisiga ham nusxalang (`rsync`/`scp`) — bitta diskka ishonmang.

## Mahsulot rasmlari
- Yuklangan rasmlar `uploads` nomli Docker volume'da (`/app/uploads`), baza bilan birga saqlanadi; `down -v` uni ham o'chiradi.
- Rasm zaxirasi: `docker run --rm -v xostavar_uploads:/u -v $PWD/backups:/b alpine tar czf /b/uploads-$(date +%F).tgz -C /u .`
- Hostdagi Nginx `client_max_body_size` kamida 5m bo'lsin (nginx-site.conf.example da 12m); brauzer rasmni ≤1600px ga kichraytirib yuboradi.
- Do'kon rasmlaridan tayyorlangan `crops/<SKU>.jpg` fayllarini SKU bo'yicha biriktirish:
  ```
  docker cp crops xostavar-demo-backend-1:/tmp/crops
  docker compose -p xostavar-demo --env-file .env.demo -f docker-compose.prod.yml exec -T backend node dist/db/import-images.js --dir /tmp/crops          # quruq rejim
  docker compose -p xostavar-demo --env-file .env.demo -f docker-compose.prod.yml exec -T backend node dist/db/import-images.js --dir /tmp/crops --apply  # saqlash (--force: borini almashtirish)
  ```

## Katalogni standartga moslash
`node dist/db/sync-catalog.js` — birliklar, kategoriyalar, o'lcham andozalari (va `--products` bilan demo mahsulotlar) ni yangi standart bilan moslaydi:
yetishmayotganini qo'shadi, noto'g'ri koeffitsientni tuzatadi, eski seed namunalarini olib tashlaydi; foydalanuvchi kiritgan mahsulotlar va narxlar saqlanadi.
Avval `--apply` siz ishga tushiring (hisobot), keyin `--apply`.

## Foydali buyruqlar
```
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f backend
```
`down -v` ni ISHLATMANG — bazani o'chiradi.

## Demo (staging) muhit
Production bilan bir xil kod, lekin alohida papka, baza, port va domen: `https://demo.ombor-control.uz`.
```
~/xostavar-demo/backend, ~/xostavar-demo/frontend   # kod nusxasi
~/xostavar-demo/backend/deploy/.env.demo            # HTTP_PORT=8701, NODE_ENV=staging, SEED_DEMO=true
```
- Ko'tarish/yangilash: `cd ~/xostavar-demo/backend/deploy && ./demo.sh update`
- Demo bazani qayta seed qilish: `./demo.sh reset` (admin / 1234, demo ma'lumot)
- Nginx + sertifikat (bir marta, sudo): `sudo bash nginx-setup.sh demo.ombor-control.uz 8701 ombor-control-demo`
- Compose loyiha nomi `xostavar-demo`, production `xostavar` ga tegmaydi.
- Zaxira: `.env.demo` da `BACKUP_ENABLED=1`, `BACKUP_NAME=xostavar-demo`, `BACKUP_TIMES`, `BACKUP_KEEP_DAYS`, `TELEGRAM_*` bo'lsa demo bazasi ham kunlik zaxiralanadi va Telegramga boradi (hozir shunday).
