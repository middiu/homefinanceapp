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
| `ADMIN_INITIAL_PASSWORD` | `Pa$$word!` | initial admin password, seeded once on first boot (change on first login — forced) |
| `SESSION_TTL_MS` | `604800000` (7d) | session cookie lifetime |
| `AUTH_MAX_FAILS` | 5 | failed login attempts before account lockout |
| `AUTH_LOCKOUT_MS` | `300000` (5min) | base lockout duration (grows with repeats, capped 30min) |
| `COOKIE_SECURE` | true | session cookie `Secure` flag (set false only for plain-HTTP local testing) |
| `CORS_ORIGIN` | — | comma-separated allowed cross-origin hosts (leave empty to deny cross-origin) |

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

### In-app authentication (built-in)

The app ships with **single-user authentication** — no VPN/reverse-proxy auth is required for it to be safe, but TLS + a network perimeter are still recommended as defense in depth (see below).

- One user, `admin`, seeded on first boot with `ADMIN_INITIAL_PASSWORD` (default `Pa$$word!`). The first sign-in **forces a password reset** — you must choose a new password (min 12 chars) before reaching the app. After that, `ADMIN_INITIAL_PASSWORD` has no effect; change the password via the in-app *Change password* flow.
- Passwords are hashed with **argon2id** (memory-hard, GPU-resistant, OWASP params).
- Brute-force protection: per-IP rate limiting on `/api/auth/login` (10/15min) **plus** account lockout after `AUTH_MAX_FAILS` failed attempts (progressive, capped 30min).
- Sessions are **opaque HttpOnly SameSite=Lax cookies**, with the token stored only as a SHA-256 hash in the DB (a DB leak doesn't expose live sessions; sessions are revocable and persist across restarts). Changing the password invalidates all other sessions.
- Security headers via `helmet` + a bounded CSP.

For public exposure, still **terminate TLS** (so cookies aren't sent in the clear) and prefer a network perimeter (VPN) so only your devices reach the app.

### Minimum hardening for non-localhost exposure

1. **TLS** — terminate HTTPS via a reverse proxy (Caddy/Traefik) so the `Secure` session cookie is encrypted in transit. Set `COOKIE_SECURE=true` (default in production).
2. **Network perimeter (recommended)** — restrict access via a VPN (e.g. WireGuard/Tailscale) so only your devices reach it. In-app auth is the primary layer; this is defense in depth.
3. **Firewall** — only expose the reverse proxy port (443); keep `PORT` (4000) on localhost.

### Example: Caddy with automatic HTTPS

`Caddyfile`:
```
finance.example.com {
    reverse_proxy localhost:4000
}
```

Run HomeFinance on the VPS bound to localhost (`PORT=4000`, do not publish the port publicly), and let Caddy terminate TLS. `caddy run` will provision a Let's Encrypt certificate automatically. (Caddy/Traefik basic-auth or forward-auth is now optional — in-app auth handles sign-in — but you may layer it for additional protection.)

### Example: Traefik

With a Traefik labels-based setup, define an entrypoint on `:443` and a Let's Encrypt ACME resolver, then route `finance.example.com` to the HomeFinance container on the internal network (do not publish `4000`).

### Reinforced security guidance

- Set `ADMIN_INITIAL_PASSWORD` to something non-default before first boot, and always change it on first login.
- Keep `AI_API_KEY` and the SQLite data volume private; the API key never leaves the server.
- Disable AI (`AI_ENABLED=false`) if you do not want any data (aggregates only) leaving your server.
- Rotate backups off-host (e.g. copy the `homefinance-backups` volume contents to object storage) for disaster recovery.
- The `docs/deployment.md` VPS section is the canonical reference; update it as the deployment evolves.