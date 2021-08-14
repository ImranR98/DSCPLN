# PC Setup



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

flatpak install -y appcenter com.github.bluesabre.darkbar.Locale
flatpak install -y appcenter com.github.davidmhewitt.torrential
flatpak install -y appcenter com.github.donadigo.eddy
flatpak install -y appcenter com.github.manexim.insomnia

flatpak install -y flathub   com.getpostman.Postman
flatpak install -y flathub   com.github.xournalpp.xournalpp
flatpak install -y flathub   com.obsproject.Studio
flatpak install -y flathub   com.valvesoftware.Steam
flatpak install -y flathub   io.typora.Typora
flatpak install -y flathub   md.obsidian.Obsidian
flatpak install -y flathub   org.chromium.Chromium
flatpak install -y flathub   org.gnome.baobab
flatpak install -y flathub   org.gnome.eog
flatpak install -y flathub   org.libreoffice.LibreOffice
flatpak install -y flathub   org.mozilla.firefox
flatpak install -y flathub   org.shotcut.Shotcut
flatpak install -y flathub   org.videolan.VLC
```



## Step 2 - Change Hostname

```
sudo hostnamectl set-hostname ImranR-PC && # Will take effect after restart
sudo nano /etc/hosts # Replace all instances of previous hostname with new hostname
```



## Step 3 - Restore Backups

```
mkdir ~/Main &&
mkdir ~/vmware &&
rsync -rL --inplace /media/veracrypt1/Main/ ~/Main/ --exclude node_modules/ --delete &&
rsync -rL --inplace /media/veracrypt1/vmware/ ~/vmware/ --delete
```



## Step 4 - Manual App Installs

Haven't gotten around to automating these (or in some cases, I don't know how - read below).



### Debian (No PPA Available, Only `.deb` Files)

- PDFSam
- VSCode
- MailSpring
- Steam
- Sublime Text



### Manual Build From Source

As of August 2021, these are not available as as flatpaks, and need to be built from source:
- Clipped - This does not build, error needs to be debugged.
- Inspektor - This only builds if you uncomment the code in `Application.vala` that creates the `.desktop` shortcut.



### More

Exact method is specified.

- VMWare Player - install script



## Step 5 - Configuration

1. Restore `.ssh` folder and any other backed up system files.
2. Sign in to and configure Firefox, Mailspring, and OS (calendar).
3. Git configuration: `git config --global user.name 'Imran Remtulla'; git config --global user.email 'iremtulla15@gmail.com'`
4. Firefox config changes:
    ```bash
    FFFOLDER=$(ls ~/".mozilla/firefox" | grep ".default-release$")
    touch ~/".mozilla/firefox/"$FFFOLDER"/user.js"
    echo 'user_pref("extensions.formautofill.available", "on");' >> ~/".mozilla/firefox/"$FFFOLDER"/user.js"
    echo 'user_pref("extensions.formautofill.creditCards.available", true);' >> ~/".mozilla/firefox/"$FFFOLDER"/user.js"
    echo 'user_pref("extensions.formautofill.supportedCountries", "US,CA");' >> ~/".mozilla/firefox/"$FFFOLDER"/user.js"
    echo 'user_pref("browser.bookmarks.autoExportHTML", true);' >> ~/".mozilla/firefox/"$FFFOLDER"/user.js"
    ```
5. Tweak system settings as needed.
