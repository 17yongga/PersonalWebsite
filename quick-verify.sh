#!/bin/bash
# Quick verification script for Ask Gary deployment
# Run this on your EC2 instance: bash quick-verify.sh

echo "=== Checking if code was updated ==="
cd ~/PersonalWebsite/ask-gary-backend
echo "Current directory: $(pwd)"
echo ""
echo "Latest commit:"
git log --oneline -1
echo ""
echo "Checking config.py for narrative prompt:"
grep -A 2 "narrative style" config.py || echo "❌ Narrative prompt NOT found!"
echo ""
echo "Checking main.py for narrative prompt:"
grep -A 2 "flowing narrative" main.py || echo "❌ Narrative prompt NOT found!"
echo ""
echo "Checking temperature setting:"
grep "temperature" main.py
echo ""

echo "=== Checking backend process ==="
if command -v pm2 &> /dev/null; then
    echo "PM2 processes:"
    pm2 list
    echo ""
    echo "PM2 logs (last 10 lines):"
    pm2 logs ask-gary --lines 10 --nostream 2>/dev/null || echo "⚠️  Could not get PM2 logs"
elif systemctl is-active --quiet ask-gary; then
    echo "systemd service status:"
    sudo systemctl status ask-gary --no-pager | head -20
else
    echo "Checking for uvicorn processes:"
    ps aux | grep uvicorn | grep -v grep
fi
echo ""

echo "=== Testing backend directly ==="
echo "Testing health endpoint:"
curl -s http://localhost:8000/health || echo "❌ Backend not responding!"
echo ""
echo "Testing chat endpoint (sample):"
curl -s -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"session_id": "verify123", "message": "What did Gary do at Capco?"}' \
  | python3 -m json.tool 2>/dev/null | head -30 || echo "❌ Chat endpoint not working!"

