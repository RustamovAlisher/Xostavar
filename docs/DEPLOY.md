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
- `backup` xizmati har kuni `BACKUP_TIMES` soatlarida (standart 14:00 va 22:00, Toshkent) `deploy/backups/*.dump` ga yozadi, `BACKUP_KEEP_DAYS` kundan eskisini o'chiradi.
- Server tashqarisiga nusxa: lokal kompyuterda `deploy/pull-backups.sh` (rsync bilan `~/xostavar-zaxira/` ga tortadi).
- Telegram: `.env.prod` da `TELEGRAM_BOT_TOKEN` va `TELEGRAM_CHAT_ID` to'ldirilsa har zaxira guruhga fayl bo'lib boradi, xatoda ogohlantirish keladi.
- Qo'lda darhol zaxira: `./backup-now.sh`.
- Tiklash: `./restore.sh backups/<fayl>.dump`.
- Zaxirani server tashqarisiga ham nusxalang (`rsync`/`scp`) — bitta diskka ishonmang.

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
- Compose loyiha nomi `xostavar-demo`, production `xostavar` ga tegmaydi. Zaxira xizmati demo'da ishlamaydi.
