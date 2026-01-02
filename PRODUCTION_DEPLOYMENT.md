# Production Deployment Guide: S3 + EC2

This guide provides step-by-step instructions for deploying casino game updates to production, with static files on S3 and server files on EC2.

## Architecture Overview

- **Static Files (S3)**: HTML, CSS, JavaScript files served from S3/CloudFront
- **Server Files (EC2)**: Node.js backend (`casino-server.js`) running on EC2 instance
- **Domain**: `gary-yong.com` / `api.gary-yong.com`

---

## Part 1: Deploy Static Files to S3

### Step 1: Identify Static Files to Upload

The following files need to be uploaded to S3:

**Casino Game Files:**
- `casino.html`
- `casino.css`
- `casino.js`
- `games/blackjack.js`
- `games/coinflip-casino.js`
- `games/roulette-casino.js`
- `games/games.css`

**Other static files (if updated):**
- `index.html` (if modified)
- `styles.css` (if modified)
- `main.js` (if modified)
- Any image files in `img/` directory (if modified)
- Any vendor files (if modified)

### Step 2: Configure AWS CLI (If Not Already Done)

```bash
# Install AWS CLI (if not installed)
# Windows: Download from https://aws.amazon.com/cli/
# Mac: brew install awscli
# Linux: sudo apt-get install awscli

# Configure AWS credentials
aws configure
# Enter your AWS Access Key ID
# Enter your AWS Secret Access Key
# Enter default region (e.g., us-east-1)
# Enter default output format (json)
```

### Step 3: Upload Static Files to S3

**Option A: Upload Individual Files (Recommended for Updates)**

```bash
# Set your S3 bucket name (replace with your actual bucket name)
S3_BUCKET="your-s3-bucket-name"

# Upload casino files
aws s3 cp casino.html s3://$S3_BUCKET/casino.html --content-type "text/html"
aws s3 cp casino.css s3://$S3_BUCKET/casino.css --content-type "text/css"
aws s3 cp casino.js s3://$S3_BUCKET/casino.js --content-type "application/javascript"

# Upload game files
aws s3 cp games/blackjack.js s3://$S3_BUCKET/games/blackjack.js --content-type "application/javascript"
aws s3 cp games/coinflip-casino.js s3://$S3_BUCKET/games/coinflip-casino.js --content-type "application/javascript"
aws s3 cp games/roulette-casino.js s3://$S3_BUCKET/games/roulette-casino.js --content-type "application/javascript"
aws s3 cp games/games.css s3://$S3_BUCKET/games/games.css --content-type "text/css"
```

**Option B: Sync Entire Directory (Use with Caution)**

```bash
# Sync only specific directories (safer)
aws s3 sync games/ s3://$S3_BUCKET/games/ --exclude "*" --include "*.js" --include "*.css" --content-type "application/javascript" --content-type "text/css"

# Sync root casino files
aws s3 cp casino.html s3://$S3_BUCKET/ --content-type "text/html"
aws s3 cp casino.css s3://$S3_BUCKET/ --content-type "text/css"
aws s3 cp casino.js s3://$S3_BUCKET/ --content-type "application/javascript"
```

**Option C: Using PowerShell (Windows)**

```powershell
# Set your S3 bucket name
$S3_BUCKET = "your-s3-bucket-name"

# Upload casino files
aws s3 cp casino.html s3://$S3_BUCKET/casino.html --content-type "text/html"
aws s3 cp casino.css s3://$S3_BUCKET/casino.css --content-type "text/css"
aws s3 cp casino.js s3://$S3_BUCKET/casino.js --content-type "application/javascript"

# Upload game files
aws s3 cp games/blackjack.js s3://$S3_BUCKET/games/blackjack.js --content-type "application/javascript"
aws s3 cp games/coinflip-casino.js s3://$S3_BUCKET/games/coinflip-casino.js --content-type "application/javascript"
aws s3 cp games/roulette-casino.js s3://$S3_BUCKET/games/roulette-casino.js --content-type "application/javascript"
aws s3 cp games/games.css s3://$S3_BUCKET/games/games.css --content-type "text/css"
```

### Step 4: Set Cache Headers (Optional but Recommended)

```bash
# Set cache headers for better performance
# HTML files: short cache (5 minutes)
aws s3 cp casino.html s3://$S3_BUCKET/casino.html \
  --content-type "text/html" \
  --cache-control "max-age=300"

# CSS/JS files: longer cache (1 year, but use versioning in production)
aws s3 cp casino.css s3://$S3_BUCKET/casino.css \
  --content-type "text/css" \
  --cache-control "max-age=31536000"

aws s3 cp casino.js s3://$S3_BUCKET/casino.js \
  --content-type "application/javascript" \
  --cache-control "max-age=31536000"
```

### Step 5: Invalidate CloudFront Cache (If Using CloudFront)

If you're using CloudFront in front of S3, invalidate the cache:

```bash
# Set your CloudFront distribution ID
DISTRIBUTION_ID="your-cloudfront-distribution-id"

# Invalidate specific paths
aws cloudfront create-invalidation \
  --distribution-id $DISTRIBUTION_ID \
  --paths "/casino.html" "/casino.css" "/casino.js" "/games/*"

# Or invalidate all paths (use with caution)
aws cloudfront create-invalidation \
  --distribution-id $DISTRIBUTION_ID \
  --paths "/*"
```

### Step 6: Verify S3 Upload

```bash
# List files in S3 bucket
aws s3 ls s3://$S3_BUCKET/

# List game files
aws s3 ls s3://$S3_BUCKET/games/

# Check a specific file
aws s3 cp s3://$S3_BUCKET/casino.html - | head -20
```

---

## Part 2: Deploy Server Files to EC2

### Step 1: Connect to EC2 Instance

```bash
# Connect via SSH (replace with your key and instance details)
ssh -i ~/.ssh/your-key.pem ubuntu@gary-yong.com
# or
ssh ubuntu@your-ec2-ip-address
```

### Step 2: Navigate to Project Directory

```bash
cd ~/PersonalWebsite
```

### Step 3: Pull Latest Changes from Git

```bash
# Pull the latest code from GitHub
git pull origin master

# Verify the changes
git log --oneline -5
```

### Step 4: Install/Update Dependencies

```bash
# Install or update Node.js dependencies
npm install --production

# Verify installation
npm list --depth=0
```

### Step 5: Verify Server Configuration

```bash
# Check if ecosystem.config.js exists and is correct
cat ecosystem.config.js

# Check if casino-server.js exists
ls -la casino-server.js

# Check if logs directory exists
mkdir -p logs
```

### Step 6: Restart the Casino Server

**Option A: Using PM2 (Recommended)**

```bash
# Check current PM2 status
pm2 status

# Restart the casino server
pm2 restart casino-server

# If the server isn't running, start it
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# View logs to verify it started correctly
pm2 logs casino-server --lines 50
```

**Option B: Manual Restart (If Not Using PM2)**

```bash
# Stop the server (if running manually)
pkill -f casino-server.js

# Start the server
node casino-server.js
# Or use nohup for background:
nohup node casino-server.js > logs/casino-out.log 2> logs/casino-error.log &
```

### Step 7: Verify Server is Running

```bash
# Check if the server process is running
ps aux | grep casino-server

# Check if port 3001 is listening
sudo netstat -tlnp | grep 3001
# or
sudo lsof -i :3001

# Test the server locally
curl http://localhost:3001

# Check PM2 status
pm2 status
pm2 info casino-server
```

### Step 8: Check Server Logs

```bash
# View PM2 logs
pm2 logs casino-server --lines 100

# Or if using manual process, check log files
tail -f logs/casino-out.log
tail -f logs/casino-error.log
```

---

## Part 3: Verify Deployment

### Step 1: Test Static Files (S3)

1. **Open browser and visit:**
   ```
   https://gary-yong.com/casino.html
   ```

2. **Check browser console (F12) for errors:**
   - Open Developer Tools (F12)
   - Go to Console tab
   - Look for any JavaScript errors
   - Verify all files are loading correctly

3. **Verify file versions:**
   - Check Network tab in Developer Tools
   - Verify files are being served from S3/CloudFront
   - Check that file timestamps match your upload

### Step 2: Test Server Connection (EC2)

1. **Test WebSocket connection:**
   - Open casino.html in browser
   - Open Developer Tools → Console
   - Look for connection messages
   - Try creating a coinflip room or playing roulette

2. **Test API endpoints:**
   ```bash
   # From your local machine or EC2
   curl https://api.gary-yong.com/api/health
   # or
   curl http://your-ec2-ip:3001/api/health
   ```

3. **Test game functionality:**
   - **Blackjack**: Start a game, place a bet, hit/stand
   - **Coinflip**: Create a room, test bot opponent
   - **Roulette**: Place bets, spin the wheel

### Step 3: Monitor Server Health

```bash
# On EC2, check server status
pm2 status
pm2 monit

# Check system resources
htop
# or
top

# Check Nginx status (if using)
sudo systemctl status nginx
sudo tail -f /var/log/nginx/error.log
```

---

## Quick Deployment Script

Create a script to automate the deployment process:

### For S3 (Local Machine)

**`deploy-s3.sh` (Linux/Mac) or `deploy-s3.ps1` (Windows PowerShell):**

```bash
#!/bin/bash
# deploy-s3.sh

set -e

S3_BUCKET="your-s3-bucket-name"
DISTRIBUTION_ID="your-cloudfront-distribution-id"

echo "🚀 Deploying static files to S3..."

# Upload casino files
echo "📤 Uploading casino files..."
aws s3 cp casino.html s3://$S3_BUCKET/casino.html --content-type "text/html" --cache-control "max-age=300"
aws s3 cp casino.css s3://$S3_BUCKET/casino.css --content-type "text/css" --cache-control "max-age=31536000"
aws s3 cp casino.js s3://$S3_BUCKET/casino.js --content-type "application/javascript" --cache-control "max-age=31536000"

# Upload game files
echo "📤 Uploading game files..."
aws s3 cp games/blackjack.js s3://$S3_BUCKET/games/blackjack.js --content-type "application/javascript" --cache-control "max-age=31536000"
aws s3 cp games/coinflip-casino.js s3://$S3_BUCKET/games/coinflip-casino.js --content-type "application/javascript" --cache-control "max-age=31536000"
aws s3 cp games/roulette-casino.js s3://$S3_BUCKET/games/roulette-casino.js --content-type "application/javascript" --cache-control "max-age=31536000"
aws s3 cp games/games.css s3://$S3_BUCKET/games/games.css --content-type "text/css" --cache-control "max-age=31536000"

# Invalidate CloudFront cache
if [ ! -z "$DISTRIBUTION_ID" ]; then
  echo "🔄 Invalidating CloudFront cache..."
  aws cloudfront create-invalidation \
    --distribution-id $DISTRIBUTION_ID \
    --paths "/casino.html" "/casino.css" "/casino.js" "/games/*"
fi

echo "✅ S3 deployment complete!"
```

**Windows PowerShell version (`deploy-s3.ps1`):**

```powershell
# deploy-s3.ps1

$S3_BUCKET = "your-s3-bucket-name"
$DISTRIBUTION_ID = "your-cloudfront-distribution-id"

Write-Host "🚀 Deploying static files to S3..." -ForegroundColor Green

# Upload casino files
Write-Host "📤 Uploading casino files..." -ForegroundColor Yellow
aws s3 cp casino.html "s3://$S3_BUCKET/casino.html" --content-type "text/html" --cache-control "max-age=300"
aws s3 cp casino.css "s3://$S3_BUCKET/casino.css" --content-type "text/css" --cache-control "max-age=31536000"
aws s3 cp casino.js "s3://$S3_BUCKET/casino.js" --content-type "application/javascript" --cache-control "max-age=31536000"

# Upload game files
Write-Host "📤 Uploading game files..." -ForegroundColor Yellow
aws s3 cp games/blackjack.js "s3://$S3_BUCKET/games/blackjack.js" --content-type "application/javascript" --cache-control "max-age=31536000"
aws s3 cp games/coinflip-casino.js "s3://$S3_BUCKET/games/coinflip-casino.js" --content-type "application/javascript" --cache-control "max-age=31536000"
aws s3 cp games/roulette-casino.js "s3://$S3_BUCKET/games/roulette-casino.js" --content-type "application/javascript" --cache-control "max-age=31536000"
aws s3 cp games/games.css "s3://$S3_BUCKET/games/games.css" --content-type "text/css" --cache-control "max-age=31536000"

# Invalidate CloudFront cache
if ($DISTRIBUTION_ID) {
    Write-Host "🔄 Invalidating CloudFront cache..." -ForegroundColor Yellow
    aws cloudfront create-invalidation `
        --distribution-id $DISTRIBUTION_ID `
        --paths "/casino.html", "/casino.css", "/casino.js", "/games/*"
}

Write-Host "✅ S3 deployment complete!" -ForegroundColor Green
```

### For EC2 (On EC2 Instance)

**`deploy-ec2.sh` (already exists, but here's the updated version):**

```bash
#!/bin/bash
# deploy-ec2.sh

set -e

echo "🚀 Starting casino server deployment..."

# Pull latest changes
echo "📥 Pulling latest changes from GitHub..."
git pull origin master

# Install/update dependencies
echo "📦 Installing dependencies..."
npm install --production

# Restart casino server
echo "🔄 Restarting casino server..."
pm2 restart casino-server || pm2 start ecosystem.config.js
pm2 save

# Reload Nginx (if needed)
echo "🔄 Reloading Nginx..."
sudo systemctl reload nginx

echo "✅ EC2 deployment complete!"
echo ""
echo "Check server status with: pm2 status"
echo "View logs with: pm2 logs casino-server"
```

---

## Troubleshooting

### S3 Issues

**Problem: Files not updating on website**
- **Solution**: Invalidate CloudFront cache or wait for cache to expire
- **Check**: Verify files were uploaded with correct content-type headers

**Problem: CORS errors**
- **Solution**: Ensure S3 bucket CORS configuration allows your domain
- **Check**: S3 bucket → Permissions → CORS configuration

**Problem: 403 Forbidden errors**
- **Solution**: Check S3 bucket policy and IAM permissions
- **Check**: Ensure public read access is configured correctly

### EC2 Issues

**Problem: Server won't start**
```bash
# Check logs
pm2 logs casino-server

# Check Node.js version
node --version  # Should be 16+

# Check if port is already in use
sudo lsof -i :3001

# Check dependencies
npm list --depth=0
```

**Problem: WebSocket connection fails**
- **Solution**: Check Nginx configuration for `/socket.io/` location block
- **Check**: Verify server is running: `pm2 status`
- **Check**: Test WebSocket connection: `curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" http://localhost:3001/socket.io/`

**Problem: Changes not reflecting**
- **Solution**: Ensure you pulled latest code: `git pull origin master`
- **Solution**: Restart server: `pm2 restart casino-server`
- **Check**: Verify file timestamps match your git commit

**Problem: High memory usage**
```bash
# Check memory usage
pm2 monit

# Restart if needed
pm2 restart casino-server

# Check for memory leaks in logs
pm2 logs casino-server | grep -i "memory\|error"
```

---

## Rollback Procedure

If something goes wrong, here's how to rollback:

### Rollback S3 Files

```bash
# Option 1: Revert to previous version (if versioning enabled)
aws s3 cp s3://$S3_BUCKET/casino.html --version-id PREVIOUS_VERSION_ID s3://$S3_BUCKET/casino.html

# Option 2: Restore from git (if files are in git)
git checkout HEAD~1 -- casino.html casino.css casino.js games/
# Then re-upload to S3
```

### Rollback EC2 Server

```bash
# On EC2 instance
cd ~/PersonalWebsite

# Revert to previous commit
git log --oneline -10  # Find the commit hash before your changes
git checkout PREVIOUS_COMMIT_HASH

# Restart server
pm2 restart casino-server

# Or restore from backup
# (if you created a backup before deployment)
```

---

## Pre-Deployment Checklist

Before deploying to production:

- [ ] All changes committed and pushed to git
- [ ] Code tested locally
- [ ] No console errors in browser
- [ ] All game features tested (blackjack, coinflip, roulette)
- [ ] Server URL configured correctly (`https://api.gary-yong.com`)
- [ ] S3 bucket name and CloudFront distribution ID noted
- [ ] EC2 SSH access confirmed
- [ ] Backup of current production files (if needed)

---

## Post-Deployment Checklist

After deploying:

- [ ] Static files accessible on website
- [ ] Server responding to API requests
- [ ] WebSocket connections working
- [ ] All games functional
- [ ] No errors in browser console
- [ ] No errors in server logs
- [ ] Server health monitoring active
- [ ] Performance acceptable

---

## Summary

**Deployment Flow:**
1. ✅ Commit and push changes to git
2. ✅ Upload static files to S3
3. ✅ Invalidate CloudFront cache (if using)
4. ✅ SSH to EC2 and pull latest code
5. ✅ Install/update dependencies
6. ✅ Restart server with PM2
7. ✅ Verify deployment
8. ✅ Monitor logs and performance

**Key Files:**
- **S3**: `casino.html`, `casino.css`, `casino.js`, `games/*.js`, `games/*.css`
- **EC2**: `casino-server.js`, `package.json`, `ecosystem.config.js`, `casino-users.json`

**Key Commands:**
- **S3**: `aws s3 cp`, `aws cloudfront create-invalidation`
- **EC2**: `git pull`, `npm install`, `pm2 restart casino-server`


