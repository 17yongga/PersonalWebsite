# CLAUDE.md — PersonalWebsite Monorepo

This repo hosts several live products. Read the relevant section before touching anything.

---

## Shared Infrastructure
- **EC2:** ubuntu@52.86.178.139 (Elastic IP: 52.86.178.139)
- **SSH:** `ssh ubuntu@52.86.178.139 -i ~/.ssh/id_ed25519`
- **S3 bucket (personal site):** `gary-yong.com`
- **CloudFront (gary-yong.com):** `EUVZ94LCG1QV2`
- **Deploy profile:** `clawdbot-deploy`
- **Nginx** proxies all subpaths + api.gary-yong.com to local ports
- **PM2** manages all Node.js services — always use `pm2 restart <name>` not raw `node`

### All PM2 Processes on EC2 (confirmed 2026-03-10)
| PM2 Name | Port | Path on EC2 | Notes |
|----------|------|-------------|-------|
| casino-server | 3001 | /home/ubuntu/casino-server.js | Public-facing |
| receipt-server | 3002 | /home/ubuntu/receipt-server.js | FinSync scan — Groq vision API, proxied at api.gary-yong.com/receipt |
| budget-server | 3003 | /home/ubuntu/budget-server/ | FinSync backend |
| mini-games | 3004 | /home/ubuntu/mini-games/ | — |
| trading-server | 3005 | /home/ubuntu/PersonalWebsite/trading/ | — |
| strategy-runner | — | /home/ubuntu/PersonalWebsite/trading/quant/ | Python quant engine |

---

## 🎰 Casino (CS2 Betting)

**Live URL:** https://api.gary-yong.com (root)
**PM2:** `casino-server` → port 3001

### Files
- `casino-server.js` — main Express server (on EC2)
- `casino.html` — frontend (S3)
- `js/casino*.js`, `js/cs2*.js` — game logic
- `css/` — styles

### Games
Blackjack, Coinflip, Crash, CS2 Betting, Pachinko, Poker, Roulette

### CS2 Betting
- **Primary:** bo3.gg scraper for match data + odds
- **Supplement:** OddsPapi (18 keys, rotation on 401/403/429, key 1 exhausted)
- `currentApiKeyIndex` — persists across calls, do NOT reset unless asked
- Fallback: ranking-based synthetic odds when real odds unavailable

### Deploy Casino Changes
```bash
# Frontend (casino.html + JS/CSS)
aws s3 sync ~/clawd/PersonalWebsite/ s3://gary-yong.com/ --profile clawdbot-deploy --exclude "*" --include "casino.html" --include "js/*" --include "css/*"
aws cloudfront create-invalidation --distribution-id EUVZ94LCG1QV2 --paths "/*" --profile clawdbot-deploy
# IMPORTANT: add cache-bust version string to <script> tags in casino.html when deploying JS changes

# Backend (casino-server.js)
scp -i ~/.ssh/id_ed25519 ~/clawd/PersonalWebsite/casino-server.js ubuntu@52.86.178.139:/home/ubuntu/PersonalWebsite/
ssh ubuntu@52.86.178.139 -i ~/.ssh/id_ed25519 "pm2 restart casino-server"
```

### Key Rules
- **NEVER** use raw EC2 IP:3001 in frontend — always use `https://api.gary-yong.com`
- SSL cert on api.gary-yong.com valid until May 2026 (Let's Encrypt)

---

## 💰 Budget Platform

**Live URL:** https://api.gary-yong.com/budget
**PM2:** `budget-server` → port 3003
**DB:** SQLite at `/home/ubuntu/budget-server/finsync.db`

### Files
- `budget.html` — frontend (S3 → gary-yong.com/budget.html)
- `budget-server/` — Express backend (on EC2)

### Users
- Gary → user_id=1
- Emily → user_id=2
- Household: "Archie Home" (household_id=1)

### Deploy Budget Changes
```bash
# Frontend
aws s3 cp ~/clawd/PersonalWebsite/budget.html s3://gary-yong.com/budget.html --profile clawdbot-deploy
aws cloudfront create-invalidation --distribution-id EUVZ94LCG1QV2 --paths "/budget.html" --profile clawdbot-deploy

# Backend
rsync -avz -e "ssh -i ~/.ssh/id_ed25519" ~/clawd/PersonalWebsite/budget-server/ ubuntu@52.86.178.139:/home/ubuntu/budget-server/
ssh ubuntu@52.86.178.139 -i ~/.ssh/id_ed25519 "pm2 restart budget-server"
```

### SQLite Rules
- Always use `PRAGMA journal_mode=OFF` when editing via sqlite3 CLI (disk space issue on EC2)
- Do NOT run multiple Node processes — zombie processes will overwrite the DB

### Pending (as of 2026-03-01)
- Tab split controls UI fix (3-button group replacing checkbox) — local only, not deployed
- Batches 1–9 local changes — confirm with Gary before mass deploy

---

## 📈 Trading Platform

**Live URL:** https://api.gary-yong.com/trading
**PM2:** `trading-dashboard` → port 3005
**Auto-trader:** DISABLED — do NOT re-enable without Gary's explicit approval

### Files
- `trading/` — dashboard server + quant engine
- `trading/quant/` — Python Alpaca API integration

### Risk Rules (hard limits)
- Max 20% portfolio in any single position
- Max 80% total invested (20% cash reserve always)

### Cron
- Hourly Mon–Fri 10am–4pm ET → posts to Trading group chat (-5154861739)

---

## 🤖 Ask Gary (RAG Chatbot)

**Status:** 🔴 Backend only — no frontend, NOT deployed
**Backend:** `ask-gary-backend/` — Python RAG pipeline

### Files
- `ask-gary-backend/main.py` — query handler
- `ask-gary-backend/index_data.py` — indexing
- `ask-gary-backend/indexed_data.json` — pre-built index
- `ask-gary-backend/config.py` — configuration

### Purpose
Answers questions about Gary (for recruiters on personal site). Impressed Deloitte R1 interviewers.

### Next Step
Build frontend + deploy to EC2. Assign port (likely 3003).

---

## 🌐 Personal Website

**Live URL:** https://gary-yong.com
**S3:** `gary-yong.com` bucket
**CloudFront:** `EUVZ94LCG1QV2`

### Files
- `gary-yong-website/` — primary static files
- Versions: root (current), v2, v2.1

### Pages
index.html, projects.html, experience.html, skills.html, about.html, blog.html, contact.html

### Deploy
```bash
aws s3 sync ~/clawd/gary-yong-website/ s3://gary-yong.com/ --profile clawdbot-deploy
aws cloudfront create-invalidation --distribution-id EUVZ94LCG1QV2 --paths "/*" --profile clawdbot-deploy
```

### Key Notes
- `deployed-*.html` files = last deployed versions (reference before editing)
- i18n.js: default language = English (do NOT auto-detect browser language)

---

## After Any Change
1. `git add -A && git commit -m "type(scope): description"`
2. Update `~/clawd/changes/<project>.md` with dated entry
3. Update `~/clawd/changes/_index.md` status
