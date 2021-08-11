# PC Setup



## Step 1 - Automated Command Line Package Installs

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



## Step 4 - Install Apps

Haven't gotten around to automating these (or in some cases, I don't know how - read below).



### Flatpak

Some of these are from Elementary AppCenter, the rest are from Flathub. In general, always go for Flatpak if the version is provided (or at least recommended) by the developer (so not things like Steam or Visual Studio Code).

Not sure if doing the Flathub installs via command line would mess with the Elementary OS AppCenter (as in updates showing up). Also, don't know how to do AppCenter installs through the terminal.

- Firefox
- Chromium
- Disk Usage Analyzer
- Xournal++
- LibreOffice
- VLC
- Torrential
- Postman
- Insomnia
- Obsidian
- OBS Studio
- Typora

These are no longer provided on Elementary OS 6.0 Odin as of August 11 2021, but this may change in the future; Some (specified) can be built manually:

- ~~Clipped~~
- ~~Inspektor~~
- ~~Monitor~~
- ~~Insomnia~~ - can be built manually.



### Debian (No PPA Available, Only `.deb` Files)

- PDFSam
- VSCode
- MailSpring
- Steam
- Sublime Text



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
