# NUC Setup
## STEP 1 - Restore backups
Copy files from the `NUCFiles` backup into the NUC home directory.

## Step 2 - Setup SSH 
1. Run the following to setup install SSH, Fail2Ban, and UFW:
```bash
sudo apt install openssh-server -y
sudo apt install fail2ban -y
sudo apt install ufw -y
sudo ufw allow OpenSSH
sudo ufw enable
```
2. To make sure Fail2Ban never bans anyone on the local network (this is useful as a lot of SSH testing happens locally and you don't want to ban yourself), edit `/etc/fail2ban/jail.conf` and add `192.0.2.1/24` and `192.0.2.1/24` to the space-separated `ignoreip` list. You may need to edit that address depending on your LAN settings. Then, run `service fail2ban restart`.
3. Copy your public SSH keys into the authorized_keys file in the NUC .ssh folder.
4. Edit `/etc/ssh/sshd_config` and set `PasswordAuthentication` to `no`.

## STEP 3 - Install Apps
Run the following commands to install various apps and configure Git:
```bash
sudo apt install htop -y
# curl
sudo apt install curl -y
# git
sudo apt install git -y
git config --global user.name 'Imran Remtulla'
git config --global user.email 'iremtulla15@gmail.com'
# Syncthing
curl -s https://syncthing.net/release-key.txt | sudo apt-key add -
echo "deb https://apt.syncthing.net/ syncthing stable" | sudo tee /etc/apt/sources.list.d/syncthing.list
sudo apt-get update
sudo apt-get install syncthing -y
# Node.js
curl -sL https://deb.nodesource.com/setup_15.x | sudo -E bash -
sudo apt-get install nodejs -y
# VeraCrypt
wget https://launchpad.net/veracrypt/trunk/1.24-update2/+download/veracrypt-1.24-Update2-Debian-10-amd64.deb -O veracrypt.deb > /dev/null 2>&1
sudo apt install ./veracrypt.deb -y
rm veracrypt.deb
# Exfat Support
sudo apt install exfat-fuse exfat-utils -y
# NGINX
sudo apt install nginx -y
# Docker
sudo snap install docker -y
# Certbot
sudo snap install certbot -y
```

## Step 4 - Finish Setup
1. Run "start" to mount the HDD and then setup Syncthing manually using its web GUI.
2. Run `sudo docker-compose up -d` from the home directory to install PhotoPrism.
3. Log in to PhotoPrism and change the password.
4. Paste the following into `/etc/nginx/sites-enabled/irhome.ddns.net.conf`:
    ```bash
    server {
        server_name irhome.ddns.net;

        location / {
            proxy_pass http://localhost:2342;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
        }

        listen 80;
    }
    ```
5. Run `sudo certbot --nginx -d irhome.ddns.net` to secure PhotoPrism with HTTPS.
6. Restart NGINX by running `sudo systemctl restart nginx`.
7. Login to Syncthing and set it up.
8. Login to PhotoPrism and start the indexing process.