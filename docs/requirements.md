# HomeFinance — Personal Home Finance Reporting Tool
## Requirements Document (v1.0 — ready for implementation agent)

**Author:** Emilio
**Date:** 2026-08-01
**Status:** Finalized draft — all open questions resolved, ready to hand to implementation agent

---

## 1. Overview

HomeFinance is a self-hosted, private web application for tracking household finances. It runs locally or on a VPS, has no external dependencies beyond an optional AI provider, and is used by a single household without login-based access control (network-level privacy only). Transactions are imported from bank exports, categorized manually, via rules, or via AI assistance, and displayed through charts, grids, and AI-generated insights.

### 1.1 Goals
- Import bank transaction exports and organize them into accounts.
- Categorize transactions (Groceries, Entertainment, Health, Education, etc.) via manual entry, user-defined rules, and AI suggestion.
- Visualize spending via charts and data grids.
- Track multiple accounts, each with configurable ownership percentages across household members, and split shared-account spending accordingly.
- Generate natural-language insights, cash-flow forecasts, and anomaly/subscription detection using an AI model (Ollama Cloud).

### 1.2 Non-goals (out of scope for MVP)
- Multi-user login/authentication (single shared access, protected only by network/deployment perimeter).
- Direct bank API / Open Banking (CDR) integration — file-based import only.
- Multi-currency support.
- Mobile app (responsive web only).
- Bill payment, budgeting alerts/notifications, or transaction initiation of any kind (read-only financial tool).

---

## 2. Users & Context

- Single household, private network deployment (local machine or VPS behind existing network controls — e.g. VPN, reverse proxy with basic auth, or firewall — outside the app's own scope).
- No in-app authentication or role system for MVP. This must be called out clearly in the README/deployment docs as a security assumption: **do not expose this app directly to the public internet without an external auth layer.**
- Multiple "household members" are tracked as data entities (for account ownership and spend attribution) but do not log in separately.
- Locale: en-AU, currency: AUD, date format DD/MM/YYYY.
- Target scale to design around: a family of 2 adults + kids, roughly 6–10 accounts total (joint everyday/savings, individual accounts/cards, kids' education/savings accounts). UI and data grid performance should be sanity-checked against this scale, not just single-account use.

---

## 3. Functional Requirements

### 3.1 Account & Household Member Management
- CRUD for **accounts** (e.g. "Joint Everyday", "Emilio Savings", "Kids Education Fund"): name, institution, account type (transaction/savings/credit card/loan/investment), currency (fixed to AUD for MVP), opening balance, active/archived status.
- CRUD for **household members** (people): name, avatar/color (for chart legends).
- Each account has one or more **ownership splits**: household member + percentage. Splits across all owners of an account must sum to 100%. Support both single-owner (100%) and joint accounts (e.g. 50/50, 60/40).
- Ownership % is used to:
  1. **Split transaction amounts** on shared accounts across owners for per-person spending reports (a $100 grocery transaction on a 50/50 joint account counts as $50 against each member's personal report).
  2. **Compute per-person net worth / balance rollups** — each member's share of every account balance they co-own, aggregated into a personal net worth view.
- Editing ownership % does not retroactively need to support historical "effective-dated" splits in MVP (apply current split to all transactions); note this as a possible v2 enhancement.

### 3.2 Transaction Import
- Import via file upload: **CSV, OFX, and QIF** formats supported.
- CSV import must support a **column-mapping step** (date, description, amount, debit/credit, balance, reference) since bank export formats vary; allow saving a mapping template per bank/account for reuse.
- Deduplication on import: detect and skip/flag transactions that already exist (match on account + date + amount + description hash) to allow re-importing overlapping export ranges safely.
- Import history/log: show what was imported, when, how many new vs. duplicate/skipped rows, with ability to view and undo (delete) a specific import batch.
- Manual transaction entry and edit/delete for corrections.

### 3.3 Categorization
- Predefined category list with sensible defaults (Groceries, Dining & Takeaway, Entertainment, Health & Medical, Education, Utilities, Transport, Housing/Rent/Mortgage, Insurance, Shopping, Travel, Income, Transfers, Fees & Charges, Subscriptions, Other) plus **custom categories and subcategories** manageable by the user.
- Three-tier categorization approach:
  1. **Manual**: user assigns/edits category per transaction, and can bulk-edit multiple selected transactions at once.
  2. **Rule-based**: user-defined rules (match on merchant/description keyword, contains/regex, amount range) that auto-assign a category on import; rules apply in priority order; rule management UI (create/edit/delete/reorder/test-against-existing-data).
  3. **AI-assisted**: for transactions not matched by any rule, send the transaction description (and merchant, amount, existing category list) to the configured AI model to suggest a category; suggestions are shown for one-click acceptance or override, never auto-applied silently. Offer "create a rule from this AI categorization" as a follow-up action to reduce future AI calls.
- Track category confidence/source per transaction (manual / rule / AI-suggested-accepted) for transparency and future rule tuning.

### 3.4 Reporting & Visualization

The app's landing experience is **two comprehensive dashboards**, reachable via primary nav, plus a full transaction grid. All other functions (import, rules, AI config, settings) live in secondary pages off the main nav — the dashboards are what the user sees first and most often.

#### 3.4.1 Household Overview Dashboard (default landing page)
The single-glance "how are we doing" view across the whole household:
- **Summary cards**: total balance across all accounts, total this-month spend vs. last month (with % delta), total this-month income vs. last month, net cash flow this month, upcoming known recurring bills (from subscription detection).
- **Spending by category** — pie/donut for current month + a trailing 6/12-month stacked bar showing category trends over time.
- **Income vs. expense over time** — bar/line chart, monthly granularity, selectable range (3/6/12 months, YTD, custom).
- **Account balances** — list/card view of every account with current balance and a small sparkline trend, grouped by account type (transaction/savings/credit/loan/investment).
- **Per-person balance & spend summary** — one row/card per household member showing their net-worth share (via ownership %) and their attributed spend this month, with a link into their personal breakdown.
- **AI insight panel** — surfaces the latest on-demand or weekly-digest natural-language insight (see §3.5), clearly labeled "AI-generated," with a "generate new insight" action.
- **Recent transactions** — last 10–15 transactions across all accounts with quick inline category edit, linking to the full grid.
- Global date-range and account-scope filter that affects every widget on the page.

#### 3.4.2 Person / Deep-Dive Dashboard
A second dashboard focused on a single household member or account, selected via a switcher at the top:
- **Personal net worth trend** — line chart of the selected member's ownership-weighted balance across all their accounts over time.
- **Personal spend breakdown by category** — pie/donut + trend, using ownership-split amounts (their share of joint-account transactions plus 100% of their own accounts).
- **Category comparison** — this period vs. previous period, per category, with % change and simple over/under indicators.
- **Cash-flow forecast panel** — the AI-assisted 1–3 month projection for this person/account scope (see §3.5), with the underlying statistical chart shown alongside the AI narrative.
- **Subscriptions & recurring charges** — list of detected recurring transactions attributed to this person/account, with next expected date and amount.
- **Anomalies** — flagged unusual transactions for this scope, with quick actions to confirm ("that's fine") or recategorize.
- Can also be scoped to a single **account** instead of a person (e.g. drill into just "Kids Education Fund"), reusing the same layout.

#### 3.4.3 Transaction Grid (full page)
- Full transaction list with filter/sort/search (by account, category, date range, member/owner, amount range, text search on description), inline category editing, bulk edit, pagination, CSV export of filtered results.
- Filters must be shareable/combinable (e.g. "Health category + Q1 2026 + Emilio's share") and are the same filter primitives used to scope both dashboards, so a user can jump from a dashboard chart straight into the matching filtered grid view.
- All monetary values formatted as AUD with en-AU conventions throughout every dashboard and the grid.

#### 3.4.4 Navigation structure (for the implementation agent)
Primary nav should reflect: **Household Dashboard** (default/home) · **Person/Account Dashboard** · **Transactions** (grid) · **Import** · **Categories & Rules** · **Accounts & Members** · **AI & Insights settings** · **Backups/Data**.

### 3.5 AI Advice & Forecasting
- Integrates with **Ollama Cloud** (hosted inference, https://ollama.com) via a configurable base URL / API key — architecture should use an abstraction layer so a different provider (local Ollama, OpenAI-compatible endpoint, etc.) could be swapped in later via config, even though only Ollama Cloud is required for MVP.
- **Natural-language spending insights**: available **on-demand** (button click on either dashboard) **and on a scheduled weekly digest** (background job, e.g. every Monday morning) summarizing the past week/month such as "You spent 20% more on dining this month than your 6-month average." Insights are generated from aggregated category/time-series data (not raw transaction dumps, to limit data sent and tokens used). The weekly digest requires a scheduler in the deployment (e.g. `node-cron` inside the Express process, or a cron entry in the Docker Compose setup) — implementation agent to propose the simplest reliable option for a self-hosted single-container app.
- **Cash-flow / budget forecasting**: statistical projection (e.g. moving average / simple trend) of category spend and account balances for the next 1–3 months, with the AI model used to generate a narrative explanation of the projection rather than to do the arithmetic itself.
- **Anomaly & subscription detection**: identify recurring transactions (same merchant/amount/interval) to build a "subscriptions" view, and flag unusual transactions (statistical outliers by category/amount) for user review.
- All AI features must clearly label output as AI-generated and be non-authoritative (advisory only); no automated actions are taken based on AI output.
- Provide a settings screen to configure the AI provider endpoint/key/model, and a way to disable AI features entirely if the user doesn't want any external calls.

### 3.6 Settings & Data Management
- Manage categories, rules, accounts, household members, AI provider config from a settings area.
- Data export (full DB export / backup file) and import (restore) from the UI.
- Scheduled/automated local backup of the SQLite database file (e.g. daily rotation to a backups folder or volume) — document the backup mechanism even if implemented as a simple cron/cron-in-container script rather than an app feature.

---

## 4. Technical Requirements

### 4.1 Stack (finalized)
- **Frontend**: ReactJS (latest stable version), Redux Toolkit for state management, React Router for routing, **TypeScript**.
- **UI components**: **Tailwind CSS + shadcn/ui**.
- **Charts**: **Recharts**.
- **Backend**: Node.js + Express.js REST API, **TypeScript**.
- **Database**: SQLite (file-based), accessed via **Drizzle ORM** with migration support (`drizzle-kit`).
- **AI integration**: server-side service module calling **Ollama Cloud**'s API; API key stored server-side only (never exposed to frontend). Abstracted behind a provider interface so other Ollama-compatible/OpenAI-compatible endpoints could be swapped in later via config.
- **File parsing**: server-side parsing libraries for CSV/OFX/QIF (e.g. `papaparse`/`csv-parse` for CSV; dedicated OFX/QIF parser libraries).
- **Scheduler**: lightweight in-process scheduler (e.g. `node-cron`) for the weekly AI digest job.

### 4.2 Architecture
- Monorepo layout: `/client` (React app), `/server` (Express API), `/shared` for shared TypeScript types (e.g. category enums, DTOs).
- REST API, JSON payloads; document endpoints (OpenAPI/Swagger optional but recommended).
- No authentication/session middleware required for MVP, but structure the code so an auth middleware layer could be added later without a major rewrite (e.g. don't hardcode "no user" assumptions throughout business logic — support a single implicit default user/household concept cleanly).

### 4.3 Deployment
- **Local-only first**: initial milestones target `docker compose up` on the user's own machine — no HTTPS/reverse-proxy/VPS hardening required to consider the MVP "done." VPS deployment (with HTTPS via Caddy/Traefik + Let's Encrypt, and the external-auth security note) is an explicit **follow-up milestone (M5)**, not a blocker for initial delivery.
- **Docker Compose** based self-hosting: single container for the Express API serving the built React static files (simplest approach for a home app), with the SQLite file on a mounted volume for persistence.
- `docker-compose.yml` + `.env.example` for configuration (ports, AI provider key/URL, backup schedule, weekly digest cron time).
- README with setup instructions for local dev (`docker compose up`), and a placeholder section for VPS deployment to be filled in at M5, including the **security note** that the app has no login and must sit behind a VPN/reverse-proxy with auth if ever exposed beyond localhost.

### 4.4 Repository & Documentation Setup
This is the **first task** the implementation agent should perform, before any application code:
- Initialize the project root as a **git repository** (`git init`), with an appropriate `.gitignore` (node_modules, build output, `.env`, the SQLite data file/volume, editor/OS cruft).
- Make an initial commit establishing the repo structure, then commit logically through each milestone (not one giant commit at the end).
- Create a root **`README.md`** covering: project overview/purpose, tech stack summary, prerequisites, local dev setup (`docker compose up`), how to run without Docker (if applicable), environment variables (`.env.example` reference), how to run tests, and a link into the `/docs` folder for full documentation.
- Create a **`/docs`** folder at the project root holding all documentation, including at minimum:
  - `docs/requirements.md` — this requirements document (or a synced copy of it), as the source of truth for scope.
  - `docs/architecture.md` — system architecture, folder structure, data flow between client/server/DB/AI provider.
  - `docs/data-model.md` — the finalized DB schema (expanded from §5), including entity-relationship notes and migration conventions.
  - `docs/api.md` — REST API endpoint reference (or generated OpenAPI/Swagger spec + a short pointer doc).
  - `docs/deployment.md` — Docker Compose usage, environment configuration, backup/restore procedure, and the M5 VPS/HTTPS follow-up notes.
  - `docs/decisions/` — lightweight ADRs (architecture decision records) for notable choices made during implementation (e.g. why Drizzle over Prisma, single-container vs. split), one markdown file per decision.
- Keep `README.md` as the short entry point and push detail into `/docs` rather than letting the README grow unwieldy.

### 4.5 Non-Functional Requirements
- **Privacy**: all financial data stays in the local SQLite file; only category/amount/description aggregates (not full account numbers or balances beyond what's needed) sent to the AI provider, and only when AI features are enabled.
- **Performance**: should comfortably handle a household's multi-year transaction history (tens of thousands of rows) with responsive filtering/pagination.
- **Locale**: en-AU formatting, AUD currency, DD/MM/YYYY dates throughout.
- **Backups**: automated local backup of the DB file (see 3.6).
- **Testing**: unit tests for import parsing, categorization rule engine, and ownership-split calculations at minimum; agent to propose test framework (e.g. Vitest/Jest).

---

## 5. Data Model (initial sketch)

- `households` *(implicit single row for MVP, or omit entirely and treat as global)*
- `members` (id, name, color)
- `accounts` (id, name, institution, type, opening_balance, currency, is_archived)
- `account_ownership` (account_id, member_id, percentage)
- `transactions` (id, account_id, date, description, raw_description, amount, category_id, source [manual/rule/ai], import_batch_id, is_transfer)
- `categories` (id, name, parent_category_id, is_custom)
- `rules` (id, match_type, match_value, category_id, priority)
- `import_batches` (id, account_id, imported_at, file_name, row_count, duplicate_count)
- `ai_insights` (id, generated_at, type [insight/forecast/anomaly], content, related_period)

*(Agent should refine this schema during implementation; this is a starting point, not a final spec.)*

---

## 6. Decisions Log (resolved)

| # | Question | Decision |
|---|---|---|
| 1 | UI component library | Tailwind CSS + shadcn/ui |
| 2 | TypeScript vs JavaScript | TypeScript, frontend and backend |
| 3 | Chart library | Recharts |
| 4 | ORM/query builder | Drizzle ORM |
| 5 | Initial category taxonomy | Default list in §3.3, user-editable later |
| 6 | AI insight cadence | On-demand + scheduled weekly digest |
| 7 | Household scale | 2 adults + kids, ~6–10 accounts |
| 8 | Hosting target | Local-only first (Docker Compose); VPS/HTTPS deferred to M5 |

---

## 7. Suggested Milestones

1. **M1 — Repo setup & core data**: git init + `.gitignore` + initial commit, root `README.md`, `/docs` folder scaffolded (§4.4), DB schema (Drizzle migrations), accounts/members/ownership CRUD, CSV/OFX/QIF import with mapping + dedup, manual categorization, basic transaction grid.
2. **M2 — Dashboards & reporting**: rule engine, category management, both dashboards (Household Overview + Person/Account Deep-Dive) with Recharts, filtering/export, nav structure per §3.4.4.
3. **M3 — AI integration**: Ollama Cloud connection, on-demand + weekly-digest natural-language insights, cash-flow forecast, anomaly/subscription detection surfaced on the Person/Account dashboard.
4. **M4 — Hardening**: Docker Compose packaging (single container, local-only), automated local backups, README, test coverage pass (import parsing, rule engine, ownership-split math).
5. **M5 — VPS deployment (follow-up)**: HTTPS via reverse proxy (Caddy/Traefik + Let's Encrypt), VPS deployment docs, reinforced security guidance since the app has no login.

---

*End of requirements. All open questions are resolved (§6) — this document is ready to hand to an implementation agent.*
