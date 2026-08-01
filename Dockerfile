# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Build tools for better-sqlite3 native compile (prebuilds usually exist, this is a safety net).
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy workspace manifests first for layer caching
COPY package.json package-lock.json* ./
COPY client/package.json ./client/
COPY server/package.json ./server/
COPY shared/package.json ./shared/
RUN npm install --workspaces --include-workspace-root

# Copy sources and build
COPY shared/ ./shared/
COPY client/ ./client/
COPY server/ ./server/
RUN npm run build

# ---- Runtime ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV DATABASE_URL=/data/homefinance.sqlite
ENV BACKUP_DIR=/data/backups

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/client/node_modules ./client/node_modules
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist
COPY --from=build /app/server/drizzle ./drizzle
COPY package.json ./package.json
COPY server/package.json ./server/package.json

# better-sqlite3 native lib needs no extra runtime deps on bookworm-slim; if it fails,
# install python3/make/build-essential in build stage (already built into node_modules here).

EXPOSE 4000
# Server bootstraps tables + seeds defaults itself.
CMD ["node", "server/dist/index.js"]