# Architecture

## Overview

HomeFinance is a self-hosted single-container web app. The Express API serves both the JSON REST API (`/api/*`) and, in production, the built React SPA (static files + history-fallback). A SQLite file on a mounted volume holds all financial data. An optional AI provider (Ollama, Grok on xAI, or Cursor) is called server-side only.

```
┌─────────────────────────────────────────────────────────────┐
│ Browser (React SPA: Tailwind + shadcn/ui + Recharts + RTK)    │
│   - Household Overview dashboard / Person-Account deep-dive   │
│   - Transaction grid (filter/sort/bulk/export)                │
│   - Import (CSV/OFX/QIF), Categories & Rules, Settings        │
└─────────────────────────────────────────────────────────────┘
              │  fetch /api/* (proxied in dev by Vite)
              ▼
┌─────────────────────────────────────────────────────────────┐
│ Express API (TypeScript)                                     │
│   routes/   members, accounts(+ownership), categories,       │
│             rules, transactions, imports, dashboards, ai,     │
│             settings, backups                                 │
│   services/ parsers (csv/ofx/qif), rules engine,              │
│             ownership-split, ai provider, forecast/anomaly,    │
│             backup                                           │
│   node-cron  weekly AI digest, daily backup                  │
└─────────────────────────────────────────────────────────────┘
      │ Drizzle ORM            │ server-side fetch (aggregates only)
      ▼                        ▼
┌──────────────┐       ┌──────────────────────┐
│ SQLite (WAL) │       │ AI provider                         │
│ ./data/*.db  │       │ Ollama, Grok (api.x.ai), or Cursor  │
└──────────────┘       └─────────────────────────────────────┘
```

## Monorepo layout

```
homefinance/
├── client/                # Vite + React SPA
│   ├── src/
│   │   ├── app/            # RTK store + RTK Query api (all endpoints)
│   │   ├── components/      # ui/ primitives + shared (CategorySelect, common)
│   │   ├── pages/          # Overview, DeepDive, Transactions, Import,
│   │   │                   #   CategoriesRules, AccountsMembers, AiSettings, Backups
│   │   └── lib/            # cn, AUD/date formatting, palette
│   └── vite.config.ts      # dev proxy /api -> :4000
├── server/                 # Express API
│   ├── src/
│   │   ├── db/             # schema.ts (Drizzle), bootstrap (DDL fallback), seed, migrate
│   │   ├── routes/         # REST routers
│   │   ├── services/       # parsers, rules, transactions (ownership-split), ai, backup
│   │   ├── config.ts       # env -> typed config
│   │   └── index.ts        # app wiring + schedulers + static serving
│   ├── drizzle/            # generated migration SQL
│   └── drizzle.config.ts
├── shared/                 # cross-package TS types & DTOs (string-union enums)
│   └── src/                # enums.ts, types.ts
├── docs/                    # this documentation
├── docker-compose.yml
└── .env.example
```

## Data flow

1. **Import:** file upload → server parser (papaparse for CSV; regex SGML/XML for OFX; line-based for QIF) → optional CSV column mapping → dedup hash check against existing → preview (duplicates flagged, rules suggested) → commit (single transaction, rule engine applies categories, `import_batches` row recorded).
2. **Categorization:** three tiers — manual (inline/bulk edit), rule-based (priority-ordered match on contains/regex/equals/amount-range), AI-assisted (server sends aggregated context, never raw dumps, suggestion shown for one-click accept).
3. **Reporting:** dashboards aggregate over `transactions`, applying `account_ownership` percentages to split shared-account spend/net-worth per household member. The same filter primitives scope both dashboards and the transaction grid.
4. **AI:** on-demand (button) and scheduled (weekly digest) insights, cash-flow forecast (statistical projection + AI narrative), anomaly/subscription detection (statistical, computed server-side).
5. **Backups:** daily in-process cron copies the SQLite file (WAL checkpointed first) to `BACKUP_DIR`, pruning to `BACKUP_KEEP`.

## Key design choices

- **Single implicit household** for MVP. The `households` table exists but business logic is global; an auth layer (future) would partition by household/user without a major rewrite.
- **Ownership split is current-state** (not effective-dated) for MVP — applies to all transactions. v2 may add effective-dated splits.
- **Provider switch** (`services/aiProvider.ts`, `services/aiSubscription.ts`) for Ollama, Grok, or Cursor. API-key hosts are pinned (`api.x.ai`, `api.cursor.com`). A Grok device-code sign-in uses the subscription proxy `cli-chat-proxy.grok.com`. Cursor account sign-in mints a user API key and drops the session token. Keys and tokens are stored server-side and never returned to the browser. See ADR 0005.
- **Two DDL paths:** Drizzle migrations (`drizzle/`) are preferred, but `db/bootstrap.ts` also creates tables idempotently so the app boots without first running `drizzle-kit generate`.

## Locale

All monetary values are AUD, formatted en-AU. Dates are DD/MM/YYYY in the UI and `yyyy-mm-dd` in storage/API. This is enforced in `client/src/lib/utils.ts` and `server/src/utils.ts`.