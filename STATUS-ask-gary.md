# Ask Gary (RAG Chatbot) — STATUS.md
> Updated: 2026-03-09

## What's Live
- **Frontend:** https://gary-yong.com/ask-gary.html (S3/CloudFront)
- **Backend:** https://api.gary-yong.com → port 8000 (nginx proxied)
- **Stack:** Python FastAPI + RAG (indexed knowledge base) + static HTML/JS frontend
- **Status:** ✅ Confirmed live (verified 2026-03-09)

## Architecture
- Frontend: `ask-gary.html` + `ask-gary.js` on S3
- Backend: `/home/ubuntu/PersonalWebsite/ask-gary-backend/` on EC2
  - `main.py` — FastAPI server (uvicorn, port 8000)
  - `index_data.py` — indexing script
  - `indexed_data.json` — indexed knowledge base
  - `config.py` — configuration
- **⚠️ NOT managed by PM2** — runs as standalone uvicorn process (PID ~61973)
  - Will not auto-restart on crash or EC2 reboot
  - Consider adding to PM2 ecosystem

## Current State (2026-03-09)
- Live and responding (HTTP 200 on /health)
- Last major work: ~2026-02-15
- Knowledge base last indexed: ~2026-02-15 (may be stale)
- Successfully demoed to Deloitte R1 interviewers (Feb 9) — positive reception

## Next Actions
- [ ] Add ask-gary-backend to PM2 for auto-restart
- [ ] Re-index knowledge base if Gary's resume/experience updated since Feb 15
- [ ] Gary: confirm re-index decision (D-009)

## Decisions
- 2026-02-09: Demoed to Deloitte — positive reception
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
