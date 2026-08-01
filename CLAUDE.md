# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Self-hosted personal household-finance app. Import bank exports (CSV/OFX/QIF), categorize (manual / rule engine / AI), visualize spending with ownership-weighted member splits, and generate AI insights/forecasts/anomaly+subscription detection. Single implicit household, **no in-app auth** — do not expose publicly; deploy behind VPN/reverse proxy (see `docs/deployment.md`).

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

The AI provider is a **remote cloud service** (Ollama Cloud by default). Only the bare minimum leaves the server — never account numbers, balances, raw dumps, or personal names. Three egress shapes:
- **Insight / forecast / forecast-report** send **aggregates and statistical numbers only** (category totals, monthly net, projection figures). No transaction text.
- **Categorization** (import auto-categorize + re-categorize) sends **one sanitized descriptor + the amount** per transaction. `sanitizeForAi()` (`services/ai.ts`) strips account/card/reference numbers (runs of 4+ digits), BSB, and card groups, collapses whitespace, caps at 80 chars — preserving only the merchant words needed to identify the shop.
- **Web search** (`aiWebSearch`) sends the **same sanitized descriptor** + "merchant shop australia".

Transfers (`isTransfer`) are **skipped for AI** in re-categorize — their memos may carry recipient names/bank strings and they need no merchant identification. On import, transfers are linked post-import so AI runs first; sanitization removes the banking digits, and the residual merchant/recipient words are the irreducible minimum for usefulness. `apiKey` is server-side only and never sent to the client.

**Dedup:** `dedupHash = hash(accountId + date + amount + description)` on every transaction; import commit skips rows whose hash already exists.

### Ownership split

`account_ownership` maps account → {member: percentage}. Dashboards and the transaction grid apply the member's percentage to split shared-account spend/net (current-state, not effective-dated). The same `TransactionFilter` shape scopes both the grid and dashboards.

### AI provider + jobs/progress

`services/ai.ts` uses the **official `ollama` (ollama-js) client** against an Ollama host (Ollama Cloud `https://ollama.com` default, or local/remote Ollama). `normalizeHost()` strips `/v1` so legacy `https://ollama.com/v1` config still works — the native `/api/chat` endpoint is used, *not* the OpenAI-compatible `/v1`. `aiWebSearch()` uses `ollama.webSearch()` (hosted at ollama.com, requires API key) for merchant lookup during categorization. Provider config (baseUrl, model, apiKey, enabled, autoCategorize) lives in the `settings` table, falling back to env (`config.ai`); **apiKey is never sent to the client**.

Long-running AI ops (insight, forecast, forecast-report, re-categorize) run as **jobs** (`services/jobs.ts`, in-memory registry + EventEmitter). The route returns `{jobId}` (HTTP 202) immediately; progress streams over SSE at `GET /api/ai/jobs/:id/events` (also pollable at `GET /api/ai/jobs/:id`). Client subscribes via `useJobProgress` + `<JobProgressModal>`. Jobs are ephemeral — a restart drops them (acceptable for single-user self-hosted). Forecast arithmetic is statistical server-side; AI only narrates — it never generates the numbers.

### Key conventions

- Amounts: negative = expense, positive = income. Display uses `Money`/`formatAUD`; storage/API uses raw signed numbers.
- `source` enum: `manual | rule | ai | ai_auto | ai_suggested_accepted`. Any manual confirm/edit clears `needs_review`.
- Transfers: credit-card ↔ repayment pairs auto-linked (`services/transfers.ts`); `isTransfer` + `linkedTransactionId` on the transaction.
- Categories carry a `type`: `income | expense | transfer`.
- Tests use a per-process temp SQLite (`__tests__/dbHelper.ts` sets `DATABASE_URL` before importing the app's DB module — import order matters).

## Docs

`docs/` has full requirements, architecture, data-model, API, and deployment docs; `docs/decisions/` holds ADRs. Note ADR 0003 predates the ollama-js migration (it describes the old OpenAI-compatible fetch provider) — trust the code over that ADR for current AI provider behavior.