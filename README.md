# HomeFinance

A self-hosted, private web application for tracking household finances. Import bank transaction exports (CSV/OFX/QIF), categorize them (manual, rules, or AI), visualize spending across household members with ownership-weighted splits, and generate AI-assisted insights, forecasts, and subscription/anomaly detection.

**Single-household, single-user login.** Designed to run on your own machine (Docker Compose) or a VPS. All financial data stays in a local SQLite file; only aggregated category/amount data is sent to an AI provider, and only when AI features are enabled.

> 🔐 **Authentication:** Single-user login — one `admin` account (argon2id-hashed password, forced reset on first login), HttpOnly session cookies, and brute-force protection (IP rate-limit + account lockout). For public exposure, still terminate TLS at a reverse proxy and prefer a network perimeter (VPN) as defense in depth (see `docs/deployment.md`).

## Tech stack

- **Frontend:** React 18, TypeScript, Redux Toolkit (RTK Query), React Router, Tailwind CSS, shadcn/ui-style components, Recharts
- **Backend:** Node.js + Express, TypeScript, Drizzle ORM, SQLite (better-sqlite3)
- **AI:** server-side provider switch — Ollama (default), Grok via the xAI API, or a Cursor catalogue model. API keys stay on the server. Grok and Cursor hosts are pinned.
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

On first load you'll be prompted to sign in. The default credentials are **`admin` / `Pa$$word!`**, and you are **forced to choose a new password** (min 12 characters) before reaching the app. Set `ADMIN_INITIAL_PASSWORD` in `.env` before first boot if you want a different starting password.

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
- `AI_ENABLED` / `AI_PROVIDER` / `AI_BASE_URL` / `AI_API_KEY` / `AI_GROK_API_KEY` / `AI_CURSOR_API_KEY` / `AI_MODEL` — provider config; leave AI disabled for no external calls
- `AI_DIGEST_CRON` — weekly insight schedule (default `0 7 * * 1`, Monday 07:00)
- `BACKUP_DIR` / `BACKUP_CRON` / `BACKUP_KEEP` — daily DB backup config
- `ADMIN_INITIAL_PASSWORD` — initial admin password (seeded once on first boot; default `Pa$$word!`; change on first login — forced)
- `SESSION_TTL_MS` / `AUTH_MAX_FAILS` / `AUTH_LOCKOUT_MS` / `COOKIE_SECURE` / `CORS_ORIGIN` — auth tuning (see `.env.example`)

## Authentication

HomeFinance uses **single-user authentication** — one `admin` account, no multi-user or profiles.

- **First login**: sign in with `admin` / `ADMIN_INITIAL_PASSWORD` (default `Pa$$word!`); you are forced to set a new password (min 12 chars) immediately. After that, the env var has no effect — change the password from the in-app *Change password* page (sidebar footer → Sign out is also there).
- **Passwords** are hashed with **argon2id** (memory-hard, GPU-resistant) — never stored or sent in cleartext.
- **Sessions** are opaque tokens in **HttpOnly + SameSite=Lax + Secure** cookies; only a SHA-256 hash of the token is stored in the DB, so a database leak doesn't expose live sessions. Sessions are revocable and persist across restarts. Changing your password invalidates all other sessions.
- **Brute-force protection**: the login endpoint is rate-limited per IP (10 attempts / 15 min) and the account **locks** after `AUTH_MAX_FAILS` failed attempts (progressive delay, capped 30 min).
- For public exposure, terminate **TLS** at a reverse proxy (so the `Secure` cookie is encrypted in transit) and prefer a network perimeter (VPN). See [`docs/deployment.md`](./docs/deployment.md).

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