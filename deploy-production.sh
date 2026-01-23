#!/bin/bash
# Production Deployment Script - EC2 + S3
# This script deploys backend to EC2 and frontend to S3

set -e

# ============================================
# CONFIGURATION - UPDATE THESE VALUES
# ============================================
S3_BUCKET="gary-yong.com"  # S3 bucket name (not ARN, just the bucket name)
DISTRIBUTION_ID="EUVZ94LCG1QV2"  # CloudFront Distribution ID (the ID, not the domain)
EC2_HOST="98.82.129.231"  # EC2 hostname or IP address (NOT CloudFront domain)
EC2_USER="ubuntu"
EC2_KEY_PATH="/c/Users/yongg/.ssh/ask-gary-key.pem"  # Path to SSH key (Git Bash format on Windows)

# ============================================
# DEPLOYMENT SCRIPT
# ============================================

echo "🚀 Starting Production Deployment..."
echo "=========================================="
echo ""

# Part 1: Deploy Backend to EC2
echo "📦 Part 1: Deploying Backend to EC2..."
echo "=========================================="

if [ -z "$EC2_KEY_PATH" ]; then
    SSH_CMD="ssh $EC2_USER@$EC2_HOST"
else
    SSH_CMD="ssh -i $EC2_KEY_PATH $EC2_USER@$EC2_HOST"
fi

$SSH_CMD << 'ENDSSH'
cd ~/PersonalWebsite
echo "📥 Pulling latest changes from GitHub..."
git pull origin master

echo "📦 Installing/updating dependencies..."
npm install --production

echo "🔄 Restarting casino server..."
pm2 restart casino-server || pm2 start ecosystem.config.js
pm2 save

echo "✅ EC2 deployment complete!"
echo ""
echo "Server Status:"
pm2 status
ENDSSH

echo ""
echo "✅ Backend deployed to EC2!"
echo ""

# Part 2: Deploy Frontend to S3
echo "📦 Part 2: Deploying Frontend to S3..."
echo "=========================================="
echo "Bucket: $S3_BUCKET"
if [ ! -z "$DISTRIBUTION_ID" ]; then
  echo "CloudFront Distribution: $DISTRIBUTION_ID"
fi
echo ""

# Upload casino files
echo "📤 Uploading casino files..."
aws s3 cp casino.html s3://$S3_BUCKET/casino.html \
  --content-type "text/html" \
  --cache-control "max-age=300"

aws s3 cp casino.css s3://$S3_BUCKET/casino.css \
  --content-type "text/css" \
  --cache-control "max-age=31536000"

aws s3 cp casino.js s3://$S3_BUCKET/casino.js \
  --content-type "application/javascript" \
  --cache-control "max-age=31536000"

# Upload game files
echo "📤 Uploading game files..."
aws s3 cp games/blackjack.js s3://$S3_BUCKET/games/blackjack.js \
  --content-type "application/javascript" \
  --cache-control "max-age=31536000"

aws s3 cp games/coinflip-casino.js s3://$S3_BUCKET/games/coinflip-casino.js \
  --content-type "application/javascript" \
  --cache-control "max-age=31536000"

aws s3 cp games/roulette-casino.js s3://$S3_BUCKET/games/roulette-casino.js \
  --content-type "application/javascript" \
  --cache-control "max-age=31536000"

aws s3 cp games/games.css s3://$S3_BUCKET/games/games.css \
  --content-type "text/css" \
  --cache-control "max-age=31536000"

aws s3 cp games/cs2-betting-casino.js s3://$S3_BUCKET/games/cs2-betting-casino.js \
  --content-type "application/javascript" \
  --cache-control "max-age=31536000"

# Invalidate CloudFront cache
if [ ! -z "$DISTRIBUTION_ID" ]; then
  echo ""
  echo "🔄 Invalidating CloudFront cache..."
  aws cloudfront create-invalidation \
    --distribution-id $DISTRIBUTION_ID \
    --paths "/casino.html" "/casino.css" "/casino.js" "/games/blackjack.js" "/games/coinflip-casino.js" "/games/roulette-casino.js" "/games/games.css" "/games/cs2-betting-casino.js"
  
  echo "⏳ CloudFront invalidation initiated. It may take a few minutes to complete."
fi

echo ""
echo "✅ Frontend deployed to S3!"
echo ""

# Summary
echo "=========================================="
echo "✅ Production Deployment Complete!"
echo "=========================================="
echo ""
echo "Deployed:"
echo "  ✅ Backend: EC2 ($EC2_HOST)"
echo "  ✅ Frontend: S3 ($S3_BUCKET)"
echo ""
echo "Next Steps:"
echo "  1. Verify backend: ssh $EC2_USER@$EC2_HOST 'pm2 logs casino-server --lines 20'"
echo "  2. Verify frontend: Visit https://gary-yong.com/casino.html"
echo "  3. Test CS2 betting functionality"
echo "  4. Monitor logs for any errors"
echo ""
echo "Check API key status in logs:"
echo "  ssh $EC2_USER@$EC2_HOST 'pm2 logs casino-server | grep \"API key\"'"
echo ""
