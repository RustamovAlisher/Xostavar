#!/usr/bin/env bash
# Hostdagi Nginx ga sayt qo'shadi va Let's Encrypt sertifikat oladi. Boshqa saytlarga tegmaydi.
# Ishlatish:  sudo bash nginx-setup.sh                                   (production: ombor-control.uz → 8700)
#             sudo bash nginx-setup.sh demo.ombor-control.uz 8701 ombor-control-demo   (demo)
set -euo pipefail
DOMAIN="${1:-ombor-control.uz}"; PORT="${2:-8700}"; NAME="${3:-ombor-control}"
SITE=/etc/nginx/sites-available/$NAME
cd "$(dirname "$0")"
[ "$(id -u)" = 0 ] || { echo "sudo bilan ishga tushiring: sudo bash nginx-setup.sh"; exit 1; }

echo "== 1/4 sayt fayli"
[ -f "$SITE" ] && cp "$SITE" "$SITE.bak.$(date +%s)"
sed -e "s/ombor-control.uz www.ombor-control.uz/$DOMAIN/" -e "s/127.0.0.1:8700/127.0.0.1:$PORT/" nginx-site.conf.example > "$SITE"
ln -sfn "$SITE" /etc/nginx/sites-enabled/$NAME

echo "== 2/4 nginx tekshiruv va reload"
nginx -t
systemctl reload nginx
curl -fsS -H "Host: $DOMAIN" http://127.0.0.1/healthz && echo " (80-port orqali ishlayapti)"

echo "== 3/4 sertifikat (Let's Encrypt)"
WWW=(); [ "$NAME" = "ombor-control" ] && WWW=(-d "www.$DOMAIN")
certbot --nginx -d "$DOMAIN" "${WWW[@]}" --redirect --non-interactive --agree-tos --register-unsafely-without-email || \
  { echo "certbot xato — DNS hali tarqalmagan bo'lishi mumkin, 30 daqiqadan keyin qayta: sudo bash nginx-setup.sh $DOMAIN $PORT $NAME"; exit 1; }

echo "== 4/4 tekshiruv"
nginx -t && systemctl reload nginx
curl -fsS "https://$DOMAIN/api/health" && echo
echo "TAYYOR: https://$DOMAIN"
