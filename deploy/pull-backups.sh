#!/usr/bin/env bash
# Serverdagi zaxiralarni o'z kompyuteringizga tortadi (server tashqarisida ham nusxa bo'lsin).
# Ishlatish: ./pull-backups.sh      Natija: ~/xostavar-zaxira/  (production: xostavar-*.dump, demo: xostavar-demo-*.dump)
set -euo pipefail
SERVER="${XOSTAVAR_SERVER:-brodaradmin@31.220.85.24}"
DEST="${XOSTAVAR_BACKUP_DIR:-$HOME/xostavar-zaxira}"
mkdir -p "$DEST"
for dir in xostavar-demo xostavar; do
  rsync -az --ignore-existing "$SERVER:~/$dir/backend/deploy/backups/" "$DEST/" 2>/dev/null || echo "$dir: zaxira papkasi yo'q yoki o'qilmadi"
done
echo "jami: $(ls "$DEST" | wc -l) ta fayl, oxirgisi: $(ls -t "$DEST" | head -1)"
