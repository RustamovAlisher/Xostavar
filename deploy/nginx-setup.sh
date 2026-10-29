#!/usr/bin/env bash
# Hostdagi Nginx ga ombor-control.uz saytini qo'shadi va Let's Encrypt sertifikat oladi.
# Boshqa saytlarga tegmaydi. Ishlatish:  sudo bash nginx-setup.sh
set -euo pipefail
DOMAIN=ombor-control.uz
SITE=/etc/nginx/sites-available/ombor-control
cd "$(dirname "$0")"
[ "$(id -u)" = 0 ] || { echo "sudo bilan ishga tushiring: sudo bash nginx-setup.sh"; exit 1; }

echo "== 1/4 sayt fayli"
[ -f "$SITE" ] && cp "$SITE" "$SITE.bak.$(date +%s)"
cp nginx-site.conf.example "$SITE"
ln -sfn "$SITE" /etc/nginx/sites-enabled/ombor-control

echo "== 2/4 nginx tekshiruv va reload"
nginx -t
systemctl reload nginx
curl -fsS -H "Host: $DOMAIN" http://127.0.0.1/healthz && echo " (80-port orqali ishlayapti)"

echo "== 3/4 sertifikat (Let's Encrypt)"
certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --redirect --non-interactive --agree-tos --register-unsafely-without-email || \
  { echo "certbot xato — DNS hali tarqalmagan bo'lishi mumkin, 30 daqiqadan keyin qayta: sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN --redirect"; exit 1; }

echo "== 4/4 tekshiruv"
nginx -t && systemctl reload nginx
curl -fsS "https://$DOMAIN/api/health" && echo
echo "TAYYOR: https://$DOMAIN"
