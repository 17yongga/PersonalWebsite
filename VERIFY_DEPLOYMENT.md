# How to Verify Ask Gary Deployment

## Quick Verification Steps

### Step 1: Verify Backend Code Was Updated

SSH into your EC2 instance and check if the files contain the narrative prompt:

```bash
ssh ubuntu@gary-yong.com
cd ~/PersonalWebsite/ask-gary-backend

# Check config.py - should have "narrative style" text
grep -A 5 "narrative style" config.py

# Check main.py - should have "flowing narrative" text
grep -A 3 "flowing narrative" main.py
```

**Expected output in config.py:**
```
- Answer in a natural, narrative style that tells a story:
  - Write in flowing paragraphs, not bullet points or lists.
```

**Expected output in main.py:**
```
Write your response as a natural, flowing narrative that tells a story.
```

### Step 2: Verify Backend Process Was Restarted

Check if the backend is running and when it was last started:

```bash
# If using PM2
pm2 list
pm2 logs ask-gary --lines 10

# If using systemd
sudo systemctl status ask-gary
sudo journalctl -u ask-gary --since "10 minutes ago"

# If running manually
ps aux | grep uvicorn
```

**Important**: The process start time should be AFTER you pulled the latest code.

### Step 3: Check Which Python/Code is Being Used

Verify the virtual environment is active and using the right code:

```bash
cd ~/PersonalWebsite/ask-gary-backend
source venv/bin/activate

# Check Python version and path
which python
python --version

# Verify you're in the right directory
pwd
# Should output: /home/ubuntu/PersonalWebsite/ask-gary-backend

# Check if files were actually updated
git log --oneline -1
# Should show the latest commit with "narrative" changes
```

### Step 4: Force Restart Backend

Sometimes a simple restart isn't enough. Force a complete restart:

```bash
cd ~/PersonalWebsite/ask-gary-backend

# If using PM2
pm2 stop ask-gary
pm2 delete ask-gary
pm2 start main.py --name ask-gary --interpreter venv/bin/python -- uvicorn main:app --host 0.0.0.0 --port 8000
# OR if you have a different startup command:
pm2 restart ask-gary --update-env

# If using systemd
sudo systemctl stop ask-gary
sudo systemctl start ask-gary
sudo systemctl status ask-gary

# If running manually
pkill -f uvicorn
source venv/bin/activate
nohup uvicorn main:app --host 0.0.0.0 --port 8000 > logs/ask-gary.log 2>&1 &
```

### Step 5: Test Backend Directly

Test the backend API directly to see the response format:

```bash
# Test locally on EC2
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"session_id": "test123", "message": "What did Gary do at Capco?"}'

# Test from outside (should work if backend is running)
curl -X POST https://api.gary-yong.com/chat \
  -H "Content-Type: application/json" \
  -d '{"session_id": "test123", "message": "What did Gary do at Capco?"}'
```

**Look for**: The response should be in paragraph format, NOT bullet points.

### Step 6: Check Frontend API URL

Verify the frontend is pointing to the right backend:

```bash
cd ~/PersonalWebsite
grep "API_BASE_URL" ask-gary.js
```

Should show: `const API_BASE_URL = "https://api.gary-yong.com";`

### Step 7: Clear Browser Cache

Sometimes browsers cache responses. Try:

1. Hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
2. Clear browser cache
3. Try incognito/private mode
4. Check browser console (F12) for any errors

## Common Issues and Solutions

### Issue: Code updated but still showing lists

**Solution 1**: Backend wasn't restarted properly
```bash
# Kill all uvicorn processes
pkill -9 uvicorn

# Restart fresh
cd ~/PersonalWebsite/ask-gary-backend
source venv/bin/activate
pm2 restart ask-gary
# OR your preferred method
```

**Solution 2**: Wrong virtual environment or Python path
```bash
# Check which Python PM2/systemd is using
pm2 describe ask-gary | grep interpreter
# Should show: /home/ubuntu/PersonalWebsite/ask-gary-backend/venv/bin/python

# If wrong, update PM2 config or systemd service file
```

**Solution 3**: Cached Python bytecode
```bash
cd ~/PersonalWebsite/ask-gary-backend
find . -name "*.pyc" -delete
find . -name "__pycache__" -type d -exec rm -r {} +
# Then restart backend
```

### Issue: Response format is mixed (some paragraphs, some lists)

This might be because:
- Temperature is too low (should be 0.7)
- The model is still following old patterns
- Need to regenerate indexed_data.json

**Solution**: 
```bash
# Verify temperature in main.py
grep "temperature" main.py
# Should show: temperature=0.7

# If not, update and restart
```

### Issue: Backend returning old responses

**Solution**: Clear any response cache, restart backend, test with a fresh session

## Verification Checklist

- [ ] Code files updated (config.py and main.py have narrative prompts)
- [ ] Git shows latest commit
- [ ] Backend process restarted after code update
- [ ] Backend health endpoint responds
- [ ] Direct API test shows narrative format (not lists)
- [ ] Frontend points to correct API URL
- [ ] Browser cache cleared
- [ ] Tested with fresh browser session

## If Still Not Working

1. **Check backend logs** for errors:
   ```bash
   pm2 logs ask-gary --lines 50
   # OR
   sudo journalctl -u ask-gary -n 50
   ```

2. **Verify the exact code running**:
   ```bash
   cd ~/PersonalWebsite/ask-gary-backend
   cat config.py | grep -A 10 "narrative"
   cat main.py | grep -A 5 "flowing narrative"
   ```

3. **Restart from scratch**:
   ```bash
   # Stop everything
   pm2 stop all  # or systemctl stop ask-gary
   
   # Verify code
   git log --oneline -5
   git diff HEAD~1 ask-gary-backend/config.py
   
   # Start fresh
   cd ~/PersonalWebsite/ask-gary-backend
   source venv/bin/activate
   pm2 start [your-command]
   ```

4. **Contact**: If none of this works, there might be an issue with how the backend is being started or which code it's actually executing.

