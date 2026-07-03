# Flowt Production DB Incident Review — 2026-07-03

## Executive summary

Gary was correct that the first restore was incomplete. The incident was not only a login outage; production had accepted successful Archie Home expense writes after the latest durable DB backup used for restore. Those writes are no longer present in any DB file found on the EC2 host.

The durable restore currently running is the best DB file found on disk:

- Live DB path: `/home/ubuntu/budget-server/finsync-restored-20260703.db`
- Source: `/home/ubuntu/budget-server-backup-dynamic-split-20260621-203834/finsync-promo-20260605-152030.db`
- Current watermarks: 36 users / 33 households / 504 expenses / max expense ID 591 / 95 split rows / 5 notifications

## Confirmed lost window

### What exists durably now

Archie Home (`household_id=1`) currently has 479 expenses. Durable June rows in all scanned DB files are only:

| ID | Date | Amount | Category | Paid by | Notes |
|---:|---|---:|---|---:|---|
| 465 | 2026-06-01 | 1614.40 | 🏠 Rent/Mortgage | 1 | rent |
| 509 | 2026-06-03 | 50.00 | ❤️ Charity/Donations | 2 | GOFNDME* EMERGENCY VET TORONTO |

### What logs prove was later accepted

Nginx access logs and PM2 app logs show many successful Archie Home expense writes on 2026-06-28 from Flowt iOS build 42:

- `POST /budget/api/households/1/expenses` returned HTTP 200 repeatedly from `14:14:35` through `14:57:06` UTC.
- `PUT /budget/api/households/1/expenses/598` returned HTTP 200 at `14:16:52` UTC.
- `PUT /budget/api/households/1/expenses/596` returned HTTP 200 at `14:17:05` UTC.

The presence of edits to expense IDs 596 and 598 proves runtime state had advanced beyond restored max expense ID 591.

### What cannot be recovered from current server evidence

No DB file under `/home/ubuntu` contains expense IDs >= 592. Nginx access logs record method/path/status/response size/user agent, but not request bodies or response bodies. PM2 app logs record method/path only, not body or returned JSON. Therefore the exact merchant/amount/category/date for the Jun 28 Archie writes cannot be reconstructed from EC2 logs alone.

If Gary's phone or app storage still has local cached transaction data, that may be the remaining recovery path. Otherwise the server-side evidence can prove the writes existed and were lost, but not reconstruct their content.

## Root cause chain

1. Production moved between multiple DB files over time:
   - legacy `/home/ubuntu/budget-server/finsync.db`
   - promo/current-ish `/home/ubuntu/budget-server/finsync-promo-20260605-152030.db`
   - restored `/home/ubuntu/budget-server/finsync-restored-20260703.db`
2. The backup script was hardcoded to `/home/ubuntu/budget-server/finsync.db`, so it kept backing up the stale legacy path instead of the active PM2 `BUDGET_DB_PATH`.
3. Two orphan raw `node -` processes, started Jun 5 outside PM2, were still alive in `/home/ubuntu/budget-server`. They were not serving traffic but were consistent with SQL.js in-memory autosave writers. Their activity was confirmed by `finsync.db` mtime changing every few seconds with the stale checksum.
4. The first guard only checked user/household counts, and the initial minimum was too low. This allowed stale 9-user / 13-household DBs to be treated as acceptable until stricter thresholds were added.
5. The Jun 28 successful writes likely lived in a SQL.js in-memory runtime image or a DB path that was later overwritten/removed before any correct backup captured it.

## Hardening applied

### Runtime/process

- Killed the two orphan `node -` processes.
- Verified only one `budget-server` Node process remains.
- Quarantined default `finsync.db` by moving the stale file into `backups/quarantine-default-db/` and replacing the default path with a directory. Accidental default-path starts now fail closed with `EISDIR` instead of silently running or overwriting a stale DB.

### Backend code

- Added atomic SQL.js persistence: temp file + fsync + rename.
- Added DB manifest next to the active DB with SHA-256 and watermarks.
- Added production startup regression guard against manifest watermarks going backwards.
- Added explicit production watermarks:
  - min users: 30
  - min households: 30
  - min expenses: 504
  - min maxExpenseId: 591
- Added graceful PM2 restart/termination DB flush.

### PM2/config

- PM2 now pins both:
  - `BUDGET_DB_PATH=/home/ubuntu/budget-server/finsync-restored-20260703.db`
  - `EXPECTED_BUDGET_DB_PATH=/home/ubuntu/budget-server/finsync-restored-20260703.db`
- PM2 saved dump contains restored path and expense watermarks.

### Backups/monitoring

- Replaced `/home/ubuntu/backup.sh` so it reads the live PM2 `BUDGET_DB_PATH`, validates DB watermarks, copies the active DB, copies manifest when present, writes sha256, and refuses to back up regressed DBs.
- Changed server crontab from every 6 hours to hourly verified backups.
- Added Hermes watchdog cron `36c39def7cf9` every 15 minutes. It alerts the Budgeting Platform Project chat if:
  - orphan `node -` writers reappear,
  - PM2 DB path changes,
  - counts/watermarks regress,
  - default `finsync.db` fail-closed directory disappears,
  - latest verified backup is older than 2 hours.

## Verification evidence

- Local targeted tests: 122/122 passed.
- Remote startup hardening tests: 5/5 passed.
- Public health: `https://api.gary-yong.com/budget/api/health` returned 200.
- Public authenticated smoke for Gary returned Budget Spaces:
  - Archie Home (`id=1`)
  - Sandbanks Camping Trip 2026 (`id=59`)
- Sandbanks public authenticated API returns 5 expenses totaling 342.20.
- Starting production with default `/home/ubuntu/budget-server/finsync.db` fails closed with `EISDIR`.
- Watchdog dry run returned no alerts.

## Remaining limitation

The Jun 28 Archie writes are proven by access/app logs but not recoverable from server DB files/log bodies. The only remaining possible source for exact values is client-side app/device cache or screenshots/receipts/bank exports from Gary/Emily.
