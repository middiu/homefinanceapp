# ADR 0002 — Single container serving API + SPA

Date: 2026-08-01
Status: Accepted

## Context
A home app should be trivial to run: one command, one port, no reverse proxy needed for localhost use.

## Decision
Ship a **single container** that runs the Express API and serves the built React SPA from the same origin. The API mounts under `/api/*`; everything else falls back to `client/dist/index.html` (history-mode routing).

## Rationale
- Simplest `docker compose up` experience for a home user.
- No CORS or cross-origin config needed in production.
- The dev workflow still splits client (Vite `:5173`, proxies `/api`) and server (`:4000`) for HMR.

## Consequences
- Rebuild the client into the image on code changes (acceptable for a self-hosted app).
- A future split (e.g. edge-cached SPA + API) is non-breaking since the API is already a clean `/api` namespace.