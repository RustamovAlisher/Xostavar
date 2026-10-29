#!/bin/sh
# Konteyner ichida ishlaydi: pg_dump → /backups, Telegram'ga yuboradi, eskilarini o'chiradi.
# Muhit: DB_USER DB_NAME PGPASSWORD KEEP_DAYS TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID
set -u
until pg_isready -h postgres -U "$DB_USER" -q; do echo "postgres kutilmoqda"; sleep 5; done
f="/backups/xostavar-$(date +%Y%m%d-%H%M).dump"
tg() { # tg <matn>
  [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ] || return 0
  curl -sS -m 30 -o /dev/null -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
    -d chat_id="$TELEGRAM_CHAT_ID" --data-urlencode text="$1" || echo "telegram xabar yuborilmadi"
}
if pg_dump -h postgres -U "$DB_USER" -d "$DB_NAME" -Fc -f "$f"; then
  size=$(du -h "$f" | cut -f1)
  echo "zaxira: $f ($size)"
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    cap="✅ Xostavar zaxira $(date '+%d.%m.%Y %H:%M') — $size"
    if curl -sS -m 120 -o /tmp/tg.json -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendDocument" \
         -F chat_id="$TELEGRAM_CHAT_ID" -F caption="$cap" -F document=@"$f"; then
      grep -q '"ok":true' /tmp/tg.json && echo "telegram: yuborildi" || { echo "telegram javobi: $(cat /tmp/tg.json)"; }
    else
      echo "telegram: yuborilmadi"
    fi
  fi
else
  echo "zaxira XATO"; rm -f "$f"
  tg "❌ Xostavar zaxira XATO $(date '+%d.%m.%Y %H:%M') — serverni tekshiring"
fi
find /backups -name 'xostavar-*.dump' -mtime +"$KEEP_DAYS" -delete
