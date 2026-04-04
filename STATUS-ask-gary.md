# Ask Gary (RAG Chatbot) — STATUS.md
> Updated: 2026-03-16

## What's Live
- **Frontend:** https://gary-yong.com/ask-gary.html (S3/CloudFront)
- **Backend:** https://api.gary-yong.com → port 8000 (nginx proxied)
- **Stack:** Python FastAPI + RAG (indexed knowledge base) + static HTML/JS frontend
- **Status:** ✅ Live and healthy (verified 2026-03-15)

## Architecture
- Frontend: `ask-gary.html` + `ask-gary.js` on S3
- Backend: `/home/ubuntu/PersonalWebsite/ask-gary-backend/` on EC2
  - `main.py` — FastAPI server (uvicorn, port 8000)
  - `index_data.py` — indexing script
  - `indexed_data.json` — indexed knowledge base (**115 chunks**)
  - `config.py` — configuration
- **Managed by systemd** (NOT PM2 — intentional, correct for Python services)
  - Service: `ask-gary.service`
  - Bug fixed 2026-03-10: was using `Type=notify`, causing crash loop every ~90s (4,240+ restarts). Fixed to `Type=simple` — now stable.

## Current State (2026-03-15)
- Live and responding (HTTP 200 on /health)
- **Knowledge base re-indexed: 2026-03-15** ✅ (115 chunks, up from 111)
- Projects in KB: Mini Games, **Flowt** (Budget App), CS2 Casino, Trading Dashboard (PaperTrade), Ask Gary, Personal Website, Capco Consulting
- YongAI consulting data excluded per Gary's decision (2026-03-14)
- **QA pass completed: 2026-03-14** — 25/25 questions passed
- **KB expansion completed: 2026-03-15** — Trading, Flowt, Capco entries enriched
- Successfully demoed to Deloitte R1 interviewers (Feb 9) — positive reception

## KB Expansion — 2026-03-15
- **Trading Dashboard** renamed to PaperTrade; added 5 strategy names (Momentum, Mean Reversion, Volatility Breakout, Value & Dividends, Sentiment), Phase 2 features (Backtesting Panel, Risk Dashboard), key metrics (Sharpe/Sortino/Calmar)
- **FinSync → Flowt** — renamed; expanded with AI receipt scanning (Llama 4 Scout), canonical category system (50+ aliases, 3-pass resolution), overpayment-aware balance reconciliation, smart search, Phase 2 mobile app plan (React Native + Expo, RevenueCat, biometric auth)
- **Capco Consulting** — new dedicated project entry summarizing impact across all 6 engagements (30+ workshops, 5,000+ hrs saved, 13 cutover workstreams, 3,000+ defects reviewed)

## Next Actions
- [ ] More data sources (blog posts, LinkedIn activity)
- [ ] Streaming responses
- [ ] Improve prompt / response quality
- [ ] 🚫 Color palette update — ON HOLD (root gary-yong.com must receive color update first)

## Scope Decision (2026-03-13)
- **YongAI Consulting** will NOT be mentioned in the portfolio page or Ask Gary chatbot — keep it separate

## Decisions
- 2026-02-09: Demoed to Deloitte — positive reception
- 2026-03-11: Re-indexed knowledge base with all 2025–2026 projects (D-009 resolved)
- 2026-03-13: YongAI Consulting excluded from portfolio page and Ask Gary scope (Gary's decision)
- 2026-03-14: YongAI data removed from KB (Projects.txt + Skills.txt), re-indexed (111 chunks), service restarted
- 2026-03-15: KB expanded — Trading/Flowt/Capco enriched; re-indexed to 115 chunks; service restarted
- 2026-03-16: Color palette update put on hold — root gary-yong.com must ship color update first (Gary's decision)
- RAG over Gary's resume + experience data

## Deploy / Update
```bash
# Frontend (S3)
aws s3 cp PersonalWebsite/ask-gary.html s3://gary-yong.com/ask-gary.html --profile clawdbot-deploy
aws cloudfront create-invalidation --distribution-id EUVZ94LCG1QV2 --paths "/ask-gary*" --profile clawdbot-deploy

# Backend restart (EC2) — NOT in PM2, use direct command
ssh ubuntu@52.86.178.139 -i ~/.ssh/id_ed25519
cd /home/ubuntu/PersonalWebsite/ask-gary-backend
pkill -f uvicorn && nohup venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 &

# Re-index knowledge base
cd /home/ubuntu/PersonalWebsite/ask-gary-backend
venv/bin/python3 index_data.py
```
