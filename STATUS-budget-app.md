# Budget App — STATUS.md
> Updated: 2026-03-10

## Infrastructure
- **receipt-server** (PM2 id:5, port 3002) — receipt/screenshot scan backend, Groq vision API, proxied at `api.gary-yong.com/receipt`. Part of FinSync — needed, do not remove.

## What's Live
- **URL:** https://gary-yong.com/budget.html (frontend via S3/CloudFront)
- **App name:** FinSync — "Smart Budgeting, Together or Solo"
- Full login/register system, shared vs. individual expense tracking, Chart.js visualizations
- Backend: PM2 `budget-server` on EC2, port 3002, online
- Receipt scanner: PM2 `receipt-server` on EC2, port 3002 (proxied via nginx)

## Current State (2026-03-10)
All changes from today's session are live on S3/CloudFront. No local-only changes pending.

## Changes Deployed — 2026-03-10

### Session 1 (Scan Feature + Search)
- **Scan: category editing fixed** — added `appearance: auto; width: 100%` to select CSS; emoji-prefix fuzzy match so AI-returned categories correctly pre-select existing canonical entries
- **Scan: paste image support** — Ctrl+V / ⌘V now loads a clipboard image directly into the scan modal; upload area shows paste hint
- **Scan: date from screenshot** — added editable date field per scanned item; date normalizer handles all AI-returned date formats (MM/DD/YYYY, "March 5, 2026", etc.)
- **Smart search** — search box now matches by: name/notes, amount (`$45`), date (`2026-03`, `march`), category, type keywords (`shared`, `solo`), person name

### Session 2 (History + Categories + Wealthsimple)
- **Change history → server-side** — panel now reads from server `activity_log` table via `/households/{id}/activity`; survives hard refresh, any browser, any device; localStorage only as offline fallback
- **Change history UX** — colored left-bar accent per action type (green=add, purple=edit, red=delete); 👥 Shared badge on entries impacting both partners; Refresh button added
- **server: `isShared` in activity log** — `households.js` updated to pass `isShared` in all `logActivity` calls so the badge is accurate
- **Scan: inline category input** — replaced native `<select>` with text input + floating dropdown; type to filter, pick to select, type something new to auto-create; no system popup
- **Wealthsimple → 💹 Investment** — 11 transactions recategorized in DB; `💹 Investment` category created in categories table

### Session 3 (Canonical Category System)
- **DB cleaned** — merged bare `Entertainment` → `🎬 Entertainment` and `Subscriptions` → `📱 Subscriptions` in both expenses and categories tables (stopped server first to avoid lock conflicts)
- **Server: `resolveCategory()`** — new function in `households.js` strips emoji prefix, fuzzy-matches existing categories case-insensitively, returns canonical name; applied to expense POST, expense PUT, and category POST endpoints; `INSERT OR IGNORE` prevents silent duplicates at DB level
- **Frontend: `canonicalizeCategory()`** — single entry point for all user/AI category input; resolves to existing canonical or creates new emoji-prefixed form; applied to: expense form submit, modal submit, `ensureCategory`, `mapToAppCategory`, `commitScanCat`, `addCustomCategory`, scan blur handler
- **`ensureCategory` rewritten** — now emoji-aware comparison; refreshes local category list from server response after sync; idempotent

## What's Local Only (Pending Deploy)
- Nothing — fully in sync

## Next Actions
- [ ] Gary: define Phase 2 feature priorities
- [ ] Brand the service — name + logo (see backlog)
- [ ] Mobile UX review
- [ ] CSV export

## Decisions
- 2026-03-09: Confirmed all batches deployed — D-002 closed
- 2026-03-10: Canonical category system implemented — duplicates now impossible at server + client layer

## Deploy Commands
```bash
# Frontend
aws s3 cp ~/clawd/PersonalWebsite/budget.html s3://gary-yong.com/budget.html --profile clawdbot-deploy
aws cloudfront create-invalidation --distribution-id EUVZ94LCG1QV2 --paths "/budget.html" --profile clawdbot-deploy

# Backend (households.js)
scp -i ~/.ssh/id_ed25519 ~/clawd/PersonalWebsite/budget-server/households.js ubuntu@52.86.178.139:/home/ubuntu/budget-server/
ssh ubuntu@52.86.178.139 -i ~/.ssh/id_ed25519 "pm2 restart budget-server"

# SQLite edits — ALWAYS stop server first!
ssh ubuntu@52.86.178.139 -i ~/.ssh/id_ed25519 "pm2 stop budget-server"
# ... run sqlite3 commands as SEPARATE invocations (not multi-statement blocks) ...
ssh ubuntu@52.86.178.139 -i ~/.ssh/id_ed25519 "pm2 start budget-server"
```

## Key Files
- `budget.html` — frontend (361 KB, S3)
- `/home/ubuntu/budget-server/households.js` — API routes incl. category normalization
- `/home/ubuntu/receipt-server.js` — AI vision scanner (Llama 4 Maverick via Groq)
- `/home/ubuntu/budget-server/finsync.db` — SQLite DB
