# Flowt Database Operations Runbook

Updated: 2026-07-03

## Current production database

- Runtime: Node/Express + SQL.js SQLite file
- Active DB path: `/home/ubuntu/budget-server/finsync-restored-20260703.db`
- PM2 must set both:
  - `BUDGET_DB_PATH=/home/ubuntu/budget-server/finsync-restored-20260703.db`
  - `EXPECTED_BUDGET_DB_PATH=/home/ubuntu/budget-server/finsync-restored-20260703.db`
- Legacy default path `/home/ubuntu/budget-server/finsync.db` is intentionally a directory so accidental default-path startup fails closed.

## Current production watermarks

These are startup/backup/monitoring minimums. Raise them after any intentional data recovery or migration that increases durable production counts.

| Metric | Minimum |
|---|---:|
| Users | 30 |
| Budget Spaces / households | 30 |
| Expenses | 551 |
| Max expense ID | 641 |
| Archie Jun 28 recovered rows | 47 |
| Sandbanks rows | 5 |

## Monitoring cadence

### Every 15 minutes — silent watchdog

Hermes cron: `36c39def7cf9`

Script: `~/.hermes/scripts/flowt_db_watchdog.sh`

Silent when healthy. Alerts only if:

- public API health fails
- PM2 DB path changes
- users/households/expenses/max ID regress
- orphan `node -` writers appear
- default `finsync.db` fail-closed directory disappears
- latest backup is older than 2h

### Daily 9:00 AM — production health report

Hermes cron: `b72183c448be`

Script: `~/.hermes/scripts/flowt_daily_health.sh`

Reports:

- public health
- PM2 status
- DB path/watermarks
- SQLite integrity check
- Archie recovery row count
- Sandbanks row count
- orphan writer count
- latest backup age
- disk/memory

### Weekly Monday 9:30 AM — DB maintenance report

Hermes cron: `473ef12188ce`

Script: `~/.hermes/scripts/flowt_weekly_maintenance.sh`

Actions:

- creates a fresh verified backup
- performs restore drill against the latest backup using SQL.js
- checks integrity/watermarks on backup copy
- prunes only routine hourly backup files older than 14 days, while keeping at least 48 routine backups
- never prunes incident/recovery evidence directories
- reports disk, backup size, DB size, PM2 status, orphan writers

## Backup policy

### Hourly local backups

Remote cron: `/home/ubuntu/backup.sh`

Rules:

- reads live PM2 `BUDGET_DB_PATH`; do not hardcode `finsync.db`
- refuses to back up a DB below production watermarks
- writes `.db`, `.manifest.json`, and `.sha256`
- must be considered a short-term safety net only because it lives on the same EC2 disk

### Evidence backups

Never delete these without explicit approval:

- `/home/ubuntu/budget-server/backups/incident-login-dbpath-*`
- `/home/ubuntu/budget-server/backups/restore-data-loss-*`
- `/home/ubuntu/budget-server/backups/recover-archie-jun28-*`
- `/home/ubuntu/budget-server-backups/pre-category-release-20260701-120505.tgz`

## Operational rules

1. **Never run ad-hoc `node -` servers against production DB paths.**
   - This caused stale SQL.js in-memory writers to keep overwriting files.
   - Use PM2 only.

2. **Never assume `finsync.db` is production.**
   - Always read PM2 env first.
   - Verify `BUDGET_DB_PATH` and `EXPECTED_BUDGET_DB_PATH` match.

3. **Before any production DB mutation:**
   - create timestamped backup of active DB and manifest
   - run integrity/watermark check
   - stop PM2 if mutating the DB file directly
   - mutate a copy or use a tested script
   - restart PM2 with `--update-env`
   - verify public API + persistence + backup

4. **After any intentional data increase:**
   - raise PM2 watermarks
   - raise `/home/ubuntu/backup.sh` watermarks
   - raise watchdog/daily/weekly script thresholds
   - update this runbook and `STATUS-budget-app.md`

5. **Do not log sensitive request bodies globally.**
   - For future recovery/audit, prefer a bounded write-audit table in the DB rather than raw app logs.

## Recommended next infrastructure upgrades

### P0 — Already implemented

- Explicit DB path pinning
- fail-closed default path
- atomic DB writes
- manifest/watermark startup guard
- hourly verified backups
- 15-min watchdog
- daily health report
- weekly restore drill

### P1 — Should do soon

1. **Off-box backups**
   - Copy verified hourly/daily backups to S3 with versioning + lifecycle rules.
   - Keep at least: hourly 48h, daily 30d, weekly 12w, monthly 12m.

2. **Root volume capacity**
   - Current root volume is ~7.6GB and sits around 80% after cleanup.
   - Resize to at least 20–30GB or move backups/logs to attached volume/S3.

3. **Write-audit ledger**
   - Add append-only `expense_write_audit` table for POST/PUT/DELETE payload summary:
     - timestamp, user_id, household_id, method, route, resulting expense_id, amount, category, date, notes hash/truncated note, request_id
   - This would have made the Jun 28 recovery possible even without a DB archive.

4. **Migration away from SQL.js for production writes**
   - SQL.js file persistence is fragile for multi-process/server workloads.
   - Recommended target: Postgres on RDS or at minimum native SQLite with WAL and a single writer process.

### P2 — Nice to have

- CloudWatch alarms for disk, process health, API 5xx, backup age
- deploy preflight that refuses to start if another writer process exists
- one-command restore drill that spins up a disposable copy and validates API queries
- formal incident checklist in the repo
