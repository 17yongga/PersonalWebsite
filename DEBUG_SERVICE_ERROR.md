# Debug Service Start Error

The service failed to start. Let's diagnose the issue.

## Step 1: Check the Error Details

```bash
# Check service status for error message
sudo systemctl status ask-gary.service

# Check detailed logs
sudo journalctl -xeu ask-gary.service -n 50 --no-pager
```

## Common Issues and Fixes

### Issue 1: Path Still Has Double PersonalWebsite

If you edited the file but it didn't save correctly:

```bash
# Check current service file
sudo cat /etc/systemd/system/ask-gary.service | grep -E "ExecStart|WorkingDirectory"

# Should show:
# ExecStart=/home/ubuntu/PersonalWebsite/ask-gary-backend/venv/bin/uvicorn ...
# WorkingDirectory=/home/ubuntu/PersonalWebsite/ask-gary-backend
```

### Issue 2: Virtual Environment Path is Wrong

The venv might be in a different location:

```bash
# Check if venv exists in the correct location
ls -la /home/ubuntu/PersonalWebsite/ask-gary-backend/venv/bin/uvicorn

# If not, check where it actually is
find /home/ubuntu -name "uvicorn" -type f 2>/dev/null | grep ask-gary
```

### Issue 3: Working Directory Doesn't Exist

```bash
# Verify the directory exists
ls -la /home/ubuntu/PersonalWebsite/ask-gary-backend/

# Should show your files (config.py, main.py, etc.)
```

### Issue 4: Missing Dependencies

```bash
# Activate venv and check
cd /home/ubuntu/PersonalWebsite/ask-gary-backend
source venv/bin/activate
python -m uvicorn main:app --host 0.0.0.0 --port 8000

# If this works, the issue is with the service file
# If this fails, you'll see the actual error
```

## Quick Diagnostic Commands

Run these to gather info:

```bash
echo "=== Service File ==="
sudo cat /etc/systemd/system/ask-gary.service

echo ""
echo "=== Directory Check ==="
ls -la /home/ubuntu/PersonalWebsite/ask-gary-backend/ | head -10

echo ""
echo "=== Venv Check ==="
ls -la /home/ubuntu/PersonalWebsite/ask-gary-backend/venv/bin/uvicorn

echo ""
echo "=== Recent Logs ==="
sudo journalctl -u ask-gary -n 30 --no-pager
```

