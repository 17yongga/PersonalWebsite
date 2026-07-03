# Flowt Production DB Incident Review — 2026-07-03

## Executive summary

Gary was correct that the first restore was incomplete. This was not only a login outage; production had accepted successful Archie Home writes after the initially restored DB's latest durable Archie rows.

A second recovery pass found the missing Archie rows inside a compressed pre-category-release archive backup:

`/home/ubuntu/budget-server-backups/pre-category-release-20260701-120505.tgz`

Source DB inside archive:

`budget-server/finsync-promo-20260605-152030.db`

Those rows were merged into the active production DB on 2026-07-03 with PM2 stopped, then PM2 was restarted with raised watermarks.

## Current production state

- Live DB path: `/home/ubuntu/budget-server/finsync-restored-20260703.db`
- Current watermarks: 36 users / 33 households / 551 expenses / max expense ID 641
- Archie Home recovered IDs: 595–641
- Archie recovered expenses: 47
- Archie recovered split rows: 36
- Archie recovered total through public API: $5,425.32
- Sandbanks household 59: 5 expenses totaling $342.20

## Archie recovery details

The recovered rows cover successful writes from:

- 2026-06-28 14:14:35Z through 2026-06-28 14:57:06Z

Public API verification after merge:

| Metric | Value |
|---|---:|
| Recovered Archie rows | 47 |
| Related `expense_splits` rows | 36 |
| First recovered ID | 595 |
| Last recovered ID | 641 |
| Recovered total | $5,425.32 |

Examples:

| ID | Date | Amount | Category | Notes | Split |
|---:|---|---:|---|---|---|
| 595 | 2026-06-01 | 74.52 | 💡 Utilities | PREAUTHORIZED DEBIT TORONTO HYDRO | 50/50 |
| 596 | 2026-06-01 | 63.00 | 🍕 Food/Dining | E-TRANSFER 105969824964 Lucy | 50/50 |
| 598 | 2026-06-12 | 71.47 | 🍕 Food/Dining | E-TRANSFER 105988320895 Mike | single |
| 641 | 2026-06-28 | 2707.02 | ✈️ Travel | Flights and stays | single |

Evidence directory for the recovery merge:

`/home/ubuntu/budget-server/backups/recover-archie-jun28-20260703-232147`

That directory contains:

- active DB before merge
- manifest before merge
- source archive DB copy
- SHA256 sums
- merge result JSON

## Evidence collected

- PM2/app logs showed successful Jun 28 Archie writes.
- Nginx/access evidence showed HTTP 200 responses.
- Initial direct DB-file scans did not find IDs >=592 because the surviving copy was embedded inside a `.tgz` archive.
- Archive scan found a DB with 41 users / 35 households / 554 expenses / maxExpenseId 641.
- AWS check found no EBS snapshots or AWS Backup recovery points for the production volume in the relevant window.
- Flowt app code stores transaction lists in volatile Zustand state; it does not maintain a durable local expense cache suitable for recovery.

## Root cause chain

1. Production moved between multiple DB files over time:
   - legacy `/home/ubuntu/budget-server/finsync.db`
   - promo/current-ish `/home/ubuntu/budget-server/finsync-promo-20260605-152030.db`
   - restored `/home/ubuntu/budget-server/finsync-restored-20260703.db`
2. The backup script was hardcoded to `/home/ubuntu/budget-server/finsync.db`, so it kept backing up a stale legacy path instead of the active PM2 `BUDGET_DB_PATH`.
3. Two orphan raw `node -` processes, started Jun 5 outside PM2, were still alive in `/home/ubuntu/budget-server`. They were not serving traffic but were consistent with SQL.js in-memory autosave writers. Their activity was confirmed by `finsync.db` mtime changing every few seconds with the stale checksum.
4. The first guard only checked user/household counts, and the initial minimum was too low. This allowed stale 9-user / 13-household DBs to be treated as acceptable until stricter thresholds were added.
5. SQL.js file persistence is fragile for production when multiple processes or DB paths can exist.

## Hardening applied

### Runtime/process

- Killed orphan `node -` processes.
- Verified only one `budget-server` Node process remains.
- Quarantined default `finsync.db` and replaced it with a directory so accidental default-path starts fail closed with `EISDIR`.

### Backend code

- Added atomic SQL.js persistence: temp file + fsync + rename.
- Added DB manifest next to the active DB with SHA-256 and watermarks.
- Added production startup regression guard against manifest watermarks going backwards.
- Added explicit production watermarks:
  - min users: 30
  - min households: 30
  - min expenses: 551
  - min max expense ID: 641
- Added graceful shutdown final save before PM2 exits.

### PM2/config

- PM2 now pins:
  - `BUDGET_DB_PATH=/home/ubuntu/budget-server/finsync-restored-20260703.db`
  - `EXPECTED_BUDGET_DB_PATH=/home/ubuntu/budget-server/finsync-restored-20260703.db`
- PM2 saved dump contains restored path and updated expense watermarks.

### Backups/monitoring

- Replaced `/home/ubuntu/backup.sh` so it reads the actual PM2 `BUDGET_DB_PATH`.
- Backup script validates watermarks before copying.
- Backup script writes `.db`, `.manifest.json`, and `.sha256`.
- Added 15-minute silent Hermes watchdog.
- Added daily 9:00 AM production health report.
- Added weekly Monday 9:30 AM maintenance/restore-drill report.

## Verification

- Local targeted backend tests passed: 122/122.
- Remote startup hardening tests passed: 5/5.
- Public health endpoint returns 200/ok.
- Default-path startup fails closed.
- Public API sees 47 recovered Archie rows and split details.
- Backup after merge created successfully with 551 expenses / maxExpenseId 641.
- Daily health script passes.
- Weekly maintenance restore drill passes.

## Remaining recommendations

See `docs/flowt-db-operations-runbook.md` for the durable operating model.

Highest priority next steps:

1. Add off-box S3 backups with versioning/lifecycle.
2. Resize EC2 root volume from ~8GB to at least 20–30GB or move backups/logs off root.
3. Add append-only write-audit ledger for expense mutations.
4. Plan migration from SQL.js file persistence to Postgres/RDS or native SQLite WAL with single-writer guarantees.
