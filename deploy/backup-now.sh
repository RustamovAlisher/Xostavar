#!/usr/bin/env bash
# Hozir darhol zaxira oladi (va Telegram'ga yuboradi).
# Ishlatish: ./backup-now.sh (production) yoki ./demo.sh backup (demo). Xizmat o'sha muhitda yoqilgan bo'lishi kerak.
set -euo pipefail
cd "$(dirname "$0")"
ENV_FILE="${ENV_FILE:-.env.prod}"; PROJECT="${PROJECT:-xostavar}"
grep -qE '^BACKUP_ENABLED=1' "$ENV_FILE" || { echo "$ENV_FILE da BACKUP_ENABLED=1 emas — bu muhitda zaxira xizmati o'chiq"; exit 1; }
docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f docker-compose.prod.yml exec -T backup sh /backup.sh
