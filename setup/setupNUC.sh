# Setup a fresh install of Ubuntu on NUC.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../variables.sh
if [ -z "$HDDMOUNT" ]; then
    echo "Some environment variables are missing!"
    exit
fi

# cryptsetup
sudo apt install cryptsetup -y
# htop
sudo apt install htop -y
# curl
sudo apt install curl -y
# git
sudo apt install git -y
# SSH and fail2ban
sudo apt install openssh-server -y
sudo apt install fail2ban -y
# GNOME Tweaks
sudo apt install gnome-tweaks -y
# GParted
sudo apt install gparted -y
# Caffiene
sudo apt install caffeine -y
# Syncthing
curl -s https://syncthing.net/release-key.txt | sudo apt-key add -
echo "deb https://apt.syncthing.net/ syncthing stable" | sudo tee /etc/apt/sources.list.d/syncthing.list
sudo apt-get update
sudo apt-get install syncthing
# Docker
sudo apt-get remove docker docker-engine docker.io containerd runc
sudo apt-get update
sudo apt-get install apt-transport-https ca-certificates curl gnupg-agent software-properties-common -y
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo apt-key add -
sudo add-apt-repository "deb [arch=amd64] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable"
sudo apt-get update
sudo apt-get install docker-ce docker-ce-cli containerd.io -y
# Jellyfin (on Docker)
sudo docker pull jellyfin/jellyfin
# Sublime Text
wget -qO - https://download.sublimetext.com/sublimehq-pub.gpg | sudo apt-key add -  > /dev/null 2>&1
sudo apt install apt-transport-https -y
echo "deb https://download.sublimetext.com/ apt/stable/" | sudo tee /etc/apt/sources.list.d/sublime-text.list
sudo apt update > /dev/null 2>&1
sudo apt install sublime-text -y
# Node.js
curl -sL https://deb.nodesource.com/setup_13.x | sudo -E bash -
sudo apt-get install -y nodejs
# VeraCrypt
wget https://launchpad.net/veracrypt/trunk/1.24-update2/+download/veracrypt-1.24-Update2-Debian-10-amd64.deb -O veracrypt.deb > /dev/null 2>&1
sudo apt install ./veracrypt.deb -y
rm veracrypt.deb
# VMWare Player
wget https://download3.vmware.com/software/player/file/VMware-Player-15.5.1-15018445.x86_64.bundle -O vmplayer.bundle > /dev/null 2>&1
chmod 750 vmplayer.bundle
sudo ./vmplayer.bundle
rm vmplayer.bundle
# Duplicati
wget https://updates.duplicati.com/beta/duplicati_2.0.5.1-1_all.deb -O duplicati.deb ? /dev/null 2>&1
sudo dpkg -i duplicati.deb
rm duplicati.deb
sudo apt --fix-broken install
# Add Close and Minimize buttons
gsettings set org.gnome.desktop.wm.preferences button-layout ":minimize,maximize,close"
# Show date and weekday in clock
gsettings set org.gnome.desktop.interface clock-show-weekday true
gsettings set org.gnome.desktop.interface clock-show-date true
# Show battery percentage in taskbar
gsettings set org.gnome.desktop.interface show-battery-percentage true
# Tweaking Firefox .desktop file to enable touch scrolling
sudo sed -i "s|Exec=|Exec=env MOZ_USE_XINPUT2=1 |g" /usr/share/applications/firefox.desktop
# Exfat Support
sudo apt install exfat-fuse exfat-utils -y
# Gnome Shell host connector
sudo apt install chrome-gnome-shell -y
# Arc-Menu dependency
sudo apt install gnome-shell-extensions gnome-menus gir1.2-gmenu-3.0 -y
# Enable Firefox touch scrolling
echo "MOZ_USE_XINPUT2 DEFAULT=1" | sudo tee -a /etc/security/pam_env.conf
# NextCloud
sudo snap install nextcloud
# start.sh and variables
cp "$HERE"/res/start.sh ~
cp "$HERE"/../variables.sh ~
# calcardbackup
git clone https://codeberg.org/BernieO/calcardbackup.git
# .bashrc
echo '# Warn if '"$HDDMOUNT"'/Main doesn'"'"'t exist' >> ~/.bashrc
echo 'RED="\033[0;31m"' >> ~/.bashrc
echo 'NC="\033[0m"' >> ~/.bashrc
echo 'if [ ! -d '"$HDDMOUNT"'/Main ]; then' >> ~/.bashrc
echo '	echo -e "\n${RED}WARNING: ${NC}Main not found. Was start.sh run?"' >> ~/.bashrc
echo 'fi' >> ~/.bashrc
echo '# Alias' >> ~/.bashrc
echo 'alias start=~/start.sh' >> ~/.bashrc
# Next Steps
echo 'Next steps:'
echo 'Prepare the NextCloud backup (extract it from the .tar, move it into /var/snap/nextcloud/common, and make sure it belongs to root (sudo chown -R root:root).'
echo 'Run sudo nextcloud.import with the directory prepared above, then delete it.'
echo 'Run "sudo nextcloud.enable-https lets-encrypt" to setup https for NextCloud (assuming port forwarding and domain is already setup).'
echo 'If the domain is not setup, you may need "sudo snap run nextcloud.occ config:system:set trusted_domains 1 --value=your.fancy.domain" during setup.'
echo 'Next, run "start" to mount the HDD and then setup Syncthing and Duplicati manually from their respective web GUIs.'
echo 'Make sure to sudo nextcloud.import /backup/dir when ready. You might need to sudo chown -R root:root /backup/dir, and move it into /var/snap/nextcloud/common, first (delete after done).'