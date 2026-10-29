# Xostavar backend — NestJS + Drizzle (Node 22). Ikki bosqich: build (TypeScript) va yengil runtime.
FROM node:22-alpine AS build
WORKDIR /app
# argon2 native moduli uchun (prebuild bo'lmasa shu yerda kompilyatsiya qilinadi)
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
COPY drizzle ./drizzle
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production TZ=Asia/Tashkent
RUN apk add --no-cache tini curl
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY package.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD curl -fsS http://localhost:3000/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
# Har ishga tushishda: migratsiyalar → seed (idempotent: lug'atlar, birinchi admin) → API
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/db/seed.js && node dist/main.js"]
