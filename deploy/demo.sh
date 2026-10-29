#!/usr/bin/env bash
# Demo (staging) muhit: production bilan bir xil kod, alohida baza/port/domen. Zaxira xizmati ishlamaydi.
# Ishlatish (backend/deploy ichida):
#   ./demo.sh update   — kodni qayta qurib yangilash (deploy.sh demo rejimida)
#   ./demo.sh reset    — demo bazani O'CHIRIB qayta seed qilish (demo ma'lumot, parol 1234)
#   ./demo.sh down     — demo konteynerlarni to'xtatish (baza saqlanadi)
#   ./demo.sh status   — holat
set -euo pipefail
cd "$(dirname "$0")"
export ENV_FILE=.env.demo PROJECT=xostavar-demo SERVICES="postgres redis backend frontend"
DC=(docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f docker-compose.prod.yml)
[ -f .env.demo ] || { echo "deploy/.env.demo yo'q"; exit 1; }
unlock_users() { # demo foydalanuvchilar birinchi kirishda parol almashtirmasin
  "${DC[@]}" exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -qc "update users set must_change_password=false"' >/dev/null 2>&1 || true
}
case "${1:-status}" in
  update) SKIP_PULL=1 bash deploy.sh; unlock_users ;;
  reset)
    read -r -p "Demo baza to'liq o'chirilib qayta yaratiladi. Davom? (ha/yo'q): " ok; [ "$ok" = "ha" ] || exit 1
    "${DC[@]}" down -v; "${DC[@]}" up -d $SERVICES
    for i in $(seq 1 30); do "${DC[@]}" exec -T backend curl -fsS http://localhost:3000/health >/dev/null 2>&1 && break; sleep 2; done
    unlock_users; echo "demo qayta yaratildi (admin / 1234)";;
  down) "${DC[@]}" stop ;;
  status) "${DC[@]}" ps ;;
  *) echo "update | reset | down | status"; exit 1 ;;
esac
