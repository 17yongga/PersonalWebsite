# Casino — STATUS.md
> Updated: 2026-08-02

## Live Coordinated Release — `neon777-20260802-r45` (2026-08-02)
- **Coordinated scope:** the verified mobile Blackjack and server-authoritative split-hand work is packaged together with a self-healing shared Web Audio lifecycle, contextual authoritative-timed cues, impact-sensitive Pachinko peg audio, authoritative-tick-driven Crash rhythm, and atomic server-authoritative Roulette set/replace/clear.
- **Audio lifecycle:** closed contexts are recreated; suspended/interrupted contexts recover from trusted gestures; muted, hidden, pre-unlock, and failed playback stays silent/retryable; `playOnce` keys commit only after scheduling succeeds; unknown effects fail explicitly; diagnostics, dedupe state, listeners, timers, and procedural noise allocation are bounded.
- **Contextual cues:** Blackjack, Roulette, Crash, Pachinko, Coinflip, Poker, CS Cases, and shared UI hooks now distinguish local selection feedback from authoritative monetary acceptance. Pachinko peg strength/pan derives from genuine inward impact, and Crash cadence derives from authoritative multiplier ticks without an independent interval.
- **Roulette authority:** one account owns one round wager/escrow across sockets. Create, amount change, colour replacement, and clear use per-user serialization and one atomic ledger transition, recheck round/spin legality after lock acquisition, replay exact requests without repeating movement, reject changed payloads under reused IDs, survive reconnects, and ignore stale callbacks or stale-round broadcasts.
- **Blackjack/mobile:** compact fixed-height wager geometry, circular chips, equal Hit/Stand/Double/Split controls, progressive card overlap, restrained score glow, per-hand results, and exact-rank server-authoritative split behavior remain included.
- **Source verification:** full suite **96/96 passed** after the final stale-round guard; all changed runtime JavaScript passed syntax checks and focused `git diff --check` passed. Atomic replacement benchmark over 200 mutations measured p50 `0.384 ms`, p95 `0.636 ms`, max `1.232 ms`, with exact ending balance and zero active escrows.
- **Exact-package browser QA:** Roulette/audio QA passed at 390px and 1280px with Red → Black replacement, `BLACK — 250 credits`, readable active BLACK label, stale-round rejection, accepted/replaced/cancelled/rejected cue counts, AudioContext recreation, explicit unknown-effect failure, zero listener/timer leaks, zero console/resource errors, and zero horizontal overflow. Blackjack passed all **8/8** wager/pair/crowded/split views at 390px and 1280px; the mobile table origin stayed exactly `430.484375px`.
- **Immutable package:** Linux x86_64 `r45` contains 6,282 manifested files with production dependencies installed before hashing, 199/199 source files byte-identical to the locally verified candidate, zero missing/extra files, symlinks, or writable package paths. Exact backend QA passed place → replace → replay → changed-payload rejection → clear and restart with final balance restored.
- **Copied-production-data rehearsal:** the Linux candidate started and restarted healthy on an isolated copy. The copy and untouched production both remained at 39 accounts, one active escrow, `409,240.008` credits, and SQLite integrity `ok`. Live PM2 stayed online without restart; rehearsal port closed cleanly.
- **Production deployment:** frontend and backend `r45` are live. The backend stable pointer resolves to `/home/ubuntu/casino-app/releases/neon777-20260802-r45/backend`; PM2 is online on the stable `current/casino-server.js` path and passed a second restart-persistence check. The frontend entry hash is `ff46091b6bb37456b53e123b0a2021dfb3c07271bb844e30dfccbc098cab1834`; CloudFront invalidation `I8TV5CQWIETNMMIYYZTPIOFJPR` completed.
- **Live no-wager verification:** all **180/180** packaged frontend files matched production byte-for-byte. Login QA passed at 390px and 1280px with all 25 runtime references on `r45`, zero console/page/network/static-resource errors, zero overflow, sound still off by default, and clean visual review. Public health is 200 with projection `ok`; unauthenticated session is 401, unauthenticated Socket.IO is rejected, hostile-origin preflight is 403, SQLite integrity is `ok`, all nine unrelated PM2 processes stayed unchanged, and no new Casino error-log entry appeared after the final start.
- **Production state preserved:** the final restart retained 39 accounts, one active escrow, and `409,340.008` credits exactly. No production wager or QA account was used. The higher balance than the earlier rehearsal snapshot existed before the final cutover and was preserved through deployment and restart.
- **Rollback:** immediate frontend rollback is `r44`; backend rollback is `r35`. Owner-only pre-cutover and final snapshots, PM2 environment, hashes, and the previous release pointer are stored at `/home/ubuntu/casino-backups/pre-r45-20260802T190916Z`.
- **Evidence:** `audits/blackjack-mobile-2026-08-02/`, `audits/casino-audio-roulette-2026-08-02/`, local package `/tmp/neon777-releases/neon777-20260802-r45`, Linux package `/tmp/neon777-r45-linux-release/neon777-20260802-r45`, and live login captures `live-login-390.png` / `live-login-1280.png`. Subjective listening remains Gary's human acceptance check; technical synthesis, scheduling, recovery, cleanup, and live delivery are verified.

## What's Live
- **Frontend:** `r45` at https://gary-yong.com/casino.html (S3/CloudFront)
- **API/Backend:** `r45` at https://api.gary-yong.com (EC2, nginx → localhost:3001)
- **Server:** EC2, PM2 process `casino-server`, port 3001, online; stable pointer targets `neon777-20260802-r45/backend`

## Games (8 total)
| Game | Type | Notes |
|------|------|-------|
| 🎡 Roulette | Solo | Custom 14-number system; color betting |
| 🪙 Coin Flip | PvP / vs Bot | Create room, join room, or play bot |
| 📈 Crash | Solo | Auto-cashout support, multiplier tracking |
| ♠️ Poker | Multiplayer | Full Texas Hold'em — tables, lobby, side pots, chat |
| 🃏 Blackjack | Solo | Standard blackjack |
| 🎮 CS2 Betting | Sports | Match betting via bo3.gg (ESL Pro League coverage) |
| 🎰 Pachinko | Solo | Custom pachinko machine with peg physics |
| 🧰 CS Cases | Solo / PvP / vs Bot | Canonical virtual CS2 skins, disclosed cases, inventory, case battles, commit/reveal fairness |

## Platform Features
- User auth (login/register, 10,000 starting credits)
- Achievements system (first_timer, high_roller, hot_streak, degenerate, diamond_hands, royal_flush, card_sharp, lucky_seven, to_the_moon)
- Bet history (last 200 bets per user, all 8 games tracked)
- Leaderboards (all-time + per-game)
- Per-user stats + game stats
- Balance sync across games
- Accessible opt-in sound effects, off by default and persisted per browser

## CS2 Betting (Data Sources)
- **bo3.gg** — sole data source (free, covers ESL Pro League)
- **OddsPapi** — REMOVED (all 18 keys exhausted; cs2-api-client.js, cs2-odds-provider.js, cs2-odds-config.js deleted)
- **HLTV** — blocked (403 from EC2 IPs); cs2-free-result-sources.js kept for settlement fallback
- Sync: Live odds every 15 minutes; settlement check every 2 hours
- SSL: API certificate valid through 2026-08-31; Certbot renewal timer enabled

## Current State (2026-08-01)
- **Shared-host capacity audit and storage expansion complete:** production remains a `t3.small` (2 vCPU / 2 GiB) with ~958 MB currently available, near-idle CPU, no swap, and no recent OOM kills. The live `casino-server` including CS Cases uses ~92.6 MB RSS; the six-case/30-item catalog is 7.9 KB over the API and case state is SQLite-backed (266 KB DB + 4.2 MB WAL), so CS Cases is not currently a material RAM driver. Gary expanded the EBS device from 8 to 20 GiB; the root partition and ext4 filesystem were then grown online to 19.9/20 GiB. Final root use is 6.5 GiB / 34% with 13 GiB available. All PM2 services stayed online without restarts, public casino/Flowt/receipt probes returned 200, and no kernel/ext4/NVMe errors appeared. A `t3.medium` remains optional resilience headroom, not a current requirement.
- **Natural authoritative Pachinko trajectories are live:** immutable frontend `releases/neon777-20260801-r44`; unchanged backend `/home/ubuntu/casino-app/releases/neon777-20260801-r35` through the stable PM2 symlink. The old 18-frame horizontal interpolation at the bottom is removed. Server-selected destinations now receive width-scaled guidance distributed through the complete peg descent with decaying path variation; final slot entry is permitted only after the ball is already horizontally inside its authoritative lane, and the confirmation descent preserves that exact x-coordinate. Resolution no longer recenters the ball. The `r42` per-batch ledger still enables consecutive accepted animations while hiding every unresolved payout through its matching visible slot hold. Peg overlap remains geometrically separated with inward-only velocity reflection, rejected requests create no ball or speculative debit, and teardown reconciles the latest accepted authoritative balance. The coordinated `r40` responsive layouts, `r35` Roulette ordering repair, and `r34` username/password signup fallback remain active.
- Blackjack now preserves card identity/position, reveals the real dealer hole card, uses a clearer stake composer, and presents uniform actions. Roulette starts its authoritative motion immediately and preserves green zero styling. Coinflip keeps distinct Heads/Tails faces, Crash locks requested cash-out feedback pending server acknowledgement, Pachinko uses faster gravity-driven motion, and viewed badge notifications clear per user.
- CS2 mobile now uses one deliberate column through 768px, a compact header, one `LIVE` indication per live match, explicit unpublished/stale/paused market explanations, and a visible responsive My Bets portfolio with Open/History tabs and empty state. Only fresh active bookmaker odds remain wagerable.
- CS Cases now uses 30 canonical Counter-Strike skin names/images across six disclosed cases, with ByMykel CSGO-API/Valve attribution and non-affiliation notice. Server-selected outcomes are presented through staged transform reels; battles reveal round by round with running totals and delayed winner disclosure. Synthesized sounds, reduced-motion fallbacks, timer cleanup, bounded imagery, and responsive overflow/text handling are deployed without copied competitor assets or trade dress.
- The SQLite milli-credit ledger remains canonical for accounts, wagers, escrow, settlements, case inventory, and battles. Final `r44` verification preserved 38 real accounts and two active escrows totaling 485 credits (`cs2betting`, `case_battle`), with integrity `ok` and zero foreign-key failures. This was a frontend-only release and did not restart or replace the backend.
- Verification: 86/86 source tests, including deterministic convergence through all 17 authoritative slots; valid 199-entry immutable SHA-256 manifest; three complete stochastic exact-package audits covering edge and non-edge pairs at 390px and 1440px (24 mocked presentations total). Every final descent and resolution had zero horizontal displacement, trajectories recorded 13–28 direction changes per two-ball run, no ball remained near-stationary beyond seven frames, requests remained serialized while animations overlapped, and confirmation-gated balances remained correct under out-of-order landings. There were no failed resources, runtime errors, or overflow. All 25 release references and 30 skin images returned 200, the public Pachinko asset matched the immutable package byte-for-byte, and the production root loaded 16 `r44` scripts plus nine `r44` styles. No production wager was placed.
- Immediate frontend rollback: `neon777-20260801-r42`; backend remains `r35` with private snapshot `/home/ubuntu/casino-backups/pre-r35-20260801T161106Z`. Earlier `r29` remains available as the pre-remediation rollback.
- Opaque HttpOnly sessions, CSRF/origin checks, per-event Socket.IO session revalidation, server-owned balances/outcomes, protected CS2 routes, atomic mode-0600 persistence, CSPRNG results, safer DOM rendering, vendored Socket.IO, and document CSP are deployed.
- Responsive/accessibility remediation is deployed. The final 20-screen axe WCAG A/AA matrix has zero serious/critical violations; the 24-screen responsive matrix has zero overflow, console errors, failed requests, unlabeled inputs, excessive glow, or non-skip mobile small targets.
- Operations remediation is live: API HTTP→HTTPS, casino-specific public health routing, duplicate-nginx cleanup, 64 KB nginx body boundary, restrictive data/backup modes, 30-day complete backup retention, casino-only watchdog, PM2 log rotation, isolated dependencies, immutable assets, manifests, and explicit rollback packages. Root disk improved from 82% to 78%.
- **Residual risk:** signup works without email verification by Gary's explicit temporary choice. Password recovery remains unavailable because no email becomes trusted. The `gary-yong.com` SES identity is DKIM-verified, but the EC2 runtime role still needs narrowly scoped sending authorization before verification/recovery can be re-enabled. CloudFront response-header policy, compression, and private S3/OAC remain blocked by current AWS IAM permissions. Treat this release as hardened play-money software, not a real-money system.
- **Premium visuals and sound effects deployed (Jul 31):** immutable dependency-complete frontend `neon777-20260731-r19` is live through S3/CloudFront.
  - Every game now uses a coordinated premium surface, depth, spacing, controls, interaction feedback, responsive behavior, and reduced-motion fallback. Blackjack retains the custom NEON 777 deck, sequenced deal/reveal motion, tactile chips, authoritative busy states, and H/S/D/N keyboard actions.
  - Centralized procedural Web Audio adds restrained game-specific cues for Blackjack cards/results, Roulette, Coinflip, Crash, Pachinko, Poker, and CS2. Sound is off by default, requires a user gesture, persists locally, can be muted immediately, stays scoped to the visible game, and has synchronized 44px desktop/mobile controls.
  - A post-release lifecycle audit was reconciled in `r19`: persisted-enabled state cannot create audio from programmatic or gameplay events before a trusted gesture; hidden tabs stay silent; restored Blackjack snapshots hydrate silently; Coinflip cancels delayed result audio on teardown and keys rounds from fairness data; Roulette spin/results use stable one-shot keys.
  - QA: full source suite 44/44; immutable SHA-256 manifest valid; exact packaged backend starts and survives restart; sound lifecycle, pre-gesture lock, silent hydration, hidden-tab suppression, muted/persisted state, all synthesized effects, general seven-game, Coinflip/Poker, CS2 listener lifecycle, physical lobby PLAY click, and mobile/reduced-motion Blackjack journeys pass.
  - Local and live 36-case desktop/mobile matrices have zero serious/critical accessibility findings, horizontal overflow, or unlabeled controls. Live asset hashes match the immutable candidate and the existing production API remained healthy without a backend restart or real wager.
  - Evidence: `~/clawd/audits/casino-remediation-2026-07-29/r19-ui/` and `r18-live-ui/`.
- **CS2 mobile betting UI cleanup deployed (May 11)** — tightened the full mobile CS2 flow after browser dogfooding: removed duplicate in-game balance block, compacted tournament/match cards and odds pills, reduced header/back-row chrome, added bottom-nav clearance, and clarified bet-slip payout copy (`Stake`, `Odds`, `Total return`, `Profit`).
  - Verification: local 390px Puppeteer pass opened CS2 betting, loaded active events, selected an odds pill, and confirmed the bet slip bottom sheet shows payout/actions without clipping; production cache-bust `v=202605111705` is live through CloudFront.
- **CS2 live odds monitor deployed (May 11)** — bo3.gg sync now force-refreshes every 15 minutes, manual refresh bypasses stale cache, started matches are promoted to LIVE for the first 4 hours, and odds movement metadata/UI arrows are wired into CS2 betting cards.
  - Verification: production `/api/cs2/events` returned 40 active events, including 10 LIVE bettable matches after sync; casino page cache-bust `v=202605111640` is live through CloudFront.
- **Mobile UX improvements deployed (Mar 14)** — full pass across all 7 games + lobby
  - Lobby: 2-column game grid on mobile, compact header/cards
  - Blackjack: stacked insurance buttons, 44px touch targets
  - Coin Flip: full-width form fields, proper room list stacking
  - Crash: bet sidebar stacks ABOVE chart on mobile, canvas fills width
  - Pachinko: controls first on mobile, canvas responsive
  - Poker: 2-col action buttons, full-width modal inputs, better felt scaling
  - CS2 Betting: scrollable filter tabs, full-screen bet modal on mobile
  - Roulette: filled gaps in responsive styles
  - Global: 16px min font-size on all inputs (prevents iOS zoom), touch-action: manipulation, momentum scrolling
  - Supports 375px minimum (iPhone SE) through 768px (tablet)
- Bet history UI overhauled and deployed (Mar 13)
  - Fixed: Poker and CS2 Betting were missing from history (server-side bug)
  - Added: game filter tabs, win rate stat, relative timestamps, result/multiplier badges
  - Loads 100 entries (up from 50); server stores up to 200
  - Mobile: bottom-sheet style modal
- **Payout realism audit + Pachinko fix (Mar 15)** — full audit of all 7 games:
  - Crash: 1% HE via 0.99 formula ✅ authentic
  - Roulette: 6.67% HE (14-number custom system) ✅ acceptable
  - Blackjack: 3:2 natural, standard dealer rules ✅ authentic
  - Coin Flip: 0% HE (fair PvP, no rake) ✅ correct
  - Poker: No rake (play-money multiplayer) ✅ fine
  - CS2 Betting: Real bookmaker margin via bo3.gg odds ✅ authentic
  - Pachinko: 🔴→✅ Fixed — old multipliers gave 7–64% RTP (broken). New: Stake-calibrated low/medium/high
    - Low: `[16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, ...]` ~99% RTP
    - Medium: `[170, 24, 8, 2, 0.7, 0.7, 0.6, 0.4, 0.2, ...]` ~97% RTP
    - High: `[1000, 130, 26, 9, 4, 2, 0.2, ...]` ~99% RTP (jackpot-style, no 0x traps)
- **How to Play modals (Mar 16)** — added 📖 How to Play to all 7 games
  - Lobby: "How to Play" button on each game card (below "Play Now")
  - In-game: persistent button next to Back to Lobby
  - Full modal per game: rules, card/bet values, payouts, tips
  - Mobile: bottom-sheet style on small screens
  - Light/dark theme aware
- **OddsPapi cleanup (Mar 21)** — removed entirely; bo3.gg is now the sole CS2 data source
  - Deleted: cs2-api-client.js, cs2-odds-provider.js, cs2-odds-config.js from EC2
  - casino-server.js: 499 lines removed (5133 → 4634), all key rotation / rate-limit logic gone
  - Data flow: syncCS2Events() → cs2Bo3ggClient directly → synthetic odds fallback (local ranking-based)
  - Settlement: cs2Bo3ggClient.fetchRecentResults() + cs2-free-result-sources.js (HLTV/Liquipedia)
  - No known bugs in production
- **UI redesign audit (Apr 11)** — reviewed earlier proposal vs actual state:
  - Already implemented: glassmorphism match cards, tier-specific gradient borders, tier badges, collapsible tournament sections, pill-shaped odds buttons, countdown timers, slide-in bet slip, sticky sidebar
  - Remaining (backlog): live odds movement indicators, typography hierarchy, empty state illustrations, bet placement confetti animation, always-visible My Bets sidebar on desktop
  - Gary confirmed no further changes needed — remaining items added to backlog
- **Mobile login screen fix (May 3)** — deployed casino.css/casino.html cache-bust
  - Reduced title glow on mobile so NEON 777 remains readable
  - Prevented auth card/input horizontal bleed on narrow screens
  - Hid bottom nav/ticker while login screen is visible
  - Verified locally at 390px viewport: document width equals viewport width, no overflow
- **Mobile platform formatting polish (May 3)** — deployed casino.css/games.css/casino.html cache-bust
  - Audited lobby + all 7 game screens at 390px and 375px mobile widths
  - Tightened mobile header spacing so logo, balance, +Credits, and menu fit cleanly
  - Fixed lobby hero/stat-card right-edge clipping on 375px screens and real-phone browser chrome heights
  - Fixed overlay modals being vertically centered/cut off on mobile; overlays now start at top and scroll
  - Fixed roulette betting/info panels and controls bleeding past viewport
  - Compact blackjack mobile table: active hand hides locked bet strip, shorter card zones, smaller cards, sticky action buttons visible above bottom nav
  - Verification: local mobile checks report zero horizontal overflow on lobby/blackjack/modal scenarios
- **Mobile Blackjack + lobby card polish (May 3)** — deployed casino.css/games.css/blackjack.js/casino.html cache-bust
  - Fixed remaining mobile lobby card title/tag overlap for long titles like Pachinko, Texas Hold'em, and CS2 Betting
  - Blackjack insurance state is now compact: shorter copy, smaller active card zones, two-column insurance actions, and normal Hit/Stand controls hidden while insurance is pending
  - Verification: Chrome mobile emulation at 393px shows zero horizontal overflow, no lobby tag/title overlap, and Blackjack insurance table fits above bottom nav in a constrained 730px viewport

## Comprehensive Production Audit (2026-07-28)
- **Status: 🟡 Hardened release deployed and verified; durable universal transaction/recovery ledger and AWS edge hardening remain open.**
- Completed visual, responsive UI/UX, accessibility, client-functionality, REST/Socket.IO, server, nginx/TLS, persistence, backup, dependency, deployment-parity, and test review.
- Evidence: 24 production screenshots plus machine-readable metrics at `~/clawd/audits/casino-2026-07-28/`.
- Full report: `~/clawd/audits/casino-2026-07-28/CASINO-COMPREHENSIVE-AUDIT-2026-07-28.md`.
- Findings: **36 total** — 4 critical, 8 high, 18 medium, 6 low.
- Critical: no authenticated session binding after login; client-authoritative balance/outcome sync; unauthenticated CS2 user/admin mutations; stored-XSS exposure through unescaped server-derived values.
- Major UI regressions: desktop ticker overlays gameplay; mobile bottom nav blocks Blackjack/CS2 and other game controls; tour overflows/clips; desktop login wordmark is broken; hard-coded “live” activity/financial claims are presented as real.
- Operations: PM2/API/Socket.IO/TLS/backups are currently reachable/healthy; production is not reproducible from clean Git, public health checks target the wrong service, API HTTP does not redirect to HTTPS, root disk is 81% used, backup retention is partial, and logs are dominated by repeated odds-correction messages.
- Tests: Poker engine 117/117 pass; Blackjack 5/7 after adding missing fixture, with both failures caused by defective test assertions.
- Initial audit was read-only. Coordinated remediation releases were deployed on 2026-07-28/29 with checksummed rollback artifacts and no production wagers.

## Next Actions (Backlog)
- [x] **P0 security containment:** authenticated user/admin sessions; remove caller-supplied identity and client-authoritative balance/outcome updates; sanitize untrusted rendering; rate-limit protected routes
- [x] **P1 game/data integrity:** transactional SQLite ledger/datastore, server-authoritative games, CSPRNG/commit-reveal outcomes, escrow, idempotency, and restart/concurrency recovery deployed in `r29`
- [x] **P1 global UI obstruction fix:** removed fabricated ticker and validated mobile-nav clearance across the required desktop/mobile matrix
- [x] **P2 interface remediation:** repaired glow/dialog/accessibility/labels/targets/mobile density and removed misleading live/real-money content
- [x] **P2 deployment/operations core:** immutable frontend/backend releases, manifests, rollback, casino health, backup permissions/retention, isolated dependencies, log rotation, watchdog, nginx cleanup
- [ ] **AWS edge hardening (IAM-blocked):** CloudFront response-header policy/compression and private S3 origin/OAC
- [x] Revamp Roulette game — flat belt-style design (CSGOEmpire/Stake inspired), deployed Mar 10
- [x] **Bet history UI — fixed + full UI overhaul, deployed Mar 13**
- [ ] Gary to test bet history UI (pending)
- [x] **OddsPapi removed — bo3.gg sole data source (Mar 21)**
- [x] **Mobile UX improvements — full pass all 7 games + lobby, deployed Mar 14**
- [ ] Gary to test mobile UX on phone (pending)
- [x] **Payout realism audit — all 7 games reviewed, Pachinko multipliers fixed (Mar 15)**
- [x] **UI redesign audit — most items already implemented, 5 minor items added to backlog (Apr 11)**
- [x] **Live odds movement indicators + live-match monitor (deployed May 11)** — ↑↓ arrows, 15-min bo3.gg force refresh, started matches surfaced as LIVE
- [ ] Typography hierarchy improvements
- [ ] Bet placement confetti/success animation
- [ ] Improved empty states with illustrations
- [x] My Bets promoted to a full-width desktop portfolio workspace with retained Open/History tab
- [ ] Configure a Casino-owned SMTP/SES sender for registration verification and password recovery

## Decisions
- 2026-02-08: OddsPapi Key 1 exhausted — rotation from Key 2+
- 2026-02-xx: Static odds cache (2h TTL) to reduce API hits
- 2026-02-xx: Real-time settlement + webhook support
- 2026-03-07: bo3.gg confirmed as primary CS2 data source
- Roulette uses custom 14-number system (not standard 0–36)
- 2026-03-13: Bet history bug fixed — Poker + CS2 Betting now record via server-side addBetRecord
- 2026-03-21: OddsPapi removed entirely — bo3.gg sole CS2 data source; 499 lines cleaned from casino-server.js

## Deploy / Restart
```bash
# Build and test immutable releases first. Never copy only casino-server.js.
# Backend target: /home/ubuntu/casino-app/releases/<release>
# Stable PM2 entry: /home/ubuntu/casino-app/current/casino-server.js
# Required env: CASINO_DATA_DIR=/home/ubuntu, PORT=3001, NODE_ENV=production
ssh ubuntu@52.86.178.139 -i ~/.ssh/id_ed25519 'pm2 restart casino-server --update-env'
# Upload immutable frontend assets before switching casino.html; casino.html is no-cache.
aws cloudfront create-invalidation --distribution-id EUVZ94LCG1QV2 --paths "/casino.html" --profile clawdbot-deploy
```

## Key Files
- `/home/ubuntu/casino-app/current/casino-server.js` — stable PM2 entry to immutable release
- `/home/ubuntu/cs2-bo3gg-client.js` — bo3.gg data client
- `/home/ubuntu/cs2-api-cache.json` — cached match data (2h TTL)
- `/home/ubuntu/data/cs2-betting-data.json` — CS2 state file
- `/home/ubuntu/data/bet-history.json` — all user bet history
