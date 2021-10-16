# PC Setup



## Step 0 - Setup Flatpak & Change Hostname
```
sudo apt install flatpak -y
sudo apt install gnome-software-plugin-flatpak
flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
sudo hostnamectl set-hostname ImranR-PC && # Will take effect after restart
sudo nano /etc/hosts # Replace all instances of previous hostname with new hostname
sudo reboot
```



## Step 1 - Automated App Installs

```
sudo apt install software-properties-common curl -y

sudo add-apt-repository ppa:unit193/encryption &&
sudo apt install veracrypt -y

sudo add-apt-repository ppa:git-core/ppa &&
sudo apt install git -y

curl -sL https://deb.nodesource.com/setup_16.x | sudo -E bash &&
sudo apt install nodejs -y &&
sudo npm i -g npm-check-updates

sudo apt install restic -y &&
sudo restic self-update # Version from the distro's official repo is normally out of date

sudo apt install libimage-exiftool-perl -y

flatpak install -y flathub   com.getpostman.Postman
flatpak install -y flathub   com.github.xournalpp.xournalpp
flatpak install -y flathub   com.obsproject.Studio
flatpak install -y flathub   com.valvesoftware.Steam
flatpak install -y flathub   io.typora.Typora
flatpak install -y flathub   md.obsidian.Obsidian
flatpak install -y flathub   org.gnome.baobab
flatpak install -y flathub   org.gnome.eog
flatpak install -y flathub   org.libreoffice.LibreOffice
sudo apt remove firefox -y
flatpak install -y flathub   org.mozilla.firefox
flatpak install -y flathub   org.shotcut.Shotcut
flatpak install -y flathub   org.videolan.VLC
flatpak install -y flathub   com.valvesoftware.Steam
flatpak install -y flathub   com.sublimetext.three
flatpak install -y flathub   com.visualstudio.code
flatpak install -y flathub   org.qbittorrent.qBittorrent
```



## Step 3 - Restore Backups

```
mkdir ~/Main &&
mkdir ~/vmware &&
rsync -rL /media/veracrypt1/Main/ ~/Main/ --exclude node_modules/ &&
rsync -rL /media/veracrypt1/vmware/ ~/vmware/ --delete
```



## Step 4 - Manual App Installs

Haven't gotten around to automating these (or in some cases, I don't know how - read below).

- Mullvad VPN
- PDFSam
- MailSpring
- VMWare Player
- EteSync DAV Bridge (https://github.com/etesync/etesync-dav/releases and https://github.com/etesync/etesync-dav/blob/master/README.md#installation)



## Step 5 - Configuration

1. Restore `.ssh` folder and any other backed up system files.
2. Sign in to Mailspring and Ryerson Account (on OS).
3. Install Dark Reader, Bitwarden, xBrowserSync, and uBlock Origin on Firefox.
4. Setup EteSync.
5. Git configuration: `git config --global user.name 'Imran Remtulla'; git config --global user.email 'iremtulla15@gmail.com'`
6. Install and setup GSConnect, Clipboard Manager, and other shell extensions.