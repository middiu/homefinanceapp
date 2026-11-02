# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Self-hosted personal household-finance app. Import bank exports (CSV/OFX/QIF), categorize (manual / rule engine / AI), visualize spending with ownership-weighted member splits, and generate AI insights/forecasts/anomaly+subscription detection. Single implicit household, **single-user auth** (one `admin` user, argon2id-hashed password, opaque HttpOnly SameSite session cookies, forced password reset on first login, brute-force protected via IP rate-limit + account lockout). TLS + a network perimeter are still recommended for public exposure (see `docs/deployment.md`).

## Commands

```bash
npm install                 # installs all workspaces (client, server, shared)
npm run build:shared        # MUST build shared before server/client typecheck or dev (shared consumed as @homefinance/shared)
npm run db:seed             # create tables (bootstrap) + seed default categories & rules
npm run dev                 # server (:4000) + client (:5173, Vite proxies /api -> :4000)
npm run typecheck           # shared -> server -> client, in order
npm run test                # server vitest + client vitest
npm run build               # shared -> server (tsc) -> client (tsc -b + vite)

# Single test / filtered
npm -w server run test -- src/__tests__/ai.test.ts          # one file
npx vitest run -t "normalizeHost"                          # by test name (run from server/)

# DB
npm run db:generate         # drizzle-kit generate migrations from schema.ts
npm run db:migrate          # apply generated migrations
```

Local dev uses `./data/homefinance.sqlite` (DATABASE_URL default). The containerized deploy uses a podman named volume (`homefinance-db` at `/data` inside the container) — a **separate database** from the host `./data` path.

### Deploy / rebuild (podman)

Named volumes `homefinance-db` + `homefinance-backups` persist across rebuilds and `podman compose down` — they are **not** removed unless you `podman volume rm` them. To deploy code changes:

```bash
podman compose up --build -d     # rebuild image, recreate container, KEEP volumes + data
podman ps                         # verify Up
curl -s http://localhost:4000/api/ai/status   # smoke-test API
```

Do **not** run `podman compose down -v` or `podman volume rm homefinance-db` — the `-v`/volume-rm flags delete the DB volume. A plain `down` is safe (volumes untouched). The host `./data/` path is local-dev only and is never read by the container.

**After any code change**, rebuild the container so the running image matches the repo (typecheck + tests first, then rebuild):

```bash
npm run build:shared && npm run typecheck && npm run test
podman compose up --build -d     # rebuild image, recreate container, KEEP volumes + data
podman image prune -f            # remove dangling <none> images left from the old build
podman ps                         # verify Up
curl -s http://localhost:4000/api/ai/status   # smoke-test API
```

`podman image prune -f` drops the dangling intermediate/old-tagged images (the `<none>:<none>` entries from prior builds) — it does **not** touch the current `homefinance-homefinance:latest` image, the `node` base image, or any volume. Run it after every rebuild so stale images don't accumulate on disk.

## Architecture

npm workspaces monorepo: `client/`, `server/`, `shared/`.

- **shared/** (`@homefinance/shared`): DTOs + string-literal union "enums" (deliberately *not* TS enums — see `docs/decisions/0004`). Server and client both import it; client imports only types. Build `shared` first or typecheck fails.
- **server/**: Express + Drizzle ORM + better-sqlite3 (WAL). Routes are thin REST routers in `routes/`; logic lives in `services/`. `db/schema.ts` is the Drizzle schema source of truth; `db/bootstrap.ts` idempotently creates tables so the app boots without running migrations first (two DDL paths coexist — migrations are preferred, bootstrap is the fallback). `config.ts` reads env into typed config. `index.ts` wires routers + node-cron schedulers (weekly AI digest, daily backup, daily price snapshot) + serves the built client in production.
- **client/**: React 18 + Vite + RTK Query. **All API endpoints are defined in one place: `src/app/api.ts`** (RTK Query `createApi`), with hooks auto-generated and exported at the bottom. Add/change an endpoint there, not ad hoc. Components: `ui/` are shadcn-style primitives; `components/common.tsx` has `PageHeader`/`Money`/`EmptyState`; `pages/` are route screens. Tailwind config aliases `@/` -> `src/`. Locale formatting (AUD en-AU, dates) centralized in `client/src/lib/utils.ts` and `server/src/utils.ts` — don't hand-roll currency/date strings.

### Categorization (core flow)

Three tiers, applied in this precedence:
1. **Manual** — inline/bulk edit sets `categoryId`, `source='manual'`, clears `needs_review`.
2. **Rule engine** (`services/rules.ts`) — priority-ordered match on `rawDescription` (not the normalized `description`) + optional amount range. Rule **priority bands**: manual ≤999, ai_generated 2000–2999, seeded generic ≥3000. Lower priority matched first. AI categorization derives a pattern (`deriveMatchPattern`) and creates/updates an `ai_generated` rule so future imports don't need AI. Never overwrite a manual/seeded rule.
3. **AI** (`services/ai.ts`) — only description + amount sent (privacy: never account numbers/balances/raw dumps). Sets `source='ai_auto'`, `needsReview=true`.

### AI privacy boundary (§4.5)

The AI provider is a **remote service** selected in settings: Ollama (default), Grok (xAI), or Cursor. Only the bare minimum leaves the server — never account numbers, balances, raw dumps, or personal names. Three egress shapes:
- **Insight / forecast / forecast-report** send **aggregates and statistical numbers only** (category totals, monthly net, projection figures). No transaction text.
- **Categorization** (import auto-categorize + re-categorize) sends **one sanitized descriptor + the amount** per transaction. `sanitizeForAi()` (`services/ai.ts`) strips account/card/reference numbers (runs of 4+ digits), BSB, and card groups, collapses whitespace, caps at 80 chars — preserving only the merchant words needed to identify the shop.
- **Web search** (`aiWebSearch`) sends the **same sanitized descriptor** + "merchant shop australia".

Transfers (`isTransfer`) are **skipped for AI** in re-categorize — their memos may carry recipient names/bank strings and they need no merchant identification. On import, transfers are linked post-import so AI runs first; sanitization removes the banking digits, and the residual merchant/recipient words are the irreducible minimum for usefulness. `apiKey` is server-side only and never sent to the client.

**Dedup:** `dedupHash = hash(accountId + date + amount + description + optional time)` on every transaction; import commit skips rows whose hash already exists. `time` (nullable `HH:mm:ss`) is extracted when the export carries it — OFX `DTPOSTED` digits after the date, a mapped CSV `time` column — via `parseTime()`, which normalizes `9:30`/`1030` → `09:30:00` and rejects out-of-range values. Including time tightens dedup so two legitimate identical same-day transactions (same shop, same price) are not collapsed. Date-only exports (time null) dedup exactly as before; `null` and `undefined` time hash identically. Manual `createManual` normalizes through `parseTime` too, so a hand-entered `09:00` and an imported `09:00:00` match.

**Opening-balance reconciliation on import:** when the file exposes an opening balance — CSV running-balance on the first row (`balance − amount`), or OFX `<LEDGERBAL>` (closing balance, via `deriveOpeningBalance(rows, closingBalance)` = closing − Σ amounts) — the `/imports/upload` preview compares it to the account's current balance (`opening + Σ existing txns`) and returns a `balanceCheck` (`fileOpening`, `accountBalance`, `delta`, `mismatch`, `suggestedOpening`). On mismatch the client (`ImportPage`) blocks commit and prompts: **update the account's opening balance** (PUT `/accounts/:id` with `suggestedOpening = currentOpening + delta`, so the account reconciles with the statement), **import as-is**, or **cancel**. Files with no balance info (QIF, CSV without a balance column) skip the check.

### Ownership split

`account_ownership` maps account → {member: percentage}. Dashboards and the transaction grid apply the member's percentage to split shared-account spend/net (current-state, not effective-dated). The same `TransactionFilter` shape scopes both the grid and dashboards.

### AI provider + jobs/progress

`services/aiProvider.ts` selects the provider (`ai.provider`: `ollama` | `grok` | `cursor`). Ollama uses the official `ollama` client (Ollama Cloud `https://ollama.com` by default, or a local host). `normalizeHost()` strips `/v1`. Grok calls `https://api.x.ai/v1/responses` only. Cursor calls `https://api.cursor.com` only: each reply is a no-repo plan-mode agent that is deleted afterwards (Cursor has no stateless chat API). Keys are stored per provider (`ai.apiKey.ollama|grok|cursor`); the legacy `ai.apiKey` is the Ollama key and is never sent to the other hosts. **No API key is returned to the client.** A connection test will not attach a stored Ollama key to a different host.

Long-running AI ops (insight, forecast, forecast-report, re-categorize, **import auto-categorize**) run as **jobs** (`services/jobs.ts`, in-memory registry + EventEmitter). The route returns `{jobId}` (HTTP 202) immediately; progress streams over SSE at `GET /api/ai/jobs/:id/events` (also pollable at `GET /api/ai/jobs/:id`). Client subscribes via `useJobProgress` + `<JobProgressModal>`. Import `/commit` returns `{batchId, inserted, duplicates, jobId?, total}` (HTTP 201) — the DB inserts + transfer linking complete synchronously and the records exist before the response is sent; when AI auto-categorize is on and there are unmatched rows, `jobId` is set and categorization continues in the background so the client isn't blocked. Jobs are ephemeral — a restart drops them (acceptable for single-user self-hosted). Forecast arithmetic is statistical server-side; AI only narrates — it never generates the numbers.

### Key conventions

- Amounts: negative = expense, positive = income. Display uses `Money`/`formatAUD`; storage/API uses raw signed numbers.
- `source` enum: `manual | rule | ai | ai_auto | ai_suggested_accepted`. Any manual confirm/edit clears `needs_review`.
- Transfers: credit-card ↔ repayment pairs auto-linked (`services/transfers.ts`); `isTransfer` + `linkedTransactionId` on the transaction.
- Categories carry a `type`: `income | expense | transfer`.
- Tests use a per-process temp SQLite (`__tests__/dbHelper.ts` sets `DATABASE_URL` before importing the app's DB module — import order matters).

### Authentication

Single-user auth. One `admin` row in the `users` table, seeded on first boot by `seedAdmin()` (`services/auth.ts`) with `ADMIN_INITIAL_PASSWORD` (default `Pa$$word!`) and `mustResetPassword=true` — the first sign-in forces a password change (client `RequireAuth` gate in `client/src/app/auth.tsx` redirects to `/change-password` until cleared).

- **Passwords**: argon2id (`@node-rs/argon2`, OWASP params m=19456/t=2/p=1) — never stored or logged in cleartext; never sent to the client.
- **Sessions**: opaque random 32-byte token in an `hf_session` **HttpOnly + SameSite=Lax + Secure** cookie; only the **SHA-256 hash** of the token is stored in the `sessions` table (DB leak doesn't expose live tokens; sessions revocable; survive restart). Sliding 7-day expiry (`SESSION_TTL_MS`).
- **Brute force**: `express-rate-limit` on `/api/auth/login` (10/15min/IP) **plus** account lockout tracked in the `users` row (`failedAttempts`/`lockedUntil`, progressive, capped 30min) — `recordFailedLogin`/`recordSuccess` in `services/auth.ts`. Generic "invalid credentials" errors (no enumeration). A dummy argon2 verify runs when the username is unknown to blunt timing.
- **Middleware**: `requireAuth` (`middleware/auth.ts`) guards every `/api/*` router **except** `/api/auth/*` and `/api/health`. It reads the cookie via `cookieParser`, looks up the session, attaches `req.user`. `helmet` adds security headers + a bounded CSP.
- **Endpoints** (`routes/auth.ts`): `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` (401 when unauthed — drives the client redirect), `POST /api/auth/change-password` (invalidates all other sessions).
- **Client**: `fetchBaseQuery({ credentials: 'include' })` so the cookie is sent; `useGetMeQuery` on app boot powers `RequireAuth`; `LoginPage` + `ChangePasswordPage` are the only routes outside the guard.
- Config keys in `server/src/config.ts` under `config.auth` + `config.corsOrigin`; env vars documented in `.env.example` and `docs/deployment.md`.

## Docs

`docs/` has full requirements, architecture, data-model, API, and deployment docs; `docs/decisions/` holds ADRs. Note ADR 0003 predates the ollama-js migration (it describes the old OpenAI-compatible fetch provider) — trust the code over that ADR for current AI provider behavior.