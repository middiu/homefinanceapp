# ADR 0003 — AI provider abstraction behind a config switch

Date: 2026-08-01
Status: Accepted

## Context
MVP requires Ollama Cloud, but users may prefer local Ollama or another OpenAI-compatible endpoint later. AI is optional; some users want zero external calls.

## Decision
Implement an `AiProvider` interface in `server/src/services/ai.ts`. The default `OllamaCloudProvider` calls `${baseUrl}/chat/completions` (OpenAI-compatible). Provider config (base URL, model, key) is read from settings/env, with an `AI_ENABLED` master switch and a settings UI to disable AI entirely.

## Rationale
- Swapping providers is a config/class change, not a rewrite.
- Aggregates only (not raw transaction dumps) are sent to limit data exposure and tokens (privacy §4.5).
- All AI output is labeled advisory; no automated actions.

## Consequences
- Forecast arithmetic is statistical (server-side); the AI only narrates it — keeping cost and correctness in check.
- Weekly digest runs via `node-cron` inside the Express process (simplest reliable option for a single-container app).