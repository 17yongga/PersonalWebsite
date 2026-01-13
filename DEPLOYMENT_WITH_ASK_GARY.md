# Deployment Guide: Casino Games (Coexisting with Ask-Gary)

## Important: This deployment will NOT affect your Ask-Gary agent

The casino games and Ask-Gary are completely separate services that can run simultaneously:

- **Ask-Gary**: Python FastAPI backend on `api.gary-yong.com` (likely port 8000)
- **Casino Games**: Node.js Express backend on `gary-yong.com` (port 3001)
- **No conflicts**: Different ports, different routes, different technologies

## Quick Compatibility Check

✅ **No Port Conflicts**: Ask-Gary uses port 8000, Casino uses port 3001  
✅ **No Route Conflicts**: Ask-Gary uses `/chat`, Casino uses `/api/*` and `/socket.io/*`  
✅ **No File Conflicts**: They're in separate directories  
✅ **Process Management**: Both can use PM2 with different names  

## Step-by-Step Deployment (Non-Destructive)

### Step 1: Connect to EC2 and Update Repository

```bash
ssh ubuntu@gary-yong.com
cd ~/PersonalWebsite
git pull origin master
```

### Step 2: Install Node.js Dependencies (If Not Already Installed)

```bash
npm install --production
```

**Note**: This won't affect your Python environment or Ask-Gary dependencies.

### Step 3: Update Nginx Configuration (ADD, Don't Replace)

**IMPORTANT**: Do NOT overwrite your existing Nginx configuration. Instead, ADD the casino routes to your existing config.

```bash
# Backup your current Nginx config first!
sudo cp /etc/nginx/sites-available/gary-yong.com /etc/nginx/sites-available/gary-yong.com.backup

# Edit your existing Nginx config
sudo nano /etc/nginx/sites-available/gary-yong.com
```

Add these location blocks to your EXISTING server block (don't remove Ask-Gary routes):

```nginx
server {
    # ... your existing configuration ...
    
    # Keep all existing Ask-Gary routes intact
    # (e.g., location /ask-gary/ or api.gary-yong.com configuration)
    
    # ADD these new locations for casino games:
    
    # Proxy WebSocket connections to casino server
    location /socket.io/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket timeouts
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;
    }

    # Proxy API requests to casino server
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    # ... rest of your existing configuration ...
}
```

**Alternative**: If you have separate server blocks for different subdomains, you can add a new server block specifically for casino routes on the main domain.

### Step 4: Test Nginx Configuration

```bash
sudo nginx -t
```

If there are errors, restore your backup:
```bash
sudo cp /etc/nginx/sites-available/gary-yong.com.backup /etc/nginx/sites-available/gary-yong.com
```

### Step 5: Reload Nginx (Non-Destructive)

```bash
sudo systemctl reload nginx
```

This reloads the configuration without stopping the server, so Ask-Gary continues running.

### Step 6: Install PM2 (If Not Already Installed)

```bash
sudo npm install -g pm2
```

**Note**: If Ask-Gary is already using PM2, that's fine. You'll just have two processes managed by PM2.

### Step 7: Initialize Casino Data Files

```bash
cd ~/PersonalWebsite
mkdir -p logs
if [ ! -f casino-users.json ]; then
  echo '{}' > casino-users.json
  chmod 600 casino-users.json
fi
```

### Step 8: Start Casino Server with PM2

```bash
cd ~/PersonalWebsite
pm2 start ecosystem.config.js
pm2 save
```

**Note**: If you haven't run `pm2 startup` yet, do it now. If you already have, you don't need to run it again.

### Step 9: Verify Both Services Are Running

```bash
# Check all PM2 processes (should show both services if Ask-Gary uses PM2)
pm2 status

# Or check processes manually
ps aux | grep -E "(uvicorn|casino-server)"

# Test Ask-Gary (should still work)
curl https://api.gary-yong.com/health

# Test Casino server
curl http://localhost:3001
```

### Step 10: Verify Deployment

1. **Test Ask-Gary**: Visit `https://gary-yong.com/ask-gary.html` - should still work
2. **Test Casino**: Visit `https://gary-yong.com/casino.html` - should work

## Troubleshooting

### Issue: Ask-Gary stops working after Nginx reload

**Solution**: 
- Restore your Nginx backup: `sudo cp /etc/nginx/sites-available/gary-yong.com.backup /etc/nginx/sites-available/gary-yong.com`
- Review the error: `sudo nginx -t`
- Make sure you didn't accidentally remove Ask-Gary routes

### Issue: Port 3001 already in use

**Solution**:
- Check what's using it: `sudo lsof -i :3001`
- The casino server should be the only thing using port 3001
- If Ask-Gary is using it (unlikely), change casino port in `ecosystem.config.js`

### Issue: Both services work but one is slow

**Solution**:
- Check system resources: `htop` or `top`
- Check PM2 logs: `pm2 logs`
- Ensure both have adequate resources

## Current Architecture After Deployment

```
Internet
    │
    ├─> Nginx (Port 80/443)
    │   │
    │   ├─> /ask-gary.html ────> Static files (served by Nginx)
    │   ├─> /casino.html ──────> Static files (served by Nginx)
    │   ├─> api.gary-yong.com ─> Ask-Gary Backend (Port 8000, Python/FastAPI)
    │   ├─> /socket.io/* ──────> Casino Backend (Port 3001, Node.js/Socket.io)
    │   └─> /api/* ────────────> Casino Backend (Port 3001, Node.js/Express)
    │
    ├─> Ask-Gary Process (PM2 or systemd)
    │   └─> Python/FastAPI on port 8000
    │
    └─> Casino Process (PM2)
        └─> Node.js/Express on port 3001
```

## Maintenance Commands

### View All Running Services

```bash
# PM2 processes
pm2 list

# All node/python processes
ps aux | grep -E "(node|python|uvicorn)"

# Systemd services (if Ask-Gary uses systemd)
sudo systemctl list-units --type=service | grep -E "(ask-gary|casino)"
```

### Restart Services Individually

```bash
# Restart only casino (Ask-Gary keeps running)
pm2 restart casino-server

# Restart Ask-Gary (if using PM2)
pm2 restart ask-gary  # or whatever the process name is
```

### View Logs

```bash
# Casino logs
pm2 logs casino-server

# All PM2 logs
pm2 logs

# Ask-Gary logs (if using PM2)
pm2 logs ask-gary

# Or if Ask-Gary uses systemd
sudo journalctl -u ask-gary -f
```

## Summary

✅ **Safe to deploy**: No conflicts with existing Ask-Gary setup  
✅ **Additive changes**: Only adds new routes, doesn't modify existing ones  
✅ **Independent services**: Can start/stop/restart independently  
✅ **No data loss**: Existing Ask-Gary data/configurations untouched  

If you have any concerns, test on a staging environment first or take a snapshot of your EC2 instance before deploying.



