# Port Assignments - Service Configuration

This document outlines the port assignments for all services on gary-yong.com to ensure no conflicts.

## Port Allocation

| Service | Port | Technology | URL Path |
|---------|------|------------|----------|
| **Ask-Gary Backend** | `8000` | Python/FastAPI | `api.gary-yong.com` or `/ask-gary/` |
| **Casino Games Backend** | `3001` | Node.js/Express | `/api/*`, `/socket.io/*` |
| **Budget App Backend** | `8002` | Python/FastAPI | `/api/budget/` |
| **Coinflip Standalone** | `3000` | Node.js (optional) | `/coinflip/` |

## Local Development Ports

| Service | Port | Purpose |
|---------|------|---------|
| Frontend Dev Server | `5500` | Static file serving (all apps) |
| Ask-Gary Backend | `8000` | API endpoint |
| Casino Games Backend | `3001` | API & WebSocket endpoint |
| Budget App Backend | `8002` | API endpoint |

## Port Conflict Prevention

### ✅ No Conflicts

- **Ask-Gary (8000)** ≠ **Budget App (8002)** ✓
- **Casino Games (3001)** ≠ **All other services** ✓
- **Budget App (8002)** ≠ **All other services** ✓

### Configuration Files

Each service has its own configuration:

- **Ask-Gary**: `ask-gary-backend/main.py` (hardcoded port 8000 in uvicorn command)
- **Casino**: `casino-server.js` (PORT env var, defaults to 3001)
- **Budget**: `budget-backend/main.py` (BUDGET_PORT env var, defaults to 8002)

## Running Services Locally

### Terminal 1: Ask-Gary
```bash
cd ask-gary-backend
source venv/bin/activate  # or venv\Scripts\activate on Windows
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Terminal 2: Casino Games
```bash
cd ~/PersonalWebsite
PORT=3001 node casino-server.js
# or
npm start  # if configured in package.json
```

### Terminal 3: Budget App
```bash
cd budget-backend
source venv/bin/activate  # or venv\Scripts\activate on Windows
uvicorn main:app --reload --host 0.0.0.0 --port 8002
```

### Terminal 4: Frontend Dev Server
```bash
cd ~/PersonalWebsite
python -m http.server 5500
```

## Production Deployment

### Nginx Configuration

All services are proxied through Nginx on ports 80/443:

```nginx
# Ask-Gary Backend (port 8000)
location /ask-gary/ {
    proxy_pass http://localhost:8000/;
    # ... proxy settings
}

# Casino Games Backend (port 3001)
location /api/ {
    proxy_pass http://localhost:3001;
    # ... proxy settings
}

location /socket.io/ {
    proxy_pass http://localhost:3001;
    # ... WebSocket proxy settings
}

# Budget App Backend (port 8002)
location /api/budget/ {
    proxy_pass http://localhost:8002/;
    # ... proxy settings
}
```

### Process Management

Services can run independently:

```bash
# PM2 for Node.js services
pm2 start casino-server.js --name casino
pm2 start ecosystem.config.js

# Systemd for Python services
sudo systemctl start ask-gary
sudo systemctl start budget-app

# Or PM2 for Python services
pm2 start "uvicorn main:app --host 0.0.0.0 --port 8000" --name ask-gary --interpreter python
pm2 start "uvicorn main:app --host 0.0.0.0 --port 8002" --name budget-app --interpreter python
```

## Environment Variables

### Ask-Gary
No port env var needed (uses 8000 by default in uvicorn command)

### Casino Games
```bash
PORT=3001  # Optional, defaults to 3001
```

### Budget App
```bash
BUDGET_PORT=8002  # Optional, defaults to 8002
```

## Checking Port Usage

```bash
# Check what's using each port
sudo lsof -i :8000  # Ask-Gary
sudo lsof -i :3001  # Casino
sudo lsof -i :8002  # Budget App

# Or using netstat
sudo netstat -tlnp | grep -E "(8000|3001|8002)"
```

## Troubleshooting Port Conflicts

If you see "Address already in use" errors:

1. **Identify the conflict**: Check which process is using the port
   ```bash
   sudo lsof -i :<port>
   ```

2. **Kill the conflicting process** (if safe to do so):
   ```bash
   sudo kill -9 <PID>
   ```

3. **Or change the port** for the new service:
   - Update the service configuration
   - Update Nginx proxy configuration
   - Update frontend API URLs if needed

## Summary

✅ **All services use different ports**  
✅ **No conflicts possible**  
✅ **Services can run simultaneously**  
✅ **Each service is independent**

