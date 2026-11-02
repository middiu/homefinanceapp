# REST API Reference

Base URL: `/api`. All request/response bodies are JSON (multipart for file uploads). No auth (single-household MVP).

## Members
| Method | Path | Body / Query | Returns |
|---|---|---|---|
| GET | `/api/members` | — | `MemberDto[]` |
| POST | `/api/members` | `{ name, color? }` | `MemberDto` |
| PUT | `/api/members/:id` | `{ name?, color? }` | `MemberDto` |
| DELETE | `/api/members/:id` | — | 204 |

## Accounts
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/accounts` | — | `AccountDto[]` (includes `ownership[]`) |
| POST | `/api/accounts` | `{ name, institution?, type, currency?, openingBalance?, isArchived?, ownership[] }` | `AccountDto` |
| PUT | `/api/accounts/:id` | partial of above | `AccountDto` |
| DELETE | `/api/accounts/:id` | — | 204 |

`ownership` = `[{ memberId, percentage }]`, must sum to 100.

## Categories
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/categories` | — | `CategoryDto[]` |
| POST | `/api/categories` | `{ name, parentId?, isCustom? }` | `CategoryDto` |
| PUT | `/api/categories/:id` | partial | `CategoryDto` |
| DELETE | `/api/categories/:id` | — | 204 |

## Rules
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/rules` | — | `RuleDto[]` (priority order) |
| POST | `/api/rules` | `{ matchType, matchValue, amountMin?, amountMax?, categoryId, priority?, isActive? }` | `RuleDto` |
| PUT | `/api/rules/:id` | partial | `RuleDto` |
| DELETE | `/api/rules/:id` | — | 204 |
| POST | `/api/rules/test` | rule body | `{ matches }` (count of existing txns matched) |
| POST | `/api/rules/reorder` | `{ ids: [orderedIds] }` | `{ ok }` |

`matchType`: `contains` | `regex` | `equals` | `amount_range`.

## Transactions
| Method | Path | Body / Query | Returns |
|---|---|---|---|
| GET | `/api/transactions` | filter (see below) | `PagedResult<TransactionDto>` |
| POST | `/api/transactions` | `{ accountId, date, description, amount, categoryId?, balance? }` | `TransactionDto` |
| PUT | `/api/transactions/:id` | `{ categoryId?, source?, description?, amount?, date?, isTransfer? }` | `TransactionDto` |
| DELETE | `/api/transactions/:id` | — | 204 |
| POST | `/api/transactions/bulk` | `{ ids, categoryId, source? }` | `{ ok, count }` |
| POST | `/api/transactions/suggest` | `{ description, amount }` | `{ categoryId }` (rules-based) |

**Filter query params** (`GET /api/transactions`): `accountId[]`, `categoryId[]`, `memberId[]`, `dateFrom`, `dateTo`, `amountMin`, `amountMax`, `search`, `page`, `pageSize`, `sort` (`date:desc` | `date:asc` | `amount:desc` | `amount:asc`). When `memberId` is set, results are restricted to accounts that member owns and `shareAmount` (amount × ownership %) is returned per row.

## Imports
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/imports/upload` | multipart `file`, `accountId`, `format`, `columnMap?` (JSON, CSV), `hasHeader?`, `amountSignConvention?`, `dateFormat?` | preview `{ format, headers, rows[], accountId, fileName, columnMap }` (rows flag `isDuplicate` + suggested `categoryId`) |
| POST | `/api/imports/commit` | `{ accountId, format, fileName, rows[], applyRules? }` | `{ batchId, inserted, duplicates, total }` |
| GET | `/api/imports/batches` | — | `ImportBatchDto[]` |
| DELETE | `/api/imports/batches/:id` | — | 204 (undo: deletes the batch's transactions) |
| GET | `/api/imports/mappings` | — | `ImportMappingDto[]` |
| POST | `/api/imports/mappings` | `{ name, accountId?, format, columnMap, hasHeader?, dateFormat?, amountSignConvention? }` | mapping |
| DELETE | `/api/imports/mappings/:id` | — | 204 |

## Dashboards
| Method | Path | Query | Returns |
|---|---|---|---|
| GET | `/api/dashboards/overview` | `dateFrom?`, `dateTo?` | household summary cards, spending-by-category, category trend, income-vs-expense series, accounts-by-type with sparklines, per-person net-worth/spend, recent transactions, latest insight |
| GET | `/api/dashboards/deepdive` | `memberId?` or `accountId?`, `dateFrom?`, `dateTo?` | net-worth trend, spend-by-category (ownership-weighted), category comparison vs prev period, current/previous spend |

## AI
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/ai/status` | — | `{ enabled }` |
| POST | `/api/ai/insight` | `{ scope? }` | `{ id, content }` (advisory) |
| GET | `/api/ai/insight/latest` | `scope?` | `AiInsightDto \| null` |
| POST | `/api/ai/forecast` | `{ scope? }` | `{ id, content, projection[] }` |
| GET | `/api/ai/anomalies` | `accountId?` | anomaly list |
| POST | `/api/ai/anomalies/:id/confirm` | — | `{ ok }` |
| GET | `/api/ai/subscriptions` | `accountId?` | recurring list |
| POST | `/api/ai/suggest-category` | `{ description, amount? }` | `{ categoryId?, suggestedName? }` |

## Settings
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/settings/ai` | — | `AiConfigDto` (`provider`, `endpoint`, `hasApiKey`, `keysConfigured`; never the key) |
| PUT | `/api/settings/ai` | `{ provider?, enabled?, baseUrl?, model?, apiKey?, digestCron?, autoCategorize? }` | `{ ok }` |

`provider` is `ollama`, `grok`, or `cursor`. `baseUrl` is saved only for Ollama. Grok calls `https://api.x.ai` and Cursor calls `https://api.cursor.com`; a client-supplied base URL cannot redirect those keys. `apiKey` is stored for the provider being saved and is not echoed. `POST /api/ai/test-connection` accepts `{ provider?, baseUrl?, apiKey?, model? }` and lists models. For Ollama, the stored key is sent only when the tested host matches the saved host.

## Backups
| Method | Path | Returns |
|---|---|---|
| GET | `/api/backups` | backup list |
| POST | `/api/backups` | `{ ok, file }` (creates a backup now) |
| GET | `/api/backups/:name/download` | file download |
| DELETE | `/api/backups/:name` | 204 |

## Health
`GET /api/health` → `{ ok: true }`.

## DTO reference
See `shared/src/types.ts` and `shared/src/enums.ts` for the full TypeScript definitions shared between client and server.