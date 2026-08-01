# ADR 0004 — Shared string-union types instead of TS enums

Date: 2026-08-01
Status: Accepted

## Context
Enums and DTOs are shared across `client`, `server`, and `shared` workspaces. TS `enum`s are awkward across package boundaries (Drizzle column enums produce string unions, not TS enums, causing friction), and `isolatedModules` complicates enum re-export.

## Decision
Define domain enumerations in `shared/src/enums.ts` as **string-literal union types** plus const arrays/label maps (e.g. `type AccountType = 'transaction' | ...`), rather than TS `enum`s.

## Rationale
- Frictionless assignment between Drizzle string-union columns and shared DTOs.
- Plain serializable values over the API.
- `isolatedModules`-safe.

## Consequences
- Slightly less "enum" ergonomics (no `CategorySource.Manual`), mitigated by const label maps where needed.