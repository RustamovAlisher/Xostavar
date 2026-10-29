#!/usr/bin/env bash
# Serverda yangilash: ikkala repodan yangi kodni olib, konteynerlarni qayta quradi va ishga tushiradi.
# Ishlatish: cd backend/deploy && ./deploy.sh   (SKIP_PULL=1 ./deploy.sh — git pull qilmasdan)
set -euo pipefail
cd "$(dirname "$0")"

# Standart: production (.env.prod, loyiha xostavar). Demo: ENV_FILE=.env.demo PROJECT=xostavar-demo SERVICES="postgres redis backend frontend"
ENV_FILE="${ENV_FILE:-.env.prod}"; PROJECT="${PROJECT:-xostavar}"; SERVICES="${SERVICES:-}"
export ENV_FILE
[ -f "$ENV_FILE" ] || { echo "deploy/$ENV_FILE yo'q — .env.prod.example dan nusxa olib to'ldiring"; exit 1; }

FILES=(-p "$PROJECT" --env-file "$ENV_FILE" -f docker-compose.prod.yml)

echo "== Kod yangilanmoqda"
# SKIP_PULL=1 — kod rsync bilan yuborilgan bo'lsa (git ishlatilmaydi)
if [ -z "${SKIP_PULL:-}" ]; then
  git -C .. pull --ff-only
  git -C ../../frontend pull --ff-only
fi
[ -f ../../frontend/Dockerfile ] || { echo "../../frontend topilmadi — frontend backend bilan yonma-yon bo'lishi kerak"; exit 1; }

echo "== Zaxira (yangilashdan oldin)"
mkdir -p backups
if docker compose "${FILES[@]}" ps --status running postgres >/dev/null 2>&1; then
  docker compose "${FILES[@]}" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "backups/$PROJECT-pre-deploy-$(date +%Y%m%d-%H%M).dump" || echo "zaxira olinmadi (birinchi ishga tushirish bo'lsa normal)"
fi

echo "== Qurish va ishga tushirish"
docker compose "${FILES[@]}" build --pull $SERVICES
docker compose "${FILES[@]}" up -d --remove-orphans $SERVICES

echo "== Backend sog'ligi kutilmoqda"
for i in $(seq 1 30); do
  if docker compose "${FILES[@]}" exec -T backend curl -fsS http://localhost:3000/health >/dev/null 2>&1; then echo "backend tayyor"; break; fi
  sleep 2
  [ "$i" = 30 ] && { echo "backend 60 s da ko'tarilmadi — loglar:"; docker compose "${FILES[@]}" logs --tail=50 backend; exit 1; }
done

docker compose "${FILES[@]}" ps
