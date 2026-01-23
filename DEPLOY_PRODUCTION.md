# Production Deployment Guide - EC2 + S3

This guide covers deploying the latest changes to your production environment:
- **EC2 Server**: Backend Node.js server (casino-server.js, cs2-api-client.js)
- **S3 Bucket**: Static frontend files (HTML, CSS, JS)

## Recent Changes to Deploy

### Backend Files (EC2):
- `casino-server.js` - Settlement logic, odds caching
- `cs2-api-client.js` - New API key with fallback mechanism

### Frontend Files (S3):
- `games/cs2-betting-casino.js` - Odds filtering updates
- `games/games.css` - UI improvements

## Part 1: Deploy Backend to EC2

### Step 1: Connect to EC2 Instance

```bash
ssh -i your-key.pem ubuntu@gary-yong.com
# or
ssh ubuntu@your-ec2-ip
```

### Step 2: Navigate to Project Directory

```bash
cd ~/PersonalWebsite
```

### Step 3: Pull Latest Changes

```bash
git pull origin master
```

### Step 4: Install/Update Dependencies

```bash
npm install --production
```

### Step 5: Restart the Server

If using PM2:
```bash
pm2 restart casino-server
```

Or if using systemd:
```bash
sudo systemctl restart casino-server
```

### Step 6: Verify Deployment

```bash
# Check server status
pm2 status
# or
sudo systemctl status casino-server

# Check logs for any errors
pm2 logs casino-server --lines 50
# or
sudo journalctl -u casino-server -n 50

# Test API endpoint
curl http://localhost:3001/api/cs2/events
```

### Step 7: Monitor Logs

Watch for any errors related to API keys or settlement:

```bash
pm2 logs casino-server --lines 100
```

Look for:
- ✅ "Using API key: 492c4517..." (new primary key)
- ✅ "Successfully using fallback API key" (if fallback is used)
- ✅ Settlement function working correctly

## Part 2: Deploy Frontend to S3

### Step 1: Update S3 Deployment Script

Edit `deploy-s3.sh` or `deploy-s3.ps1` and update:
- S3_BUCKET name
- DISTRIBUTION_ID (if using CloudFront)

### Step 2: Deploy Static Files

**On Linux/Mac:**
```bash
./deploy-s3.sh
```

**On Windows (PowerShell):**
```powershell
.\deploy-s3.ps1
```

**Or manually with AWS CLI:**

```bash
# Set your bucket name
S3_BUCKET="your-s3-bucket-name"
DISTRIBUTION_ID="your-cloudfront-id"  # Optional

# Upload CS2 betting files
aws s3 cp games/cs2-betting-casino.js s3://$S3_BUCKET/games/cs2-betting-casino.js \
  --content-type "application/javascript" \
  --cache-control "max-age=31536000"

aws s3 cp games/games.css s3://$S3_BUCKET/games/games.css \
  --content-type "text/css" \
  --cache-control "max-age=31536000"

# Invalidate CloudFront cache (if using CloudFront)
if [ ! -z "$DISTRIBUTION_ID" ]; then
  aws cloudfront create-invalidation \
    --distribution-id $DISTRIBUTION_ID \
    --paths "/games/cs2-betting-casino.js" "/games/games.css"
fi
```

### Step 3: Verify S3 Deployment

```bash
# List files in S3
aws s3 ls s3://your-s3-bucket-name/games/

# Check file metadata
aws s3api head-object --bucket your-s3-bucket-name --key games/cs2-betting-casino.js
```

## Quick Deployment Script

Create a combined deployment script for both EC2 and S3:

### `deploy-production.sh`

```bash
#!/bin/bash
set -e

echo "🚀 Starting Production Deployment..."
echo ""

# Configuration
S3_BUCKET="your-s3-bucket-name"
DISTRIBUTION_ID="your-cloudfront-id"  # Optional
EC2_HOST="gary-yong.com"
EC2_USER="ubuntu"

# Part 1: Deploy to EC2
echo "📦 Step 1: Deploying backend to EC2..."
echo "Connecting to $EC2_USER@$EC2_HOST..."

ssh $EC2_USER@$EC2_HOST << 'ENDSSH'
cd ~/PersonalWebsite
echo "Pulling latest changes..."
git pull origin master
echo "Installing dependencies..."
npm install --production
echo "Restarting server..."
pm2 restart casino-server
echo "✅ EC2 deployment complete!"
pm2 status
ENDSSH

# Part 2: Deploy to S3
echo ""
echo "📦 Step 2: Deploying frontend to S3..."
echo "Bucket: $S3_BUCKET"

# Upload CS2 betting files
aws s3 cp games/cs2-betting-casino.js s3://$S3_BUCKET/games/cs2-betting-casino.js \
  --content-type "application/javascript" \
  --cache-control "max-age=31536000"

aws s3 cp games/games.css s3://$S3_BUCKET/games/games.css \
  --content-type "text/css" \
  --cache-control "max-age=31536000"

# Invalidate CloudFront if configured
if [ ! -z "$DISTRIBUTION_ID" ]; then
  echo "🔄 Invalidating CloudFront cache..."
  aws cloudfront create-invalidation \
    --distribution-id $DISTRIBUTION_ID \
    --paths "/games/cs2-betting-casino.js" "/games/games.css"
fi

echo ""
echo "✅ Production deployment complete!"
echo ""
echo "Verify deployment:"
echo "  - Backend: Check PM2 logs on EC2"
echo "  - Frontend: Visit https://gary-yong.com/casino.html"
echo "  - Test CS2 betting functionality"
```

Make it executable:
```bash
chmod +x deploy-production.sh
```

## Verification Checklist

After deployment, verify:

### Backend (EC2):
- [ ] Server is running: `pm2 status` shows casino-server as "online"
- [ ] No errors in logs: `pm2 logs casino-server`
- [ ] API key is working: Check logs for "Using API key: 492c4517..."
- [ ] Settlement function accessible: `curl http://localhost:3001/api/cs2/admin/settle`

### Frontend (S3):
- [ ] Files uploaded: Check S3 bucket for updated files
- [ ] CloudFront cache invalidated (if applicable)
- [ ] Website loads: Visit https://gary-yong.com/casino.html
- [ ] CS2 betting page works: Test match list and betting functionality
- [ ] No console errors: Check browser developer console

## Rollback Plan

If something goes wrong:

### Rollback Backend (EC2):
```bash
ssh ubuntu@gary-yong.com
cd ~/PersonalWebsite
git log --oneline -5  # Find previous commit
git checkout <previous-commit-hash>
npm install --production
pm2 restart casino-server
```

### Rollback Frontend (S3):
```bash
# Revert to previous version from S3 versioning (if enabled)
# Or redeploy previous commit
git checkout <previous-commit-hash>
./deploy-s3.sh
```

## Post-Deployment Monitoring

Monitor for the first 30 minutes:

```bash
# On EC2
pm2 logs casino-server --lines 100

# Check for:
# - API key authentication errors
# - Settlement function errors
# - Rate limiting issues
```

## Troubleshooting

### Backend Issues

**Server won't start:**
```bash
# Check Node.js version
node --version

# Check dependencies
npm list

# Check port availability
sudo lsof -i :3001

# View detailed logs
pm2 logs casino-server --err
```

**API key errors:**
- Check logs for "All API keys exhausted"
- Verify environment variables if using ODDSPAPI_API_KEY
- Check that fallback mechanism is working

### Frontend Issues

**Files not updating:**
- Clear browser cache (Ctrl+Shift+R)
- Check CloudFront invalidation status
- Verify S3 file timestamps

**CS2 betting not working:**
- Check browser console for errors
- Verify API endpoints are accessible
- Check CORS headers

## Environment Variables (Optional)

If you want to override API keys via environment variables on EC2:

```bash
# Edit PM2 ecosystem file
nano ~/PersonalWebsite/ecosystem.config.js

# Add to env section:
env: {
  NODE_ENV: 'production',
  PORT: 3001,
  ODDSPAPI_API_KEY: '492c4517-843e-49d5-96dd-8eed82567c5b'  # Optional override
}

# Restart PM2
pm2 restart ecosystem.config.js
pm2 save
```

## Summary

**Files Changed:**
- ✅ `casino-server.js` - Settlement & caching logic
- ✅ `cs2-api-client.js` - API key with fallback
- ✅ `games/cs2-betting-casino.js` - Frontend odds filtering
- ✅ `games/games.css` - UI improvements

**Deployment Steps:**
1. ✅ Pull latest code on EC2
2. ✅ Restart backend server
3. ✅ Upload frontend files to S3
4. ✅ Invalidate CloudFront cache (if applicable)
5. ✅ Verify deployment

**Ready for Production!** 🚀
