### APPS
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
# SSH, fail2ban, and ufw
sudo apt install openssh-server -y
sudo apt install fail2ban -y
sudo apt install ufw -y
sudo ufw allow OpenSSH
sudo ufw enable
# Allow KDE Connect ports
sudo ufw allow 1714:1764/udp
sudo ufw allow 1714:1764/tcp
# Duplicati
wget https://updates.duplicati.com/beta/duplicati_2.0.5.1-1_all.deb -O duplicati.deb ? /dev/null 2>&1
sudo dpkg -i duplicati.deb
rm duplicati.deb
sudo apt --fix-broken install




### PREP. SCRIPTS
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

source "$HERE"../variables.sh
if [ -z "$NUCHDDMOUNT" ] || [ -z "$NUCHDDUUID" ] || [ -z "$NUCBACKUPS" ] || [ -z "$NUCPICTURES" ]; then
    echo "Some environment variables are missing!"
    exit
fi
BASHRCAPPEND="# Warn if /Main doesn't exist
RED=\"\033[0;31m\"
NC=\"\033[0m\"
if [ ! -d \"$NUCHDDMOUNT\"/Main ]; then
echo -e \"\n\${RED}WARNING: \${NC}Main not found. Was start.sh run?\"
fi
# Alias
alias start=~/start.sh
alias showssh=\"sudo netstat -tnpa | grep \\\"ESTABLISHED.*sshd\\\"\""
echo "$BASHRCAPPEND" >> ~/.bashrc
STARTSH="HERE=\"\$(cd \"\$(dirname \"\${BASH_SOURCE[0]}\")\" >/dev/null 2>&1 && pwd)\"
if [ ! -d \"$NUCHDDMOUNT\" ]; then
	sudo mkdir \"$NUCHDDMOUNT\"
fi
sudo cryptsetup luksOpen UUID=\"$NUCHDDUUID\" hdd
sudo mount /dev/mapper/hdd \"$NUCHDDMOUNT\"
if [ ! -d \"$NUCBACKUPS\" ] || [ ! -d \"$NUCPICTURES\" ]; then
    echo \"Some directories from variables.sh are missing!\"
    exit
fi
syncthing &
duplicati-server &"
echo "$STARTSH" > ~/start.sh
chmod u+x ~/start.showssh




### UI TWEAKS
# Add Close and Minimize buttons
gsettings set org.gnome.desktop.wm.preferences button-layout ":minimize,maximize,close"
# Show date and weekday in clock
gsettings set org.gnome.desktop.interface clock-show-weekday true
gsettings set org.gnome.desktop.interface clock-show-date true
# Show battery percentage in taskbar
gsettings set org.gnome.desktop.interface show-battery-percentage true
# Disable middle click paste
gsettings set org.gnome.desktop.interface gtk-enable-primary-paste false
# Enable hot corner
gsettings set org.gnome.desktop.interface enable-hot-corners true
# Natural scrolling
gsettings set org.gnome.desktop.peripherals.touchpad natural-scroll true




### NEXT STEPS
echo 'Run "start" to mount the HDD and then setup Syncthing and Duplicati manually from their respective web GUIs.'
echo 'Manually install and setup KDE-Connect.'