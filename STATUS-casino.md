# Casino — STATUS.md
> Updated: 2026-03-09

## What's Live
- **Frontend:** https://gary-yong.com/casino.html (S3/CloudFront)
- **API/Backend:** https://api.gary-yong.com (EC2, nginx → localhost:3001)
- **Server:** EC2, PM2 process `casino-server`, port 3001, 2 days uptime

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
- Bet history (last 200 bets per user)
- Leaderboards (all-time + per-game)
- Per-user stats + game stats
- Balance sync across games

## CS2 Betting (Data Sources)
- **bo3.gg** — primary (free, covers ESL Pro League)
- **OddsPapi** — all 18 keys exhausted
- **HLTV** — blocked (403 from EC2 IPs)
- Sync: every 2h full sync + 30min watchdog
- SSL cert valid until May 2026 (Let's Encrypt)

## Current State (2026-03-09)
- All games live and running
- No known bugs in production
- No pending local changes

## Next Actions (Backlog)
- [ ] **Revamp Roulette game — realistic roulette wheel graphics, keep 14-number system**
- [ ] Define next feature priorities / roadmap (D-004, Gary)
- [ ] Monitor OddsPapi keys — consider refreshing or removing
- [ ] User balance history UI
- [ ] Mobile UX improvements

## Decisions
- 2026-02-08: OddsPapi Key 1 exhausted — rotation from Key 2+
- 2026-02-xx: Static odds cache (2h TTL) to reduce API hits
- 2026-02-xx: Real-time settlement + webhook support
- 2026-03-07: bo3.gg confirmed as primary CS2 data source
- Roulette uses custom 14-number system (not standard 0–36)

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
