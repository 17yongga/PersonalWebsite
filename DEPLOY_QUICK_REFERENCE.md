# Quick Deployment Reference

## 🚀 Quick Deployment Steps

### Step 1: Deploy Static Files to S3 (From Local Machine)

**Windows (PowerShell):**
```powershell
# 1. Edit deploy-s3.ps1 and set your S3_BUCKET and DISTRIBUTION_ID
# 2. Run:
.\deploy-s3.ps1
```

**Linux/Mac:**
```bash
# 1. Edit deploy-s3.sh and set your S3_BUCKET and DISTRIBUTION_ID
# 2. Make executable (if not already):
chmod +x deploy-s3.sh
# 3. Run:
./deploy-s3.sh
```

**Manual (if scripts don't work):**
```bash
# Set your bucket name
S3_BUCKET="your-s3-bucket-name"

# Upload files
aws s3 cp casino.html s3://$S3_BUCKET/casino.html --content-type "text/html"
aws s3 cp casino.css s3://$S3_BUCKET/casino.css --content-type "text/css"
aws s3 cp casino.js s3://$S3_BUCKET/casino.js --content-type "application/javascript"
aws s3 cp games/blackjack.js s3://$S3_BUCKET/games/blackjack.js --content-type "application/javascript"
aws s3 cp games/coinflip-casino.js s3://$S3_BUCKET/games/coinflip-casino.js --content-type "application/javascript"
aws s3 cp games/roulette-casino.js s3://$S3_BUCKET/games/roulette-casino.js --content-type "application/javascript"
aws s3 cp games/games.css s3://$S3_BUCKET/games/games.css --content-type "text/css"

# Invalidate CloudFront (if using)
aws cloudfront create-invalidation --distribution-id YOUR_DIST_ID --paths "/casino.html" "/casino.css" "/casino.js" "/games/*"
```

---

### Step 2: Deploy Server Files to EC2

**SSH to EC2 and run:**
```bash
# Connect to EC2
ssh ubuntu@gary-yong.com

# Navigate to project
cd ~/PersonalWebsite

# Run deployment script
./deploy.sh
```

**Manual (if script doesn't work):**
```bash
cd ~/PersonalWebsite
git pull origin master
npm install --production
pm2 restart casino-server
pm2 save
sudo systemctl reload nginx
```

---

## 📋 Files to Deploy

### S3 (Static Files):
- `casino.html`
- `casino.css`
- `casino.js`
- `games/blackjack.js`
- `games/coinflip-casino.js`
- `games/roulette-casino.js`
- `games/games.css`

### EC2 (Server Files):
- `casino-server.js`
- `package.json` (for dependencies)
- `ecosystem.config.js` (PM2 config)
- `casino-users.json` (data file, created automatically)

---

## ✅ Verification Checklist

After deployment:

- [ ] Visit `https://gary-yong.com/casino.html` - page loads
- [ ] Open browser console (F12) - no errors
- [ ] Test Blackjack - game works
- [ ] Test Coinflip - create room, bot works
- [ ] Test Roulette - place bets, spin works
- [ ] Check server logs: `pm2 logs casino-server`
- [ ] Check server status: `pm2 status`

---

## 🔧 Troubleshooting

**S3 files not updating?**
- Invalidate CloudFront cache
- Check file was uploaded correctly: `aws s3 ls s3://your-bucket/`

**Server not responding?**
- Check if running: `pm2 status`
- Check logs: `pm2 logs casino-server`
- Restart: `pm2 restart casino-server`

**WebSocket errors?**
- Check Nginx config has `/socket.io/` location
- Verify server running: `pm2 status`
- Test: `curl http://localhost:3001`

---

## 📚 Full Documentation

See `PRODUCTION_DEPLOYMENT.md` for detailed instructions.


