# Setup a fresh install of a Pop!_OS on PC.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../variables.sh
if [ -z "$MAIN" ] || [ -z "$BACKUPS" ] || [ -z "$VMS" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$MAIN" ] || [ ! -d "$BACKUPS" ] || [ ! -d "$VMS" ]; then
    echo "Some directories from variables.sh are missing!"
    exit
fi
# Start Nautilus so config files are created (modified later)
nautilus &
# cryptsetup
sudo apt install cryptsetup -y
# htop
sudo apt install htop -y
# curl
sudo apt install curl -y
# git
sudo apt install git -y
# Visual Studio
sudo apt install code -y
# Thunderbird
sudo apt install thunderbird -y
# VLC
sudo apt install vlc -y
# QBittorrent
sudo apt install qbittorrent -y
# GNOME Tweaks
sudo apt install gnome-tweaks -y
# GIMP
sudo apt install gimp -y
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
# MailSpring
wget https://updates.getmailspring.com/download?platform=linuxDeb -O mailspring.deb > /dev/null 2>&1
sudo apt install ./mailspring.deb -y
rm mailspring.deb
# Chrome
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -O chrome.deb > /dev/null 2>&1
sudo apt install ./chrome.deb -y
rm chrome.deb
# TeamViewer
wget https://download.teamviewer.com/download/linux/teamviewer_amd64.deb -O teamviewer.deb > /dev/null 2>&1
sudo apt install ./teamviewer.deb -y
rm teamviewer.deb
# VeraCrypt
wget https://launchpad.net/veracrypt/trunk/1.24-update2/+download/veracrypt-1.24-Update2-Debian-10-amd64.deb -O veracrypt.deb > /dev/null 2>&1
sudo apt install ./veracrypt.deb -y
rm veracrypt.deb
# VMWare Player
wget https://download3.vmware.com/software/player/file/VMware-Player-15.5.1-15018445.x86_64.bundle -O vmplayer.bundle > /dev/null 2>&1
chmod 750 vmplayer.bundle
sudo ./vmplayer.bundle
rm vmplayer.bundle
# Postman
wget https://dl.pstmn.io/download/latest/linux64 -O postman.tar.gz > /dev/null 2>&1
tar -xvzf postman.tar.gz > /dev/null 2>&1
sudo mv ./Postman /opt
rm postman.tar.gz
# Android Studio
wget https://dl.google.com/dl/android/studio/ide-zips/3.5.3.0/android-studio-ide-191.6010548-linux.tar.gz -O androidstudio.tar.gz > /dev/null 2>&1
tar -xvzf androidstudio.tar.gz > /dev/null 2>&1
sudo mv ./android-studio /opt
rm androidstudio.tar.gz
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
# Preload
sudo apt install preload -y
# Uninstall Geary
sudo apt remove geary -y
# Arc-Menu dependency
sudo apt install gnome-shell-extensions gnome-menus gir1.2-gmenu-3.0 -y
# Clone and build Yaru theme
DIR="$(pwd)"
cd
git clone https://github.com/ubuntu/yaru.git
sudo apt install meson -y
sudo apt install sassc -y
cd yaru
meson "build" --prefix=/usr
sudo ninja -C "build" install
cd "$DIR"
# Change nautilus bookmarks
sed -i "s|HOME/Documents|HOME/Main|g" .config/user-dirs.dirs
sed -i "s|HOME/Pictures|HOME/Main/Pictures|g" .config/user-dirs.dirs
sed -i "s|XDG_MUSIC_DIR|# XDG_MUSIC_DIR|g" .config/user-dirs.dirs
sed -i "s|XDG_VIDEOS_DIR|# XDG_VIDEOS_DIR|g" .config/user-dirs.dirs
sudo sed -i "s|DOCUMENTS=Documents|DOCUMENTS=Main|g" /etc/xdg/user-dirs.defaults
sudo sed -i "s|PICTURES=Pictures|PICTURES=Main/Pictures|g" /etc/xdg/user-dirs.defaults
sudo sed -i "s|MUSIC=Music|# MUSIC=Music|g" /etc/xdg/user-dirs.defaults
sudo sed -i "s|VIDEOS=Videos|# VIDEOS=Videos|g" /etc/xdg/user-dirs.defaults
# Enable Firefox touch scrolling
echo "MOZ_USE_XINPUT2 DEFAULT=1" | sudo tee -a /etc/security/pam_env.conf
# comfortable-swipe
DIR="$(pwd)"
cd
sudo apt-get install git libinput-tools libxdo-dev g++
git clone https://github.com/Hikari9/comfortable-swipe.git --depth 1
cd comfortable-swipe
bash install
sudo gpasswd -a $USER $(ls -l /dev/input/event* | awk '{print $4}' | head --line=1)
cd "$DIR"
# Other File copying
rsync -av "$BACKUPS"/.ssh/ ~/.ssh
rsync -av "$VMS"/ ~/vmware
rsync -av "$BACKUPS"/VariousHomeFiles/Templates/ ~/Templates
rsync -av "$BACKUPS"/VariousHomeFiles/themes/ ~/.themes
unzip "$BACKUPS"/VariousHomeFiles/icons.zip -d ~/.local/share/icons
rsync -av "$BACKUPS"/VariousHomeFiles/autostart/ ~/.config/autostart
unzip "$BACKUPS"/VariousHomeFiles/syncthing.zip -d ~/.config/syncthing
rsync -av "$BACKUPS"/VariousHomeFiles/rclone/ ~/.config/rclone
rsync -av "$BACKUPS"/VariousHomeFiles/DesktopFiles/ ~/.local/share/applications
cp "$BACKUPS"/VariousHomeFiles/.bashrc ~/
cp "$BACKUPS"/VariousHomeFiles/comfortable-swipe.conf "$(comfortable-swipe config path)"
# Keyboard Shortcuts
gsettings set org.gnome.settings-daemon.plugins.media-keys calculator "['<Super>c']"
gsettings set org.gnome.settings-daemon.plugins.media-keys home "['<Super>b']"
gsettings set org.gnome.settings-daemon.plugins.media-keys terminal "['<Super>t']"
gsettings set org.gnome.settings-daemon.plugins.media-keys www "['<Super>f']"
gsettings set org.gnome.settings-daemon.plugins.media-keys custom-keybindings "['/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/']"
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/ name 'Sublime'
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/ command '/opt/sublime_text/sublime_text'
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/ binding '<Super>s'
# Background
if [ ! -d ~/.local/share/backgrounds ]; then
    mkdir ~/.local/share/backgrounds
fi
cp "$HERE"/res/BG.jpg ~/.local/share/backgrounds
gsettings set org.gnome.desktop.background picture-uri "file:///home/$(whoami)/.local/share/backgrounds/BG.jpg"
gsettings set org.gnome.desktop.screensaver picture-uri "file:///home/$(whoami)/.local/share/backgrounds/BG.jpg"
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
# Enable mouse movements while typing
gsettings set org.gnome.desktop.peripherals.touchpad disable-while-typing false
# Next Steps
echo 'Next steps:'
echo 'Change the default search in Firefox.'
echo 'Sign in to Firefox, Mailspring, and Thunderbird.'
echo 'Enable and configure GNOME shell extensions.'
echo 'Fix terminal colors, and copy/paste shortcuts (also in VSCode terminal).'
echo 'Log out and back in to enable comfortable-swipe.'