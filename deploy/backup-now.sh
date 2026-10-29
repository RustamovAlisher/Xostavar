#!/usr/bin/env bash
# Hozir darhol zaxira oladi (va Telegram'ga yuboradi). Ishlatish: ./backup-now.sh
set -euo pipefail
cd "$(dirname "$0")"
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T backup sh /backup.sh
