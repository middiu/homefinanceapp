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
ENV BACKUP_DIR=/backups
ENV COOKIE_SECURE=true

# Copy the built tree wholesale. npm workspaces hoists deps into the root
# node_modules and symlinks the @homefinance/shared workspace package; copying
# the whole /app preserves those symlinks/resolution so `node server/dist/index.js`
# finds express, drizzle, better-sqlite3, and @homefinance/shared. Larger image,
# but correct and simple for a self-hosted personal tool.
COPY --from=build /app .

EXPOSE 4000
# Server bootstraps tables + seeds defaults itself on boot.
CMD ["node", "server/dist/index.js"]