# Fix Systemd Service Path Issue

## The Problem

Your service file has a **double directory path**:
- ❌ Current (WRONG): `/home/ubuntu/PersonalWebsite/PersonalWebsite/ask-gary-backend`
- ✅ Should be: `/home/ubuntu/PersonalWebsite/ask-gary-backend`

This means the service is running code from a different location than where you're updating files.

## Step-by-Step Fix

### Step 1: Verify Where Your Updated Code Actually Is

```bash
# Check where you are
pwd
# Should show: /home/ubuntu/PersonalWebsite/ask-gary-backend

# Verify this directory has the updated code
grep -A 2 "narrative style" config.py
grep -A 2 "flowing narrative" main.py

# Check git status here
git log --oneline -1
```

### Step 2: Check If the Wrong Directory Exists

```bash
# Check if the double-path directory exists
ls -la /home/ubuntu/PersonalWebsite/PersonalWebsite/ask-gary-backend 2>&1

# If it exists, check what's in it
if [ -d "/home/ubuntu/PersonalWebsite/PersonalWebsite/ask-gary-backend" ]; then
    echo "⚠️  Wrong directory exists!"
    ls -la /home/ubuntu/PersonalWebsite/PersonalWebsite/ask-gary-backend/config.py
    cat /home/ubuntu/PersonalWebsite/PersonalWebsite/ask-gary-backend/config.py | grep "narrative style" || echo "❌ OLD CODE!"
fi
```

### Step 3: Fix the Service File

```bash
# Edit the service file
sudo nano /etc/systemd/system/ask-gary.service
```

Change these lines:
```ini
# FROM (WRONG):
ExecStart=/home/ubuntu/PersonalWebsite/PersonalWebsite/ask-gary-backend/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
WorkingDirectory=/home/ubuntu/PersonalWebsite/PersonalWebsite/ask-gary-backend

# TO (CORRECT):
ExecStart=/home/ubuntu/PersonalWebsite/ask-gary-backend/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
WorkingDirectory=/home/ubuntu/PersonalWebsite/ask-gary-backend
```

Also update the PATH environment variable if it has the double path:
```ini
# FROM (WRONG):
Environment="PATH=/home/ubuntu/PersonalWebsite/PersonalWebsite/ask-gary-backend/venv/bin"

# TO (CORRECT):
Environment="PATH=/home/ubuntu/PersonalWebsite/ask-gary-backend/venv/bin"
```

### Step 4: Reload Systemd and Restart Service

```bash
# Reload systemd configuration
sudo systemctl daemon-reload

# Stop the service
sudo systemctl stop ask-gary

# Clear Python cache in the CORRECT directory
cd /home/ubuntu/PersonalWebsite/ask-gary-backend
find . -name "*.pyc" -delete
find . -name "__pycache__" -type d -exec rm -r {} + 2>/dev/null

# Start the service
sudo systemctl start ask-gary

# Check status
sudo systemctl status ask-gary
```

### Step 5: Verify It's Using the Correct Directory

```bash
# Check the service is using correct path now
sudo systemctl show ask-gary | grep -E "WorkingDirectory|ExecStart"

# Should show:
# WorkingDirectory=/home/ubuntu/PersonalWebsite/ask-gary-backend
# (NO double PersonalWebsite!)
```

### Step 6: Test the Response Format

```bash
# Test the API
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"session_id": "test", "message": "What did Gary do at Capco?"}' | python3 -m json.tool

# Look for: Should have paragraphs, NOT bullet points with "- **"
```

## Quick One-Liner Fix (If You're Confident)

```bash
# Stop service
sudo systemctl stop ask-gary

# Fix the service file with sed
sudo sed -i 's|/PersonalWebsite/PersonalWebsite/ask-gary-backend|/PersonalWebsite/ask-gary-backend|g' /etc/systemd/system/ask-gary.service

# Reload and restart
sudo systemctl daemon-reload
cd /home/ubuntu/PersonalWebsite/ask-gary-backend
find . -name "*.pyc" -delete
find . -name "__pycache__" -type d -exec rm -r {} + 2>/dev/null
sudo systemctl start ask-gary

# Verify
sudo systemctl status ask-gary
```

## Alternative: Copy Code to Where Service Expects It

If for some reason you need to keep the double-path structure:

```bash
# Copy updated code to where service is looking
sudo cp -r /home/ubuntu/PersonalWebsite/ask-gary-backend/* \
    /home/ubuntu/PersonalWebsite/PersonalWebsite/ask-gary-backend/

# Clear cache there
cd /home/ubuntu/PersonalWebsite/PersonalWebsite/ask-gary-backend
find . -name "*.pyc" -delete
find . -name "__pycache__" -type d -exec rm -r {} + 2>/dev/null

# Restart service
sudo systemctl restart ask-gary
```

**But I recommend fixing the service file path instead** - it's cleaner and avoids confusion.

