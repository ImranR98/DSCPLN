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
# Notify tools
sudo apt install libnotify-bin -y
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
# Inotify Tools
sudo apt install inotify-tools -y
# Arc-Menu dependency
sudo apt install gnome-shell-extensions gnome-menus gir1.2-gmenu-3.0 -y
# Enable Firefox touch scrolling
echo "MOZ_USE_XINPUT2 DEFAULT=1" | sudo tee -a /etc/security/pam_env.conf
# start.sh and variables
cp "$HERE"/res/start.sh ~
cp "$HERE"/../variables.sh ~
# Keyboard Shortcuts
gsettings set org.gnome.settings-daemon.plugins.media-keys calculator "['<Super>c']"
gsettings set org.gnome.settings-daemon.plugins.media-keys home "['<Super>b']"
gsettings set org.gnome.settings-daemon.plugins.media-keys terminal "['<Super>t']"
gsettings set org.gnome.settings-daemon.plugins.media-keys www "['<Super>f']"
gsettings set org.gnome.settings-daemon.plugins.media-keys custom-keybindings "['/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/']"
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/ name 'Sublime'
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/ command '/opt/sublime_text/sublime_text'
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/ binding '<Super>s'
# Firefox preferences
FFFOLDER=$(ls ~/.mozilla/firefox/ | grep ".default-release$")
if [ ! -z "$FFFOLDER" ]; then
    touch ~/.mozilla/firefox/"$FFFOLDER"/user.js
    echo 'user_pref("extensions.formautofill.available", "on");' >> ~/.mozilla/firefox/"$FFFOLDER"/user.js
    echo 'user_pref("extensions.formautofill.creditCards.available", true);' >> ~/.mozilla/firefox/"$FFFOLDER"/user.js
    echo 'user_pref("extensions.formautofill.supportedCountries", "US,CA");' >> ~/.mozilla/firefox/"$FFFOLDER"/user.js
    echo 'user_pref("browser.bookmarks.autoExportHTML", true);' >> ~/.mozilla/firefox/"$FFFOLDER"/user.js
else
    echo 'Firefox default folder was not found. You will have to make these changes to about:config manually:'
    echo 'Add payment/address autofill by 
    extensions.formautofill.available to on, extensions.formautofill.creditCards.available to true, 
    and adding the right country code to extensions.formautofill.supportedCountries.'
    echo 'Change browser.bookmarks.autoExportHTML to true.'
fi
# git
git config --global user.name 'Imran Remtulla'
git config --global user.email 'iremtulla15@gmail.com'
# Natural scrolling
gsettings set org.gnome.desktop.peripherals.touchpad natural-scroll true
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