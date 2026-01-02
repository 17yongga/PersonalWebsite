#!/bin/bash
# deploy-s3.sh - Deploy static files to S3

set -e

# ============================================
# CONFIGURATION - UPDATE THESE VALUES
# ============================================
S3_BUCKET="your-s3-bucket-name"
DISTRIBUTION_ID="your-cloudfront-distribution-id"  # Leave empty if not using CloudFront

# ============================================
# DEPLOYMENT SCRIPT
# ============================================

echo "🚀 Deploying static files to S3..."
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

# Invalidate CloudFront cache
if [ ! -z "$DISTRIBUTION_ID" ]; then
  echo ""
  echo "🔄 Invalidating CloudFront cache..."
  aws cloudfront create-invalidation \
    --distribution-id $DISTRIBUTION_ID \
    --paths "/casino.html" "/casino.css" "/casino.js" "/games/blackjack.js" "/games/coinflip-casino.js" "/games/roulette-casino.js" "/games/games.css"
  
  echo "⏳ CloudFront invalidation initiated. It may take a few minutes to complete."
fi

echo ""
echo "✅ S3 deployment complete!"
echo ""
echo "Verify deployment:"
echo "  - Visit: https://gary-yong.com/casino.html"
echo "  - Check browser console for errors"
echo "  - Test game functionality"


