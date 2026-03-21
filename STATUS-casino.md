# Casino — STATUS.md
> Updated: 2026-03-21

## What's Live
- **Frontend:** https://gary-yong.com/casino.html (S3/CloudFront)
- **API/Backend:** https://api.gary-yong.com (EC2, nginx → localhost:3001)
- **Server:** EC2, PM2 process `casino-server`, port 3001, online

## Games (7 total)
| Game | Type | Notes |
|------|------|-------|
| 🎡 Roulette | Solo | Custom 14-number system; color betting |
| 🪙 Coin Flip | PvP / vs Bot | Create room, join room, or play bot |
| 📈 Crash | Solo | Auto-cashout support, multiplier tracking |
| ♠️ Poker | Multiplayer | Full Texas Hold'em — tables, lobby, side pots, chat |
| 🃏 Blackjack | Solo | Standard blackjack |
| 🎮 CS2 Betting | Sports | Match betting via bo3.gg (ESL Pro League coverage) |
| 🎰 Pachinko | Solo | Custom pachinko machine with peg physics |

## Platform Features
- User auth (login/register, 10,000 starting credits)
- Achievements system (first_timer, high_roller, hot_streak, degenerate, diamond_hands, royal_flush, card_sharp, lucky_seven, to_the_moon)
- Bet history (last 200 bets per user, all 7 games tracked)
- Leaderboards (all-time + per-game)
- Per-user stats + game stats
- Balance sync across games

## CS2 Betting (Data Sources)
- **bo3.gg** — sole data source (free, covers ESL Pro League)
- **OddsPapi** — REMOVED (all 18 keys exhausted; cs2-api-client.js, cs2-odds-provider.js, cs2-odds-config.js deleted)
- **HLTV** — blocked (403 from EC2 IPs); cs2-free-result-sources.js kept for settlement fallback
- Sync: Daily at 2 AM UTC + 2h settlement check
- SSL cert valid until May 2026 (Let's Encrypt)

## Current State (2026-03-15)
- All games live and running
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

## Next Actions (Backlog)
- [x] Revamp Roulette game — flat belt-style design (CSGOEmpire/Stake inspired), deployed Mar 10
- [x] **Bet history UI — fixed + full UI overhaul, deployed Mar 13**
- [ ] Gary to test bet history UI (pending)
- [x] **OddsPapi removed — bo3.gg sole data source (Mar 21)**
- [x] **Mobile UX improvements — full pass all 7 games + lobby, deployed Mar 14**
- [ ] Gary to test mobile UX on phone (pending)
- [x] **Payout realism audit — all 7 games reviewed, Pachinko multipliers fixed (Mar 15)**

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
ssh ubuntu@52.86.178.139 -i ~/.ssh/id_ed25519
pm2 restart casino-server
# For code changes (frontend):
aws s3 cp PersonalWebsite/casino.html s3://gary-yong.com/casino.html --profile clawdbot-deploy
aws cloudfront create-invalidation --distribution-id EUVZ94LCG1QV2 --paths "/casino.html" --profile clawdbot-deploy
# For server changes:
scp PersonalWebsite/casino-server.js ubuntu@52.86.178.139:~/
pm2 restart casino-server
```

## Key Files
- `/home/ubuntu/casino-server.js` — main server (EC2)
- `/home/ubuntu/cs2-bo3gg-client.js` — bo3.gg data client
- `/home/ubuntu/cs2-api-cache.json` — cached match data (2h TTL)
- `/home/ubuntu/data/cs2-betting-data.json` — CS2 state file
- `/home/ubuntu/data/bet-history.json` — all user bet history
