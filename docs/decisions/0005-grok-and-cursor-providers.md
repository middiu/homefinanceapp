# ADR 0005 — Grok and Cursor as pinned AI providers

Date: 2026-11-02
Status: Accepted

## Context

The app called only Ollama. Household data must keep leaving the server in the same three shapes (aggregates, one sanitized merchant line, or a sanitized web-search query), and an API key must not be stealable by pointing the connection test at another host.

Grok is a normal inference API (`https://api.x.ai`, Responses API). Cursor's public API is the Cloud Agents API. It is not a chat-completions endpoint. A Cursor reply has to be an agent run.

## Decision

`ai.provider` is `ollama`, `grok`, or `cursor`. Each provider has its own server-side key (`ai.apiKey.<provider>`). The legacy `ai.apiKey` setting remains the Ollama key and is never sent to xAI or Cursor.

- **Ollama** keeps a configurable base URL. The stored key is attached only when the tested host matches the saved host. Requests may go to that host, or to `https://ollama.com/api/web_search` and `/api/web_fetch` for merchant lookup. Redirects are refused. Link-local and metadata hosts are rejected.
- **Grok** always calls `https://api.x.ai`. Chat uses `POST /v1/responses`. Merchant lookup uses the same API with the `web_search` tool, image search off, and no X search. A client-supplied base URL is ignored.
- **Cursor** always calls `https://api.cursor.com`. Each reply is one no-repository plan-mode agent: no repos, no MCP, no environment variables, no images, pull requests off, and a fixed display name so the prompt is not used as the title. The agent is deleted after the run, including when the run fails. Model ids come from `GET /v1/models`.

The same sanitizer runs before any provider sees a description. Prompts are capped. Provider errors are truncated and stripped of bearer tokens and the configured key.

## Consequences

Cursor replies are slower than Grok or Ollama, and the prompt transits Cursor until the agent delete completes. The settings screen says so and points at Grok for a direct inference call. Ollama behaviour for an existing install is unchanged when `ai.provider` is unset.
