# Common apps to install

# htop
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
# Atom
wget 'https://atom-installer.github.com/v1.48.0/atom-amd64.deb' -O atom.deb > /dev/null 2>&1
sudo apt install ./atom.deb -y
rm atom.deb
# Node.js
curl -sL https://deb.nodesource.com/setup_14.x | sudo -E bash -
sudo apt-get install nodejs -y
# VeraCrypt
wget https://launchpad.net/veracrypt/trunk/1.24-update2/+download/veracrypt-1.24-Update2-Debian-10-amd64.deb -O veracrypt.deb > /dev/null 2>&1
sudo apt install ./veracrypt.deb -y
rm veracrypt.deb
# Exfat Support
sudo apt install exfat-fuse exfat-utils -y
# Gnome Shell host connector
sudo apt install chrome-gnome-shell -y
# Inotify Tools
sudo apt install inotify-tools -y
# Preload
sudo apt install preload -y
# Arc-Menu dependency
sudo apt install gnome-shell-extensions gnome-menus gir1.2-gmenu-3.0 -y
# comfortable-swipe
DIR="$(pwd)"
cd
sudo apt-get install git libinput-tools libxdo-dev libinih-dev g++ -y
git clone https://github.com/Hikari9/comfortable-swipe.git --depth 1
cd comfortable-swipe
bash install
sudo gpasswd -a $USER $(ls -l /dev/input/event* | awk '{print $4}' | head --line=1)
cd "$DIR"