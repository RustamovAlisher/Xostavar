#!/usr/bin/env bash
# Serverdagi zaxiralarni o'z kompyuteringizga tortadi (server tashqarisida ham nusxa bo'lsin).
# Ishlatish: ./pull-backups.sh      Natija: ~/xostavar-zaxira/
set -euo pipefail
SERVER="${XOSTAVAR_SERVER:-brodaradmin@31.220.85.24}"
DEST="${XOSTAVAR_BACKUP_DIR:-$HOME/xostavar-zaxira}"
mkdir -p "$DEST"
rsync -az --ignore-existing "$SERVER:~/xostavar/backend/deploy/backups/" "$DEST/"
echo "jami: $(ls "$DEST" | wc -l) ta fayl, oxirgisi: $(ls -t "$DEST" | head -1)"
