# Quick Start Deployment Guide

This is a condensed version of the full deployment guide. For detailed instructions, see [DEPLOYMENT.md](./DEPLOYMENT.md).

## Prerequisites Checklist

- [ ] EC2 instance running Ubuntu/Linux
- [ ] Node.js 16+ installed (`node --version`)
- [ ] Nginx installed (`nginx -v`)
- [ ] SSH access to EC2 instance
- [ ] Domain gary-yong.com pointing to EC2 IP

## Quick Deployment Steps

### 1. Connect to EC2 and Clone Repository

```bash
ssh ubuntu@gary-yong.com
cd ~
git clone https://github.com/17yongga/PersonalWebsite.git
cd PersonalWebsite
```

### 2. Install Dependencies

```bash
npm install --production
```

### 3. Install PM2 (Process Manager)

```bash
sudo npm install -g pm2
```

### 4. Configure Nginx

```bash
sudo cp nginx-casino.conf.example /etc/nginx/sites-available/gary-yong.com
sudo nano /etc/nginx/sites-available/gary-yong.com
# Update root path if different from /home/ubuntu/PersonalWebsite
sudo ln -sf /etc/nginx/sites-available/gary-yong.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 5. Initialize Data Files

```bash
mkdir -p logs
echo '{}' > casino-users.json
chmod 600 casino-users.json
```

### 6. Start the Server

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # Follow the instructions
```

### 7. Verify

Visit `http://gary-yong.com/casino.html` and test the games!

## Common Commands

```bash
# View server status
pm2 status

# View logs
pm2 logs casino-server

# Restart server
pm2 restart casino-server

# Update deployment (after git pull)
./deploy.sh

# Check Nginx status
sudo systemctl status nginx

# View Nginx logs
sudo tail -f /var/log/nginx/error.log
```

## Troubleshooting

**Server won't start:**
```bash
pm2 logs casino-server
node --version  # Should be 16+
```

**WebSocket connection fails:**
- Check Nginx config has `/socket.io/` location
- Verify server running: `pm2 status`
- Check Nginx logs: `sudo tail -f /var/log/nginx/error.log`

**Static files not loading:**
- Verify Nginx root path is correct
- Check file permissions: `ls -la`

## Next Steps

1. Set up SSL certificates (Let's Encrypt)
2. Configure firewall rules
3. Set up automated backups
4. Monitor server resources

For detailed information, see [DEPLOYMENT.md](./DEPLOYMENT.md).


