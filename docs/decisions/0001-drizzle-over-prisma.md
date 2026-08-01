# ADR 0001 — Drizzle ORM over Prisma

Date: 2026-08-01
Status: Accepted

## Context
HomeFinance is a self-hosted, file-based SQLite app shipped in a single container. The ORM must work well with SQLite, support migrations, and not impose a heavy runtime or a binary query engine that complicates container builds.

## Decision
Use **Drizzle ORM** (`drizzle-orm` + `drizzle-kit`) with `better-sqlite3`.

## Rationale
- Lightweight, schema-as-code, SQL-first; no extra daemon/binary query engine (Prisma's engines complicate Docker multi-arch builds).
- Native SQLite via `better-sqlite3` (synchronous, fast, simple for a single-process home app).
- `drizzle-kit generate` produces reviewable SQL migration files we commit.

## Consequences
- We write slightly more query code than Prisma's auto-resolvers, but gain transparency and a smaller image.
- A raw-DDL bootstrap (`db/bootstrap.ts`) exists as a safety net so the app boots without running migrations first.