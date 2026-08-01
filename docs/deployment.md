# Deployment

## Local — Docker Compose (recommended for self-hosting)

```bash
cp .env.example .env        # set AI_API_KEY etc. if you want AI features
docker compose up --build -d
```

Open <http://localhost:4000>. The single container runs the Express API and serves the built React SPA. The SQLite database and backups persist in mounted volumes (`./data`, `./backups`).

Stop: `docker compose down`. Rebuild after code changes: `docker compose up --build -d`.

### What the container does

- Builds `shared`, `server`, and `client` inside the image.
- Runs `db:seed` at startup (idempotent: creates tables via bootstrap + default categories).
- Starts `node dist/index.js` (Express on `PORT`, serves `client/dist`).
- `node-cron` schedules the weekly AI digest (`AI_DIGEST_CRON`) and daily backup (`BACKUP_CRON`).

### Environment

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 4000 | HTTP port |
| `DATABASE_URL` | `./data/homefinance.sqlite` | SQLite path (mounted volume) |
| `AI_ENABLED` | true | master switch for AI features |
| `AI_BASE_URL` | `https://ollama.com/v1` | Ollama Cloud (OpenAI-compatible) base URL |
| `AI_API_KEY` | — | required for AI calls; stored server-side only |
| `AI_MODEL` | llama3.1 | model id |
| `AI_DIGEST_CRON` | `0 7 * * 1` | weekly digest schedule |
| `BACKUP_DIR` | `./backups` | backup directory (mounted volume) |
| `BACKUP_CRON` | `0 3 * * *` | daily backup schedule |
| `BACKUP_KEEP` | 14 | backups to retain (rotation) |

## Backup & restore

**Backups** are created:
- Automatically by the daily cron (`BACKUP_CRON`, default 03:00) into `BACKUP_DIR`, rotated to `BACKUP_KEEP`.
- On demand from the *Backups / Data* page or `POST /api/backups`.

Each backup is a copy of the SQLite file after a WAL checkpoint. Download from the UI or `GET /api/backups/:name/download`.

**Restore:**
1. Stop the app: `docker compose down`.
2. Replace the file at `DATABASE_URL` (i.e. `./data/homefinance.sqlite`) with the downloaded backup.
3. Restart: `docker compose up -d`.

(For an automated restore/point-in-time recovery UI, see the v2 roadmap; the manual file-swap is the MVP mechanism.)

## Local dev without Docker

See the main README. `npm run dev` runs the server (`:4000`) and Vite client (`:5173`, proxying `/api`).

## M5 — VPS / public deployment (follow-up)

> ⚠️ The app has **no login**. Never expose it directly to the public internet.

### Minimum hardening before any non-localhost exposure

1. **Network perimeter** — restrict access via a VPN (e.g. WireGuard/Tailscale) so only your devices reach it.
2. **Reverse proxy with auth** — put the app behind Caddy or Traefik with:
   - HTTPS via Let's Encrypt (automatic certs).
   - HTTP Basic Auth or a forward-auth provider (e.g. Authelia, Cloudflare Access) in front.
3. **Firewall** — only expose the reverse proxy port (443); keep `PORT` (4000) on localhost.

### Example: Caddy with Basic Auth + automatic HTTPS

`Caddyfile`:
```
finance.example.com {
    basicauth {
        <user> <bcrypt-hash>
    }
    reverse_proxy localhost:4000
}
```

Run HomeFinance on the VPS bound to localhost (`PORT=4000`, do not publish the port publicly), and let Caddy terminate TLS and enforce auth. `caddy run` will provision a Let's Encrypt certificate automatically.

### Example: Traefik

With a Traefik labels-based setup, define an entrypoint on `:443`, a Let's Encrypt ACME resolver, and a `middlewares` chain for basic-auth or forward-auth, then route `finance.example.com` to the HomeFinance container on the internal network (do not publish `4000`).

### Reinforced security guidance

- Keep `AI_API_KEY` and the SQLite data volume private; the API key never leaves the server.
- Disable AI (`AI_ENABLED=false`) if you do not want any data (aggregates only) leaving your server.
- Rotate backups off-host (e.g. sync `./backups` to object storage) for disaster recovery.
- The `docs/deployment.md` VPS section is the canonical reference; update it as the deployment evolves.