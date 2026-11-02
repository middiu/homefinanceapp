# ADR 0005 — Grok and Cursor as pinned AI providers

Date: 2026-11-02
Status: Accepted

## Context

The app called only Ollama. Household data must keep leaving the server in the same three shapes (aggregates, one sanitized merchant line, or a sanitized web-search query), and an API key must not be stealable by pointing the connection test at another host.

Grok is a normal inference API (`https://api.x.ai`, Responses API). Cursor's public API is the Cloud Agents API. It is not a chat-completions endpoint. A Cursor reply has to be an agent run.

## Decision

`ai.provider` is `ollama`, `grok`, or `cursor`. Each provider has its own server-side key (`ai.apiKey.<provider>`). The legacy `ai.apiKey` setting remains the Ollama key and is never sent to xAI or Cursor.

- **Ollama** keeps a configurable base URL. The stored key is attached only when the tested host matches the saved host. Requests may go to that host, or to `https://ollama.com/api/web_search` and `/api/web_fetch` for merchant lookup. Redirects are refused. Link-local and metadata hosts are rejected.
- **Grok** API-key calls always use `https://api.x.ai`. Chat uses `POST /v1/responses`. Merchant lookup uses the same API with the `web_search` tool, image search off, and no X search. A client-supplied base URL is ignored.
- **Grok subscription** sign-in uses xAI's public device-code flow (`https://auth.x.ai`, the Grok CLI public client, no client secret). The device code stays on the server. The browser sees the user code and an `accounts.x.ai` / `auth.x.ai` verification URL. Access and refresh tokens are stored in `settings` and never returned. While that sign-in is connected, Grok calls go to `https://cli-chat-proxy.grok.com` with the Grok CLI identity headers, which is the host that draws on a SuperGrok or X Premium subscription. Refresh tokens rotate. `invalid_grant` clears the sign-in. Some plans are refused by xAI (402/403); the API key path remains.
- **Cursor** always calls `https://api.cursor.com`. Each reply is one no-repository plan-mode agent: no repos, no MCP, no environment variables, no images, pull requests off, and a fixed display name so the prompt is not used as the title. The agent is deleted after the run, including when the run fails. Model ids come from `GET /v1/models`.
- **Cursor subscription** sign-in follows the same browser login as `Cursor.auth.login()`. The PKCE verifier stays on the server and is sent only in a `POST` body to `https://api2.cursor.sh/auth/poll`. The session token is used once to mint a named user API key (about 90 days) and is then dropped. That key is stored as the Cursor provider key and billed to the Cursor subscription. Disconnect removes it from this server. Revoking it early is done in the Cursor dashboard. Pasting a key clears the subscription marker so disconnect leaves a pasted key in place.

The same sanitizer runs before any provider sees a description. Prompts are capped. Provider errors are truncated and stripped of bearer tokens and the configured key.

## Consequences

Cursor replies are slower than Grok or Ollama, and the prompt transits Cursor until the agent delete completes. The settings screen says so and points at Grok for a direct inference call. Ollama behaviour for an existing install is unchanged when `ai.provider` is unset.
