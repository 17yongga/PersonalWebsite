# deploy-s3.ps1 - Deploy static files to S3 (PowerShell)

# ============================================
# CONFIGURATION - UPDATE THESE VALUES
# ============================================
$S3_BUCKET = "your-s3-bucket-name"
$DISTRIBUTION_ID = "your-cloudfront-distribution-id"  # Leave empty if not using CloudFront

# ============================================
# DEPLOYMENT SCRIPT
# ============================================

Write-Host "🚀 Deploying static files to S3..." -ForegroundColor Green
Write-Host "Bucket: $S3_BUCKET" -ForegroundColor Cyan
if ($DISTRIBUTION_ID) {
    Write-Host "CloudFront Distribution: $DISTRIBUTION_ID" -ForegroundColor Cyan
}
Write-Host ""

# Upload casino files
Write-Host "📤 Uploading casino files..." -ForegroundColor Yellow
aws s3 cp casino.html "s3://$S3_BUCKET/casino.html" `
    --content-type "text/html" `
    --cache-control "max-age=300"

aws s3 cp casino.css "s3://$S3_BUCKET/casino.css" `
    --content-type "text/css" `
    --cache-control "max-age=31536000"

aws s3 cp casino.js "s3://$S3_BUCKET/casino.js" `
    --content-type "application/javascript" `
    --cache-control "max-age=31536000"

# Upload game files
Write-Host "📤 Uploading game files..." -ForegroundColor Yellow
aws s3 cp games/blackjack.js "s3://$S3_BUCKET/games/blackjack.js" `
    --content-type "application/javascript" `
    --cache-control "max-age=31536000"

aws s3 cp games/coinflip-casino.js "s3://$S3_BUCKET/games/coinflip-casino.js" `
    --content-type "application/javascript" `
    --cache-control "max-age=31536000"

aws s3 cp games/roulette-casino.js "s3://$S3_BUCKET/games/roulette-casino.js" `
    --content-type "application/javascript" `
    --cache-control "max-age=31536000"

aws s3 cp games/games.css "s3://$S3_BUCKET/games/games.css" `
    --content-type "text/css" `
    --cache-control "max-age=31536000"

aws s3 cp games/cs2-betting-casino.js "s3://$S3_BUCKET/games/cs2-betting-casino.js" `
    --content-type "application/javascript" `
    --cache-control "max-age=31536000"

# Invalidate CloudFront cache
if ($DISTRIBUTION_ID) {
    Write-Host ""
    Write-Host "🔄 Invalidating CloudFront cache..." -ForegroundColor Yellow
    $paths = @(
        "/casino.html",
        "/casino.css",
        "/casino.js",
        "/games/blackjack.js",
        "/games/coinflip-casino.js",
        "/games/roulette-casino.js",
        "/games/games.css",
        "/games/cs2-betting-casino.js"
    )
    aws cloudfront create-invalidation `
        --distribution-id $DISTRIBUTION_ID `
        --paths $paths
    
    Write-Host "⏳ CloudFront invalidation initiated. It may take a few minutes to complete." -ForegroundColor Cyan
}

Write-Host ""
Write-Host "✅ S3 deployment complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Verify deployment:" -ForegroundColor Cyan
Write-Host "  - Visit: https://gary-yong.com/casino.html"
Write-Host "  - Check browser console for errors"
Write-Host "  - Test game functionality"


