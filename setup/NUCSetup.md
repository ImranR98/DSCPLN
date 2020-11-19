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
2. To make sure Fail2Ban never bans anyone on the local network (this is useful as a lot of SSH testing happens locally and you don't want to ban yourself), edit `/etc/fail2ban/jail.conf` and add `192.0.2.1/24` to the space-separated `ignoreip` list. You may need to edit that address depending on your LAN settings. Then, run `service fail2ban restart`.
3. Copy public keys from .ssh backup into authorized_keys file in NUC .ssh folder.
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
# VLC
sudo apt install vlc -y
# GNOME Tweaks
sudo apt install gnome-tweaks -y
# Caffiene
sudo apt install caffeine -y
# Syncthing
curl -s https://syncthing.net/release-key.txt | sudo apt-key add -
echo "deb https://apt.syncthing.net/ syncthing stable" | sudo tee /etc/apt/sources.list.d/syncthing.list
sudo apt-get update
sudo apt-get install syncthing -y
# Node.js
curl -sL https://deb.nodesource.com/setup_14.x | sudo -E bash -
sudo apt-get install nodejs -y
# VeraCrypt
wget https://launchpad.net/veracrypt/trunk/1.24-update2/+download/veracrypt-1.24-Update2-Debian-10-amd64.deb -O veracrypt.deb > /dev/null 2>&1
sudo apt install ./veracrypt.deb -y
rm veracrypt.deb
# Exfat Support
sudo apt install exfat-fuse exfat-utils -y
```

## Step 4 - Syncthing Setup
echo 'Run "start" to mount the HDD and then setup Syncthing manually using its web GUI.