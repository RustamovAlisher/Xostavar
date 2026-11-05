#!/usr/bin/env bash
# Zaxiradan tiklash: ./restore.sh backups/xostavar-20261029-0300.dump
# Demo uchun: ENV_FILE=.env.demo PROJECT=xostavar-demo ./restore.sh backups/xostavar-demo-....dump
# DIQQAT: joriy baza to'liq almashtiriladi. Oldin backend to'xtatiladi.
set -euo pipefail
cd "$(dirname "$0")"
FILE="${1:?dump fayl manzili kerak}"
[ -f "$FILE" ] || { echo "fayl topilmadi: $FILE"; exit 1; }
read -r -p "Baza '$FILE' dan TO'LIQ qayta tiklanadi. Davom etilsinmi? (ha/yo'q): " ok
[ "$ok" = "ha" ] || exit 1
DC=(docker compose -p "${PROJECT:-xostavar}" --env-file "${ENV_FILE:-.env.prod}" -f docker-compose.prod.yml)
"${DC[@]}" stop backend
"${DC[@]}" exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
"${DC[@]}" exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges' < "$FILE"
"${DC[@]}" start backend
echo "tiklandi: $FILE"
