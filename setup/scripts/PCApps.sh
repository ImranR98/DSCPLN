# Apps to install specifically on PC

# Visual Studio
sudo apt install code -y
# Thunderbird
sudo apt install thunderbird -y
# QBittorrent
sudo apt install qbittorrent -y
# GIMP
sudo apt install gimp -y
# GParted
sudo apt install gparted -y
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
# VMWare Player
wget https://download3.vmware.com/software/player/file/VMware-Player-15.5.5-16285975.x86_64.bundle -O vmplayer.bundle > /dev/null 2>&1
chmod u+x vmplayer.bundle
sudo ./vmplayer.bundle
rm vmplayer.bundle
# Postman
wget https://dl.pstmn.io/download/latest/linux64 -O postman.tar.gz > /dev/null 2>&1
tar -xvzf postman.tar.gz > /dev/null 2>&1
sudo mv ./Postman /opt
rm postman.tar.gz
# Uninstall Geary
sudo apt remove geary -y
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