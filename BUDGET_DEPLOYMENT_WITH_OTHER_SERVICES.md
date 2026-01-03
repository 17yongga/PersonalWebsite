# Budget App Deployment - Coexisting with Ask-Gary and Casino Games

## ✅ No Conflicts - Port Allocation

The Budget App is designed to coexist peacefully with your existing services:

| Service | Port | Status |
|---------|------|--------|
| **Ask-Gary Backend** | `8000` | Existing - No change needed |
| **Casino Games Backend** | `3001` | Existing - No change needed |
| **Budget App Backend** | `8002` | New - No conflicts! |

## Quick Compatibility Check

✅ **No Port Conflicts**: Budget app uses port 8002 (different from Ask-Gary's 8000 and Casino's 3001)  
✅ **No Route Conflicts**: Budget app uses `/api/budget/` (different from Ask-Gary's `/chat` and Casino's `/api/*`)  
✅ **No File Conflicts**: Budget app is in separate `budget-backend/` directory  
✅ **Process Management**: Can use PM2/systemd independently  
✅ **Database**: Uses separate SQLite database (`budget.db`)

## Deployment Steps

### Step 1: Deploy Budget Backend (EC2)

```bash
ssh ubuntu@gary-yong.com
cd ~/PersonalWebsite

# Pull latest code
git pull origin master

# Navigate to budget backend
cd budget-backend

# Create virtual environment (if not exists)
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Set up environment variables
cp env-template.txt .env
nano .env  # Add your OPENAI_API_KEY

# Create uploads directory
mkdir -p uploads

# Test the server
uvicorn main:app --host 0.0.0.0 --port 8002
```

### Step 2: Set Up Process Management

Choose one:

**Option A: Systemd (Recommended for Python services)**

```bash
sudo nano /etc/systemd/system/budget-app.service
```

Add:
```ini
[Unit]
Description=Budget App API
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/PersonalWebsite/budget-backend
Environment="PATH=/home/ubuntu/PersonalWebsite/budget-backend/venv/bin"
ExecStart=/home/ubuntu/PersonalWebsite/budget-backend/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8002
Restart=always

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable budget-app
sudo systemctl start budget-app
sudo systemctl status budget-app
```

**Option B: PM2**

```bash
cd ~/PersonalWebsite/budget-backend
source venv/bin/activate
pm2 start "uvicorn main:app --host 0.0.0.0 --port 8002" --name budget-app --interpreter python
pm2 save
```

### Step 3: Update Nginx Configuration

**IMPORTANT**: Add to your existing Nginx config, don't replace!

```bash
# Backup first!
sudo cp /etc/nginx/sites-available/gary-yong.com /etc/nginx/sites-available/gary-yong.com.backup

# Edit config
sudo nano /etc/nginx/sites-available/gary-yong.com
```

Add this location block (keep all existing blocks):

```nginx
server {
    # ... your existing configuration ...
    
    # Keep all existing Ask-Gary and Casino routes intact!
    
    # ADD Budget App backend proxy
    location /api/budget/ {
        proxy_pass http://localhost:8002/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # CORS headers (if needed)
        add_header Access-Control-Allow-Origin *;
        add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS";
        add_header Access-Control-Allow-Headers "Content-Type, Authorization";
        
        # Handle preflight
        if ($request_method = OPTIONS) {
            return 204;
        }
    }
    
    # Budget app frontend (served as static file)
    location /budget.html {
        # Static file serving (already handled by your existing config)
        # Or if using S3, this is handled separately
    }
}
```

Test and reload:
```bash
sudo nginx -t
sudo systemctl reload nginx
```

### Step 4: Deploy Frontend

**Option A: S3 (Recommended)**

1. Upload `budget.html`, `budget.css`, `budget.js` to your S3 bucket
2. The frontend automatically detects production and uses the correct API URL

**Option B: EC2 Static Files**

The files are already in your repository, just ensure they're accessible via Nginx.

### Step 5: Verify Deployment

```bash
# Check all services are running
sudo systemctl status ask-gary      # Ask-Gary (if using systemd)
sudo systemctl status budget-app    # Budget App
pm2 status                          # Casino Games (if using PM2)

# Test Budget App backend
curl http://localhost:8002/health

# Test through Nginx
curl https://gary-yong.com/api/budget/health

# Check ports
sudo netstat -tlnp | grep -E "(8000|3001|8002)"
```

Expected output:
```
tcp  0  0  0.0.0.0:8000  ...  # Ask-Gary
tcp  0  0  0.0.0.0:3001  ...  # Casino
tcp  0  0  0.0.0.0:8002  ...  # Budget App
```

## Architecture Overview

```
Internet
    │
    ├─> Nginx (Port 80/443)
    │   │
    │   ├─> /ask-gary.html ────────> Static files
    │   ├─> api.gary-yong.com ──────> Ask-Gary Backend (Port 8000)
    │   ├─> /socket.io/* ───────────> Casino Backend (Port 3001)
    │   ├─> /api/* ─────────────────> Casino Backend (Port 3001)
    │   ├─> /api/budget/* ──────────> Budget Backend (Port 8002) ← NEW
    │   └─> /budget.html ───────────> Static files
    │
    ├─> Ask-Gary Process (Port 8000)
    ├─> Casino Process (Port 3001)
    └─> Budget Process (Port 8002) ← NEW
```

## Maintenance

### View All Services

```bash
# Systemd services
sudo systemctl list-units --type=service | grep -E "(ask-gary|budget)"

# PM2 processes
pm2 list

# Check all ports
sudo lsof -i :8000  # Ask-Gary
sudo lsof -i :3001  # Casino
sudo lsof -i :8002  # Budget App
```

### Restart Services Individually

```bash
# Budget App only
sudo systemctl restart budget-app

# Or with PM2
pm2 restart budget-app

# Ask-Gary (unchanged)
sudo systemctl restart ask-gary

# Casino (unchanged)
pm2 restart casino-server
```

### View Logs

```bash
# Budget App
sudo journalctl -u budget-app -f

# Or PM2
pm2 logs budget-app

# Ask-Gary (unchanged)
sudo journalctl -u ask-gary -f

# Casino (unchanged)
pm2 logs casino-server
```

## Troubleshooting

### Issue: Port 8002 already in use

```bash
# Check what's using it
sudo lsof -i :8002

# Kill if needed (be careful!)
sudo kill -9 <PID>
```

### Issue: Budget app conflicts with Ask-Gary

**This shouldn't happen** - they use different ports (8002 vs 8000). If you see conflicts:
- Check you're using the correct port
- Verify no port forwarding/routing issues
- Check Nginx configuration doesn't have conflicting routes

### Issue: Services interfere with each other

All services are independent:
- Different ports
- Different processes
- Different databases/files
- Can restart individually

## Summary

✅ **Safe to deploy**: No conflicts with existing services  
✅ **Additive**: Only adds new routes, doesn't modify existing ones  
✅ **Independent**: Can start/stop/restart independently  
✅ **No data loss**: Existing services untouched  

## Port Reference

See `PORT_ASSIGNMENTS.md` for complete port allocation documentation.

