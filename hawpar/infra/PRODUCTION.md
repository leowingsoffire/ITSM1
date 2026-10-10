# Production runbook — Hawpar OCR Intelligence (cost-effective Azure)

Cheapest production-capable profile. Single B1 instance (no scale-out:
the queue + index are in-process with a durable file log on `/home/data`).

## 1. What changed for production

- Atomic JSON writes (`src/lib/atomicWrite.js`) — crash-safe stores.
- Durable queue log (`src/services/queue.service.js` + `pipeline.service.js`)
  — pending jobs in `<tenant>/queue/*.json`, recovered once per boot.
- Identity (`src/services/identity.service.js` + `identity.store.js`,
  `src/middleware/auth.js`, `src/routes/auth.routes.js` and
  `admin.routes.js`) — per-person accounts with scrypt passwords and
  lockout, HttpOnly session cookies, per-workspace roles, hashed workspace
  API keys, signed webhooks and an append-only activity log, all persisted
  under `/home/data`. The platform administrator is seeded from
  `ADMIN_EMAIL`/`ADMIN_PASSWORD`; first-run setup in the browser is disabled
  in production.
- Frontend sign-in (`src/public/js/login.js`, `session.js`) uses real
  sessions; administrators manage members, API keys, webhooks and the
  activity log under **Administration**.
- Azure profile: B1 App Service (~$12.41/mo, `infra/main.parameters.json`)
  + Document Intelligence S0 (pay per page; F0 gives 500 free pages/month
  for trials) + 30-day logs + lifecycle tiering (cool 30d, archive 180d).

## 2. Deploy (cheapest)

```powershell
az group create --name rg-vgcdoc-prod --location southeastasia
az deployment group create `
  --resource-group rg-vgcdoc-prod `
  --template-file infra/main.bicep `
  --parameters infra/main.parameters.json
```

Set on the Web App (Configuration → Application settings):

- `ADMIN_EMAIL` = the platform administrator's email (required — production
  has no browser setup, so without it nobody can sign in)
- `ADMIN_PASSWORD` = long random password, at least 10 characters. Used
  only to create the account on first boot; change it after the first
  sign-in (account menu → Change password) — later boots never overwrite it.
- `ADMIN_NAME` = display name (optional)
- `SELF_SIGNUP` = `false` for an invitation-only deployment (recommended
  unless public signup is wanted); administrators then add members.
- `RATE_LIMIT_AUTH_PER_MINUTE` = sign-in/signup attempts per client per
  minute (default 20; raise it only if many users share one egress IP)
- `API_KEY` = optional platform-wide service credential with platform
  administrator rights. Prefer per-workspace keys from Administration → API
  keys, which are scoped, role-limited and revocable.
- `ANALYZER_MODE` = `demo` to start ($0 AI cost), `azure` when ready

Never commit these values; keep `ADMIN_PASSWORD` and `API_KEY` in Key Vault
references or App Service settings only.

Deploy code: zip deploy (`az webapp deploy --type zip`) as described in the
README's deployment section — zip deploy does not delete files removed from
the repository, so clear stale ones afterwards.
Health: `GET https://<app>.azurewebsites.net/api/health`.

## 3. Monthly cost (Southeast Asia list, ~USD)

- App Service B1 × 1: ~$12.41
- Document Intelligence S0: Read $1.50 / Layout $10 per 1k pages (adaptive
  routing keeps most on Read); F0 is free for 500 pages/month but throttled
- Storage LRS + lifecycle: <$1 at this scale
- Log Analytics 30d: ~$0-3 (5 GB free)
- Key Vault + Insights: <$1

Typical demo/low-volume total: **~$13-16/mo plus pages processed**. Scale to
P0v3/P1v3 only when queue depth or latency demands it. With
`ANALYZER_MODE=azure`, keep `SELF_SIGNUP=false` unless public signup is
intended: every workspace can upload documents that are billed per page.

## 4. First-run in browser

1. Open `https://<app>.azurewebsites.net` and sign in as `ADMIN_EMAIL`.
2. Change the seeded password (account menu → Change password).
3. Administration → Members: add the people who will work in each
   workspace. Each receives a one-time password and chooses their own at
   first sign-in. Use the account menu to switch between workspaces.
4. Optional: Administration → API keys / Webhooks to connect ERP or RPA
   systems (webhook signature verification is documented in the README).
5. Administration → Workspaces (platform administrators): archive any
   workspace that should no longer be used, such as trials or test runs.
   Archiving is reversible and deletes nothing. Its members lose access and
   its API keys stop working until it is restored.
6. Upload an invoice → watch Command Centre → Review Queue → approve.
7. Prove it end to end from a workstation (read-only, safe on production):

   ```powershell
   $env:E2E_BASE = "https://<app>.azurewebsites.net"
   $env:E2E_EMAIL = "<admin email>"; $env:E2E_PASSWORD = "<password>"
   npm run smoke
   ```
