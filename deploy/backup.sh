#!/bin/sh
# Konteyner ichida ishlaydi: pg_dump → /backups, Telegram'ga yuboradi, eskilarini o'chiradi.
# Muhit: DB_USER DB_NAME PGPASSWORD KEEP_DAYS BACKUP_NAME TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID
set -u
name="${BACKUP_NAME:-xostavar}"   # fayl nomi va Telegram sarlavhasi (xostavar | xostavar-demo)
until pg_isready -h postgres -U "$DB_USER" -q; do echo "postgres kutilmoqda"; sleep 5; done
f="/backups/$name-$(date +%Y%m%d-%H%M).dump"
tg() { # tg <matn>
  [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ] || return 0
  curl -sS -m 30 -o /dev/null -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
    -d chat_id="$TELEGRAM_CHAT_ID" --data-urlencode text="$1" || echo "telegram xabar yuborilmadi"
}
if pg_dump -h postgres -U "$DB_USER" -d "$DB_NAME" -Fc -f "$f"; then
  size=$(du -h "$f" | cut -f1)
  echo "zaxira: $f ($size)"
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    cap="✅ $name zaxira $(date '+%d.%m.%Y %H:%M') — $size"
    send_doc() { curl -sS -m 120 -o /tmp/tg.json -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendDocument" \
         -F chat_id="$1" -F caption="$cap" -F document=@"$f" && grep -q '"ok":true' /tmp/tg.json; }
    if send_doc "$TELEGRAM_CHAT_ID"; then
      echo "telegram: yuborildi"
    else
      # Guruh supergroup'ga aylangan bo'lsa Telegram yangi ID beradi — shunga qayta yuboramiz
      new_id=$(grep -oE '"migrate_to_chat_id":-?[0-9]+' /tmp/tg.json 2>/dev/null | cut -d: -f2)
      if [ -n "$new_id" ] && send_doc "$new_id"; then
        echo "telegram: yuborildi (guruh ID o'zgargan: $new_id — env faylda TELEGRAM_CHAT_ID=$new_id qiling)"
      else
        echo "telegram javobi: $(cat /tmp/tg.json 2>/dev/null)"
      fi
    fi
  fi
else
  echo "zaxira XATO"; rm -f "$f"
  tg "❌ $name zaxira XATO $(date '+%d.%m.%Y %H:%M') — serverni tekshiring"
fi
find /backups -name "$name-*.dump" -mtime +"$KEEP_DAYS" -delete
