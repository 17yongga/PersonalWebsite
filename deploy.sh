#!/bin/bash
set -e

echo "🚀 Starting casino games deployment..."

# Pull latest changes
echo "📥 Pulling latest changes from GitHub..."
git pull origin master

# Install/update dependencies
echo "📦 Installing dependencies..."
npm install --production

# Restart casino server
echo "🔄 Restarting casino server..."
pm2 restart casino-server || pm2 start ecosystem.config.js

# Reload Nginx
echo "🔄 Reloading Nginx..."
sudo systemctl reload nginx

echo "✅ Deployment complete!"
echo ""
echo "Check server status with: pm2 status"
echo "View logs with: pm2 logs casino-server"

