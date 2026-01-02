# Ask Gary Deployment Guide - Systemd Version

This guide is specifically for deployments where Ask Gary backend runs as a systemd service.

## Quick Deployment Steps for Systemd

### Step 1: Connect to EC2 and Pull Latest Code

```bash
ssh ubuntu@gary-yong.com
cd ~/PersonalWebsite
git pull origin master
```

### Step 2: Verify Code Was Updated

```bash
cd ~/PersonalWebsite/ask-gary-backend

# Check latest commit
git log --oneline -1

# Verify narrative prompts are in the code
grep -A 2 "narrative style" config.py
grep -A 2 "flowing narrative" main.py
```

### Step 3: Restart the Systemd Service

```bash
# Restart the service
sudo systemctl restart ask-gary

# Check status
sudo systemctl status ask-gary

# View recent logs
sudo journalctl -u ask-gary -n 50 --no-pager
```

### Step 4: Force Complete Restart (If Simple Restart Doesn't Work)

```bash
cd ~/PersonalWebsite/ask-gary-backend

# Stop the service
sudo systemctl stop ask-gary

# Clear Python cache (important!)
find . -name "*.pyc" -delete
find . -name "__pycache__" -type d -exec rm -r {} + 2>/dev/null

# Verify code
cat config.py | grep "narrative style"
cat main.py | grep "flowing narrative"

# Start the service
sudo systemctl start ask-gary

# Check status
sudo systemctl status ask-gary
```

### Step 5: Verify Deployment

```bash
# Test backend health
curl http://localhost:8000/health

# Test chat endpoint (should return narrative format, not lists)
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"session_id": "test123", "message": "What did Gary do at Capco?"}'

# Test from outside
curl https://api.gary-yong.com/health
```

## Troubleshooting Systemd Service

### Check Service Configuration

```bash
# View service file
sudo systemctl cat ask-gary

# Check which Python/working directory it's using
sudo systemctl show ask-gary | grep -E "WorkingDirectory|ExecStart"
```

### Common Issues

#### Issue 1: Service not using updated code

**Solution**: Verify the service is pointing to the right directory:

```bash
# Check service file location
sudo systemctl cat ask-gary

# It should point to: /home/ubuntu/PersonalWebsite/ask-gary-backend
# If not, you may need to update the service file
```

#### Issue 2: Service using wrong virtual environment

**Solution**: Ensure the service file uses the correct Python interpreter:

```bash
# Check what Python the service is using
sudo systemctl cat ask-gary | grep ExecStart

# Should be something like:
# ExecStart=/home/ubuntu/PersonalWebsite/ask-gary-backend/venv/bin/python -m uvicorn main:app
# OR
# ExecStart=/home/ubuntu/PersonalWebsite/ask-gary-backend/venv/bin/uvicorn main:app

# If wrong, edit the service file:
sudo systemctl edit --full ask-gary
# Then restart
sudo systemctl daemon-reload
sudo systemctl restart ask-gary
```

#### Issue 3: Python cache not cleared

**Solution**: Manually clear cache before restart:

```bash
cd ~/PersonalWebsite/ask-gary-backend
sudo systemctl stop ask-gary
find . -name "*.pyc" -delete
find . -name "__pycache__" -type d -exec rm -r {} + 2>/dev/null
sudo systemctl start ask-gary
```

#### Issue 4: Service not starting

**Solution**: Check logs for errors:

```bash
# Check service status
sudo systemctl status ask-gary

# View detailed logs
sudo journalctl -u ask-gary -n 100 --no-pager

# Common issues:
# - Missing dependencies: pip install -r requirements.txt
# - Wrong Python path: Update ExecStart in service file
# - Port already in use: Check if another process is using port 8000
```

### View Real-time Logs

```bash
# Follow logs in real-time
sudo journalctl -u ask-gary -f

# View logs since last boot
sudo journalctl -u ask-gary -b

# View logs from last 10 minutes
sudo journalctl -u ask-gary --since "10 minutes ago"
```

### Reload Service Configuration

If you modified the service file:

```bash
# Reload systemd configuration
sudo systemctl daemon-reload

# Restart service
sudo systemctl restart ask-gary
```

## Complete Restart Procedure

If you're still seeing old responses after a restart, try this complete procedure:

```bash
# 1. Stop service
sudo systemctl stop ask-gary

# 2. Navigate to backend directory
cd ~/PersonalWebsite/ask-gary-backend

# 3. Pull latest code (if not done)
git pull origin master

# 4. Clear Python cache
find . -name "*.pyc" -delete
find . -name "__pycache__" -type d -exec rm -r {} + 2>/dev/null

# 5. Verify code changes
echo "Checking config.py:"
grep -A 3 "narrative style" config.py
echo ""
echo "Checking main.py:"
grep -A 3 "flowing narrative" main.py
echo ""

# 6. Activate virtual environment and verify
source venv/bin/activate
which python
python --version

# 7. Check if dependencies are up to date (optional)
pip list | grep -E "fastapi|uvicorn|openai"

# 8. Start service
sudo systemctl start ask-gary

# 9. Check status
sudo systemctl status ask-gary

# 10. Wait a few seconds, then test
sleep 3
curl http://localhost:8000/health
```

## Verify Deployment Checklist

- [ ] Code pulled from git: `git pull origin master`
- [ ] Code verified: `grep "narrative style" config.py` shows the prompt
- [ ] Python cache cleared: No `.pyc` files or `__pycache__` directories
- [ ] Service stopped: `sudo systemctl stop ask-gary`
- [ ] Service restarted: `sudo systemctl start ask-gary`
- [ ] Service running: `sudo systemctl status ask-gary` shows "active (running)"
- [ ] Health check passes: `curl http://localhost:8000/health` returns `{"status":"ok"}`
- [ ] Chat test shows narrative: Response has paragraphs, not bullet points

## Quick Test Command

After deployment, test immediately:

```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"session_id": "verify", "message": "What did Gary do at Capco?"}' \
  | python3 -m json.tool | grep -E "•|- " && echo "❌ Still using lists!" || echo "✅ Narrative format!"
```

If you see "Still using lists!", the backend is not using the updated code.

## Service File Location

Your systemd service file is likely located at:
- `/etc/systemd/system/ask-gary.service`

To view or edit it:
```bash
sudo cat /etc/systemd/system/ask-gary.service
sudo nano /etc/systemd/system/ask-gary.service  # Edit if needed
sudo systemctl daemon-reload  # After editing
```

