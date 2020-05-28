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
# Syncthing
curl -s https://syncthing.net/release-key.txt | sudo apt-key add -
echo "deb https://apt.syncthing.net/ syncthing stable" | sudo tee /etc/apt/sources.list.d/syncthing.list
sudo apt-get update
sudo apt-get install syncthing
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
# Duplicati
wget https://updates.duplicati.com/beta/duplicati_2.0.5.1-1_all.deb -O duplicati.deb ? /dev/null 2>&1
sudo dpkg -i duplicati.deb
rm duplicati.deb
sudo apt --fix-broken install
# TigerVNC
sudo apt install tigervnc-standalone-server tigervnc-xorg-extension tigervnc-viewer -y
# Add Close and Minimize buttons
gsettings set org.gnome.desktop.wm.preferences button-layout ":minimize,maximize,close"
# Show date and weekday in clock
gsettings set org.gnome.desktop.interface clock-show-weekday true
gsettings set org.gnome.desktop.interface clock-show-date true
# Show battery percentage in taskbar
gsettings set org.gnome.desktop.interface show-battery-percentage true
# start.sh and variables
cp "$HERE"/res/start.sh ~
cp "$HERE"/../variables.sh ~
# Natural scrolling
gsettings set org.gnome.desktop.peripherals.touchpad natural-scroll true
# Enable mouse movements while typing
gsettings set org.gnome.desktop.peripherals.touchpad disable-while-typing false
# .bashrc
echo '# Warn if '"$HDDMOUNT"'/Main doesn'"'"'t exist' >> ~/.bashrc
echo 'RED="\033[0;31m"' >> ~/.bashrc
echo 'NC="\033[0m"' >> ~/.bashrc
echo 'if [ ! -d '"$HDDMOUNT"'/Main ]; then' >> ~/.bashrc
echo '	echo -e "\n${RED}WARNING: ${NC}Main not found. Was start.sh run?"' >> ~/.bashrc
echo 'fi' >> ~/.bashrc
echo '# Alias' >> ~/.bashrc
echo 'alias start=~/start.sh' >> ~/.bashrc
echo 'alias showssh="sudo netstat -tnpa | grep \"ESTABLISHED.*sshd\""' >> ~/.bashrc
# Next Steps
echo 'Next steps:'
echo 'Next, run "start" to mount the HDD and then setup Syncthing and Duplicati manually from their respective web GUIs.'