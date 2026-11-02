# Data Model

The schema is defined with Drizzle ORM in `server/src/db/schema.ts` (source of truth). Drizzle migrations live in `server/drizzle/`. A raw-DDL fallback (`server/src/db/bootstrap.ts`) creates the same tables idempotently so the app boots without first running `drizzle-kit generate`.

All timestamps are ISO strings (SQLite has no native datetime type we rely on). Money is `REAL` (double), negative = expense, positive = income. Dates are `yyyy-mm-dd`.

## Entities

### households
Implicit single row for MVP (global scope). Kept for future multi-household/auth.

| column | type | notes |
|---|---|---|
| id | TEXT PK | uuid |
| name | TEXT | |
| created_at | TEXT | default CURRENT_TIMESTAMP |

### members
Household members (data entities, not logins). Used for ownership + spend attribution + chart legend colors.

| column | type | notes |
|---|---|---|
| id | TEXT PK | uuid |
| name | TEXT | |
| color | TEXT | chart legend, default `#6366f1` |
| created_at | TEXT | |

### accounts
| column | type | notes |
|---|---|---|
| id | TEXT PK | uuid |
| name | TEXT | e.g. "Joint Everyday" |
| institution | TEXT? | |
| type | TEXT | `transaction` / `savings` / `credit_card` / `loan` / `investment` |
| currency | TEXT | `AUD` (MVP fixed) |
| opening_balance | REAL | default 0 |
| is_archived | INTEGER(0/1) | |
| created_at | TEXT | |

### account_ownership
One-or-more rows per account. Percentages across an account sum to 100% (enforced at the API layer). `UNIQUE(account_id, member_id)`.

| column | type | notes |
|---|---|---|
| id | TEXT PK | |
| account_id | TEXT FK -> accounts (cascade) | |
| member_id | TEXT FK -> members (cascade) | |
| percentage | REAL | 0–100 |

Ownership is **current-state** for MVP (applied to all transactions); effective-dated splits are a v2 enhancement.

### categories
User-editable taxonomy. Default list seeded (see `DEFAULT_CATEGORIES` in `shared/src/enums.ts`).

| column | type | notes |
|---|---|---|
| id | TEXT PK | |
| name | TEXT | |
| parent_id | TEXT | subcategory parent (self-ref; FK enforced in bootstrap DDL) |
| is_custom | INTEGER(0/1) | default categories are protected from delete |

### rules
Priority-ordered auto-categorization. Lower `priority` = applied first.

| column | type | notes |
|---|---|---|
| id | TEXT PK | |
| match_type | TEXT | `contains` / `regex` / `equals` / `amount_range` |
| match_value | TEXT | keyword / regex / exact |
| amount_min | REAL? | optional amount filter |
| amount_max | REAL? | optional amount filter |
| category_id | TEXT FK -> categories (cascade) | |
| priority | INTEGER | default 100 |
| is_active | INTEGER(0/1) | |

### import_batches
| column | type | notes |
|---|---|---|
| id | TEXT PK | |
| account_id | TEXT FK -> accounts (cascade) | |
| imported_at | TEXT | |
| file_name | TEXT | |
| file_format | TEXT | `csv` / `ofx` / `qif` |
| row_count | INTEGER | |
| duplicate_count | INTEGER | |

### transactions
| column | type | notes |
|---|---|---|
| id | TEXT PK | |
| account_id | TEXT FK -> accounts (cascade) | |
| date | TEXT | `yyyy-mm-dd` |
| description | TEXT | normalized |
| raw_description | TEXT? | original |
| amount | REAL | negative=expense, positive=income |
| balance | REAL? | running balance if provided |
| category_id | TEXT FK -> categories (set null) | |
| source | TEXT | `manual` / `rule` / `ai` (provenance) |
| import_batch_id | TEXT FK -> import_batches (set null) | for undo |
| is_transfer | INTEGER(0/1) | |
| dedup_hash | TEXT | sha256(account\|date\|amount(2dp)\|norm-desc) |
| created_at | TEXT | |

**Dedup hash** = `sha256(account_id | date | amount.toFixed(2) | normalized-description)`, where description is trimmed, lowercased, whitespace-collapsed. A unique index would be ideal but duplicate-import safety uses a pre-check instead (an import re-run of the same range skips existing hashes rather than erroring).

### import_mappings
Saved CSV column-mapping templates (per bank/account).

| column | type | notes |
|---|---|---|
| id | TEXT PK | |
| name | TEXT | |
| account_id | TEXT FK -> accounts (set null) | |
| format | TEXT | `csv` / `ofx` / `qif` |
| column_map | TEXT (JSON) | `{ date, description, amount, debit, credit, balance, reference } -> column name` |
| has_header | INTEGER(0/1) | |
| date_format | TEXT? | hint for DD/MM vs MM/DD |
| amount_sign_convention | TEXT | `auto` / `negIsExpense` / `posIsExpense` |

### ai_insights
| column | type | notes |
|---|---|---|
| id | TEXT PK | |
| generated_at | TEXT | |
| type | TEXT | `insight` / `forecast` / `anomaly` |
| scope | TEXT | `household` \| `member:<id>` \| `account:<id>` |
| content | TEXT | AI narrative |
| related_period | TEXT? | |

### settings
Key/value store for AI provider config. Keys are stored per provider (`ai.apiKey.ollama`, `ai.apiKey.grok`, `ai.apiKey.cursor`). The legacy `ai.apiKey` value is the Ollama key from before provider selection. None of these values are returned to the client.

| column | type | notes |
|---|---|---|
| key | TEXT PK | e.g. `ai.apiKey` |
| value | TEXT | |

## Relationships (ER notes)

```
members 1───* account_ownership *───1 accounts
accounts 1───* transactions
accounts 1───* import_batches 1───* transactions
categories 1───* transactions (category_id)
categories 1───* rules
categories 1───0..1 categories (parent_id)
```

## Migration conventions

- `npm run db:generate` — generate SQL from `schema.ts` changes (`drizzle-kit generate`).
- `npm run db:migrate` — apply migrations from `server/drizzle/`.
- `db:seed` runs `bootstrap()` first (idempotent DDL) then seeds the default household + categories.
- Schema changes should: edit `schema.ts` → `db:generate` → commit the new `drizzle/*.sql` → run `db:migrate`. The bootstrap DDL is a safety net for first-run without migrations.