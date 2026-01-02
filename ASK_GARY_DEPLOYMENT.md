# Ask Gary Deployment Guide for EC2

This guide covers deploying Ask Gary updates to your EC2 production instance.

## Architecture Overview

- **Frontend**: `ask-gary.html`, `ask-gary.js` - Static files served by Nginx
- **Backend**: `ask-gary-backend/` - Python FastAPI service on port 8000
- **Domain**: `api.gary-yong.com` (backend), `gary-yong.com/ask-gary.html` (frontend)

## Quick Deployment Steps

### Step 1: Connect to EC2 Instance

```bash
ssh ubuntu@gary-yong.com
# or
ssh -i your-key.pem ubuntu@your-ec2-ip
```

### Step 2: Navigate to Project Directory and Pull Latest Changes

```bash
cd ~/PersonalWebsite
git pull origin master
```

### Step 3: Update Frontend Files (No Build Required)

The frontend files (`ask-gary.html`, `ask-gary.js`) are static and served directly by Nginx. Once you've pulled the changes, they're ready to serve.

**Note**: If Nginx is serving files from a different location (e.g., `/var/www/html`), you may need to copy the files:
```bash
sudo cp ask-gary.html /var/www/html/
sudo cp ask-gary.js /var/www/html/
```

### Step 4: Update Backend

Navigate to the backend directory and activate the virtual environment:

```bash
cd ~/PersonalWebsite/ask-gary-backend
source venv/bin/activate  # or: . venv/bin/activate
```

#### Option A: If Backend is Running with PM2

```bash
# Restart the PM2 process
pm2 restart ask-gary  # or whatever your process name is

# Check status
pm2 status
pm2 logs ask-gary
```

#### Option B: If Backend is Running with systemd

```bash
# Restart the service
sudo systemctl restart ask-gary  # or whatever your service name is

# Check status
sudo systemctl status ask-gary
sudo journalctl -u ask-gary -f  # View logs
```

#### Option C: If Backend is Running with uvicorn directly

```bash
# Find the process
ps aux | grep uvicorn

# Kill the old process (replace PID with actual process ID)
kill <PID>

# Restart (adjust command based on your setup)
uvicorn main:app --host 0.0.0.0 --port 8000
# OR use nohup for background:
nohup uvicorn main:app --host 0.0.0.0 --port 8000 > logs/ask-gary.log 2>&1 &
```

### Step 5: Verify Deployment

#### Test Backend Health Endpoint

```bash
curl http://localhost:8000/health
# Should return: {"status":"ok"}

# Test from outside (if firewall allows):
curl https://api.gary-yong.com/health
```

#### Test Frontend

1. Open browser and visit: `https://gary-yong.com/ask-gary.html`
2. Check browser console (F12) for any errors
3. Try sending a test message to verify the backend connection

#### Check Logs for Errors

```bash
# If using PM2:
pm2 logs ask-gary --lines 50

# If using systemd:
sudo journalctl -u ask-gary -n 50

# If running manually, check your log file
tail -f logs/ask-gary.log
```

## Important Notes

### Backend Dependencies

If you've added new Python dependencies in `requirements.txt`, install them:

```bash
cd ~/PersonalWebsite/ask-gary-backend
source venv/bin/activate
pip install -r requirements.txt
```

### Environment Variables

Ensure your `.env` file exists in `ask-gary-backend/` with your OpenAI API key:

```bash
cd ~/PersonalWebsite/ask-gary-backend
# Check if .env exists
ls -la .env

# If missing, create it:
nano .env
# Add: OPENAI_API_KEY=your-api-key-here
```

### Indexed Data

If `indexed_data.json` is missing or outdated, regenerate it:

```bash
cd ~/PersonalWebsite/ask-gary-backend
source venv/bin/activate
python index_data.py
```

### Nginx Configuration

The Nginx configuration should already be set up. If you need to verify:

```bash
# Check Nginx config
sudo nginx -t

# View relevant config
sudo cat /etc/nginx/sites-available/gary-yong.com | grep -A 10 "ask-gary\|api.gary-yong.com"

# Reload Nginx (if you made changes)
sudo systemctl reload nginx
```

## Rollback (If Needed)

If something goes wrong, you can rollback to the previous commit:

```bash
cd ~/PersonalWebsite
git log --oneline -5  # View recent commits
git checkout <previous-commit-hash>  # Replace with actual commit hash
# Then restart your backend service
```

Or restore from backup:

```bash
cd ~/PersonalWebsite
git reset --hard origin/master  # Reset to remote state
```

## Common Issues

### Issue: Backend not responding

**Solutions:**
1. Check if process is running: `ps aux | grep uvicorn`
2. Check logs for errors
3. Verify port 8000 is not blocked: `sudo netstat -tlnp | grep 8000`
4. Check firewall/security group allows port 8000

### Issue: Frontend shows connection errors

**Solutions:**
1. Verify backend is running (Step 5)
2. Check browser console for CORS errors
3. Verify API_BASE_URL in `ask-gary.js` points to `https://api.gary-yong.com`
4. Check Nginx proxy configuration

### Issue: Responses not in narrative format

**Solutions:**
1. Verify `config.py` and `main.py` were updated (check file contents)
2. Restart backend service
3. Check backend logs for any errors

## Summary Checklist

- [ ] Connected to EC2 instance
- [ ] Pulled latest changes: `git pull origin master`
- [ ] Activated Python virtual environment (for backend)
- [ ] Restarted backend service (PM2/systemd/manual)
- [ ] Verified backend health endpoint responds
- [ ] Tested frontend in browser
- [ ] Checked logs for errors
- [ ] Verified narrative responses are working

---

**Estimated Deployment Time**: 5-10 minutes

**Downtime**: Minimal (only during backend restart, typically < 5 seconds)

