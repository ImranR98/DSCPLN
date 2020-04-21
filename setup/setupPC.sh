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
# Uninstall Geary
sudo apt remove geary -y
# Arc-Menu dependency
sudo apt install gnome-shell-extensions gnome-menus gir1.2-gmenu-3.0 -y
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
# Other File copying
rsync -av "$BACKUPS"/.ssh/ ~/.ssh
rsync -av "$VMS"/ ~/vmware
rsync -av "$BACKUPS"/VariousHomeFiles/Templates/ ~/Templates
rsync -av "$BACKUPS"/VariousHomeFiles/themes/ ~/.themes
unzip "$BACKUPS"/VariousHomeFiles/icons.zip -d ~/.local/share/icons
rsync -av "$BACKUPS"/VariousHomeFiles/autostart/ ~/.config/autostart
unzip "$BACKUPS"/VariousHomeFiles/syncthing.zip -d ~/.config/syncthing
rsync -av "$BACKUPS"/VariousHomeFiles/rclone/ ~/.config/rclone
rsync -av "$BACKUPS"/VariousHomeFiles/gnome-shell-extensions/ ~/.local/share/gnome-shell/extensions
rsync -av "$BACKUPS"/VariousHomeFiles/DesktopFiles/ ~/.local/share/applications
cp "$BACKUPS"/VariousHomeFiles/.bashrc ~/
# Next Steps
echo 'Next steps:'
echo 'Get a better wallpaper.'
echo 'Enable and configure GNOME shell extensions.'
echo 'Change the GNOME theme (or skip this since STTS will do that after restart).'
echo 'Sign in to Firefox, Mailspring, and Thunderbird.'
echo 'Change the default search in Firefox, and add payment/address autofill by 
extensions.formautofill.available to on, extensions.formautofill.creditCards.available to true, 
and adding the right country code to extensions.formautofill.supportedCountries.'
echo 'Add keyboard shortcuts.'
echo 'Fix mouse scrolling.'
echo 'Fix terminal colors, and copy/paste shortcuts (also in VSCode terminal).'
echo 'Set git Username and email using git config --global user.name and git config --global user.email.'