# Casino Games Deployment Guide for gary-yong.com

This guide provides step-by-step instructions for deploying the casino games (Blackjack, Coinflip, and Roulette) to your EC2 instance at gary-yong.com.

## Prerequisites

- EC2 instance with Ubuntu (or similar Linux distribution)
- Node.js installed (version 16+ recommended)
- Nginx installed and configured
- Domain gary-yong.com pointing to your EC2 instance
- SSH access to your EC2 instance

## Architecture Overview

- **Frontend**: Static HTML/CSS/JS files served by Nginx
- **Backend**: Node.js server (`casino-server.js`) running on port 3001
- **WebSocket**: Socket.io for real-time game communication
- **Database**: JSON file (`casino-users.json`) for user storage

## Step 1: Prepare Your Local Repository

All files should be committed and pushed to GitHub first. The deployment assumes you have:
- `casino-server.js` - Backend server
- `casino.html`, `casino.js`, `casino.css` - Frontend files
- `games/` directory - Game modules
- `casino-package.json` - Server dependencies

## Step 2: Connect to Your EC2 Instance

```bash
ssh -i your-key.pem ubuntu@your-ec2-ip
# or
ssh ubuntu@gary-yong.com
```

## Step 3: Clone/Update Repository on EC2

If you haven't cloned the repository yet:

```bash
cd ~
git clone https://github.com/17yongga/PersonalWebsite.git
cd PersonalWebsite
```

If the repository already exists:

```bash
cd ~/PersonalWebsite
git pull origin master
```

## Step 4: Install Dependencies

Install Node.js dependencies for the casino server:

```bash
cd ~/PersonalWebsite
npm install --production
```

If you have separate package.json files, you may need to install from both:

```bash
# Install main dependencies (if needed)
npm install

# Casino server dependencies should be in the main package.json
# If casino-package.json exists separately, merge dependencies
```

## Step 5: Configure Nginx

Create or update your Nginx configuration to serve the static files and proxy WebSocket connections:

```bash
sudo nano /etc/nginx/sites-available/gary-yong.com
```

Add/update the following configuration:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name gary-yong.com www.gary-yong.com;

    # If you have SSL certificates (recommended)
    # listen 443 ssl http2;
    # listen [::]:443 ssl http2;
    # ssl_certificate /path/to/certificate.crt;
    # ssl_certificate_key /path/to/private.key;

    # Root directory - adjust path to your website directory
    root /home/ubuntu/PersonalWebsite;
    index index.html casino.html;

    # Serve static files
    location / {
        try_files $uri $uri/ =404;
    }

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

    # Cache static assets
    location ~* \.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

Enable the site and test the configuration:

```bash
sudo ln -sf /etc/nginx/sites-available/gary-yong.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## Step 6: Set Up PM2 for Process Management

Install PM2 (Process Manager 2) to keep your Node.js server running:

```bash
sudo npm install -g pm2
```

Create a PM2 ecosystem file:

```bash
cd ~/PersonalWebsite
nano ecosystem.config.js
```

Add the following content:

```javascript
module.exports = {
  apps: [{
    name: 'casino-server',
    script: './casino-server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    error_file: './logs/casino-error.log',
    out_file: './logs/casino-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true
  }]
};
```

Create logs directory:

```bash
mkdir -p ~/PersonalWebsite/logs
```

## Step 7: Initialize Casino Data Files

Create an empty users file if it doesn't exist:

```bash
cd ~/PersonalWebsite
if [ ! -f casino-users.json ]; then
  echo '{}' > casino-users.json
  chmod 644 casino-users.json
fi
```

## Step 8: Start the Casino Server

Start the server with PM2:

```bash
cd ~/PersonalWebsite
pm2 start ecosystem.config.js
```

Save PM2 configuration to start on system reboot:

```bash
pm2 save
pm2 startup
# Follow the instructions provided by pm2 startup command
```

Check server status:

```bash
pm2 status
pm2 logs casino-server
```

## Step 9: Configure Firewall (Security Group)

Ensure your EC2 security group allows:
- Port 80 (HTTP) - Inbound from anywhere (0.0.0.0/0)
- Port 443 (HTTPS) - Inbound from anywhere (0.0.0.0/0) if using SSL
- Port 22 (SSH) - Inbound from your IP only (recommended)

Port 3001 should NOT be exposed publicly - it should only be accessible via localhost (through Nginx proxy).

## Step 10: Set Up SSL (Recommended)

For production, set up SSL certificates using Let's Encrypt:

```bash
sudo apt update
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d gary-yong.com -d www.gary-yong.com
```

Follow the prompts. Certbot will automatically update your Nginx configuration.

## Step 11: Verify Deployment

1. **Check server is running:**
   ```bash
   pm2 status
   curl http://localhost:3001
   ```

2. **Test the website:**
   - Visit `http://gary-yong.com/casino.html` in your browser
   - Try registering a new account
   - Test all three games (Blackjack, Coinflip, Roulette)

3. **Check logs if issues:**
   ```bash
   pm2 logs casino-server
   sudo tail -f /var/log/nginx/error.log
   sudo tail -f /var/log/nginx/access.log
   ```

## Step 12: Update Deployment Script (Optional)

Create a deployment script for easy updates:

```bash
cd ~/PersonalWebsite
nano deploy.sh
```

Add:

```bash
#!/bin/bash
set -e

echo "Starting deployment..."

# Pull latest changes
git pull origin master

# Install/update dependencies
npm install --production

# Restart casino server
pm2 restart casino-server

# Reload Nginx
sudo systemctl reload nginx

echo "Deployment complete!"
```

Make it executable:

```bash
chmod +x deploy.sh
```

## Troubleshooting

### Server not starting
- Check Node.js version: `node --version` (should be 16+)
- Check dependencies: `npm list`
- Check logs: `pm2 logs casino-server`
- Check port availability: `sudo lsof -i :3001`

### WebSocket connection issues
- Verify Nginx proxy configuration for `/socket.io/`
- Check browser console for WebSocket errors
- Verify server is running: `pm2 status`
- Check Nginx error logs: `sudo tail -f /var/log/nginx/error.log`

### Static files not loading
- Verify file permissions: `ls -la ~/PersonalWebsite`
- Check Nginx root directory configuration
- Verify file paths in HTML files

### CORS errors
- The server is configured with CORS: `origin: "*"` which should allow all origins
- If issues persist, check Nginx headers configuration

## Maintenance

### Updating the Application

```bash
cd ~/PersonalWebsite
git pull origin master
npm install --production
pm2 restart casino-server
```

### Viewing Logs

```bash
# Application logs
pm2 logs casino-server

# Nginx access logs
sudo tail -f /var/log/nginx/access.log

# Nginx error logs
sudo tail -f /var/log/nginx/error.log
```

### Backup User Data

Regularly backup the `casino-users.json` file:

```bash
# Create backup directory
mkdir -p ~/backups

# Backup users file
cp ~/PersonalWebsite/casino-users.json ~/backups/casino-users-$(date +%Y%m%d).json
```

### Monitoring

Monitor server resources:

```bash
# PM2 monitoring
pm2 monit

# System resources
htop
# or
top
```

## Security Considerations

1. **User Data**: The `casino-users.json` file contains hashed passwords. Ensure proper file permissions:
   ```bash
   chmod 600 ~/PersonalWebsite/casino-users.json
   ```

2. **Firewall**: Keep port 3001 closed to the internet. Only allow access through Nginx proxy.

3. **SSL**: Use HTTPS in production to encrypt data transmission.

4. **Backups**: Regularly backup user data files.

5. **Updates**: Keep Node.js and npm packages updated for security patches.

## Additional Notes

- The casino server runs on port 3001 internally
- Frontend connects using `window.location.origin`, so it will automatically use the correct domain
- All WebSocket and API requests are proxied through Nginx
- User sessions are maintained via Socket.io connections
- Credits are persisted to `casino-users.json` file

## Support

If you encounter issues:
1. Check PM2 logs: `pm2 logs casino-server`
2. Check Nginx logs: `sudo tail -f /var/log/nginx/error.log`
3. Verify all services are running: `pm2 status && sudo systemctl status nginx`
4. Test localhost connection: `curl http://localhost:3001`

