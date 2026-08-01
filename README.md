# HomeFinance

A self-hosted, private web application for tracking household finances. Import bank transaction exports (CSV/OFX/QIF), categorize them (manual, rules, or AI), visualize spending across household members with ownership-weighted splits, and generate AI-assisted insights, forecasts, and subscription/anomaly detection.

**Single-household, no in-app login.** Designed to run on your own machine (Docker Compose) or a VPS behind a VPN/reverse proxy. All financial data stays in a local SQLite file; only aggregated category/amount data is sent to an AI provider, and only when AI features are enabled.

> ⚠️ **Security note:** This app has **no authentication**. Do not expose it directly to the public internet. If you deploy beyond localhost, put it behind a VPN or a reverse proxy with auth (see `docs/deployment.md`).

## Tech stack

- **Frontend:** React 18, TypeScript, Redux Toolkit (RTK Query), React Router, Tailwind CSS, shadcn/ui-style components, Recharts
- **Backend:** Node.js + Express, TypeScript, Drizzle ORM, SQLite (better-sqlite3)
- **AI:** server-side provider abstraction; default Ollama Cloud (OpenAI-compatible `/chat/completions`)
- **Scheduler:** node-cron (weekly AI digest + daily backup)
- **Tests:** Vitest
- **Container runtime:** Podman (Docker-compatible; `docker compose` works too)

## Repository layout

```
homefinance/
├── client/      React SPA (Vite)
├── server/      Express REST API + Drizzle
├── shared/      Shared TypeScript types & DTOs
├── docs/        Full documentation (see below)
└── docker-compose.yml
```

## Prerequisites

- Node.js ≥ 22 (for local dev without Docker)
- Podman + `podman compose` (or Docker + Docker Compose) for the containerized deployment

## Quick start — Podman Compose (recommended)

```bash
cp .env.example .env       # edit AI_API_KEY etc. if you want AI features
podman compose up --build
```

The app is then available at <http://localhost:4000>. The SQLite database and backups live in **named volumes** (`homefinance-db`, `homefinance-backups`) that survive image rebuilds and `podman compose down` — your data is not lost when you build a new image. Docker works identically if you prefer it (`docker compose up --build`).

## Local dev without Docker

```bash
npm install                 # installs all workspaces (client, server, shared)
cp .env.example .env
npm run build:shared        # build shared types once
npm run db:seed             # create tables + default categories
npm run dev                 # server (:4000) + client (:5173, proxies /api -> :4000)
```

Open <http://localhost:5173>. The client proxies `/api` to the Express server.

### Useful scripts

| Script | Description |
|---|---|
| `npm run dev` | Concurrent server + client dev |
| `npm run build` | Build shared, server, and client |
| `npm run start` | Run the built server (serves client from `client/dist`) |
| `npm run db:migrate` | Apply Drizzle migrations |
| `npm run db:seed` | Bootstrap tables + default categories |
| `npm run test` | Run server + client Vitest suites |
| `npm run typecheck` | Typecheck all workspaces |

## Environment variables

See [`.env.example`](./.env.example) for the full list with defaults:

- `PORT` — server port (default 4000)
- `DATABASE_URL` — SQLite path (default `./data/homefinance.sqlite`)
- `AI_ENABLED` / `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` — Ollama Cloud config; leave disabled for no external calls
- `AI_DIGEST_CRON` — weekly insight schedule (default `0 7 * * 1`, Monday 07:00)
- `BACKUP_DIR` / `BACKUP_CRON` / `BACKUP_KEEP` — daily DB backup config

## Documentation

Full documentation lives in [`docs/`](./docs):

- [docs/requirements.md](./docs/requirements.md) — source-of-truth scope (this project's requirements)
- [docs/architecture.md](./docs/architecture.md) — system architecture, folder structure, data flow
- [docs/data-model.md](./docs/data-model.md) — DB schema, relationships, migration conventions
- [docs/api.md](./docs/api.md) — REST API endpoint reference
- [docs/deployment.md](./docs/deployment.md) — Docker usage, backup/restore, VPS/HTTPS follow-up
- [docs/decisions/](./docs/decisions/) — architecture decision records (ADRs)

## License

Private / personal use.