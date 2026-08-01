# Deployment

## Local — Podman Compose (recommended for self-hosting)

```bash
cp .env.example .env        # set AI_API_KEY etc. if you want AI features
podman compose up --build -d
```

Open <http://localhost:4000>. The single container runs the Express API and serves the built React SPA. Docker works identically — substitute `docker compose` for `podman compose` everywhere below.

### Reusable named volumes (data survives image rebuilds)

The SQLite database and backups are stored in **named volumes**, not bind mounts:

| Volume | Mount | Contents |
|---|---|---|
| `homefinance-db` | `/data` | `homefinance.sqlite` (+ WAL/shm) |
| `homefinance-backups` | `/backups` | daily + manual backup copies |

Because they are named volumes, your data persists across `podman compose down` and is **not lost when you build a new image** (`podman compose up --build`). To reuse the same data with a freshly built image, just rebuild — the volume is re-attached automatically.

Manage volumes:
```bash
podman volume ls
podman volume inspect homefinance-db
# back up the volume contents to host:
podman run --rm -v homefinance-db:/data -v "$PWD":/out alpine tar czf /out/homefinance-db.tgz -C /data .
# restore into a fresh volume:
podman volume create homefinance-db
podman run --rm -v homefinance-db:/data -v "$PWD":/out alpine tar xzf /out/homefinance-db.tgz -C /data
```

Stop: `podman compose down`. Rebuild after code changes: `podman compose up --build -d`. Remove volumes (destroys data): `podman compose down -v`.

### What the container does

- Builds `shared`, `server`, and `client` inside the image.
- Boots `node server/dist/index.js`, which itself bootstraps tables + seeds default categories (idempotent).
- Serves the Express API on `PORT` and the built React SPA from the same origin.
- `node-cron` schedules the weekly AI digest (`AI_DIGEST_CRON`) and daily backup (`BACKUP_CRON`).

### Environment

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 4000 | HTTP port |
| `DATABASE_URL` | `./data/homefinance.sqlite` | SQLite path — container overrides to `/data/homefinance.sqlite` (named volume `homefinance-db`) |
| `AI_ENABLED` | true | master switch for AI features |
| `AI_BASE_URL` | `https://ollama.com/v1` | Ollama Cloud (OpenAI-compatible) base URL |
| `AI_API_KEY` | — | required for AI calls; stored server-side only |
| `AI_MODEL` | llama3.1 | model id |
| `AI_DIGEST_CRON` | `0 7 * * 1` | weekly digest schedule |
| `BACKUP_DIR` | `./backups` | backup directory — container overrides to `/backups` (named volume `homefinance-backups`) |
| `BACKUP_CRON` | `0 3 * * *` | daily backup schedule |
| `BACKUP_KEEP` | 14 | backups to retain (rotation) |

## Backup & restore

**Backups** are created:
- Automatically by the daily cron (`BACKUP_CRON`, default 03:00) into `BACKUP_DIR`, rotated to `BACKUP_KEEP`.
- On demand from the *Backups / Data* page or `POST /api/backups`.

Each backup is a copy of the SQLite file after a WAL checkpoint. Download from the UI or `GET /api/backups/:name/download`.

**Restore** (manual file-swap, the MVP mechanism — automated restore is on the v2 roadmap):

The DB lives in the named volume `homefinance-db` at `/data/homefinance.sqlite`. Two options:

- **Via the volume** (recommended): stop the app, copy the backup file into the volume, restart.
  ```bash
  podman compose down
  podman run --rm -v homefinance-db:/data -v "$PWD":/out alpine \
    sh -c 'cp /out/<backup-name> /data/homefinance.sqlite'
  podman compose up -d
  ```
- **Into a fresh volume** (if you removed the old one): recreate the volume, extract a volume tarball (see the volume-management block above), then `podman compose up -d`.

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
- Rotate backups off-host (e.g. copy the `homefinance-backups` volume contents to object storage) for disaster recovery.
- The `docs/deployment.md` VPS section is the canonical reference; update it as the deployment evolves.