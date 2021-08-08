# PC Setup

## Step 1 - Copy all Files from Backup into ~/Main, ~/Drop, and ~/TV
This.

## Step 2 - Configure Git
`git config --global user.name 'Imran Remtulla'; git config --global user.email 'iremtulla15@gmail.com'`

## Step 3 - Install Node.js
```bash
curl -sL https://deb.nodesource.com/setup_15.x | sudo -E bash - // May want to use newer version than 15.x
sudo npm i -g npm-check-updates
```

## Step 4 - Install Apps
Manually, not part of `apt` script, because I'd prefer using Flatpak versions if possible. Will automate at some point.
- Restic
- Rsync (if not preinstalled)
- Htop
- Firefox
- Chromium
- Clipped
- Disk Usage Analyzer
- GNOME Disks (or similar)
- Xournal++
- Inspektor
- Exiftool
- LibreOffice
- VLC
- Torrential
- PDFSam
- Postman
- VSCode
- Insomnia
- MailSpring
- Obsidian
- OBS Studio
- Steam + Rocket League
- Sublime Text
- Typora
- VeraCrypt
- VMWare Player

## Step 5 - Other

1. Restore the various files backed up by 'VariousFileCopying'.
2. Sign in to and configure Firefox, Mailspring, and OS (calendar).
4. Firefox Config changes:
```bash
FFFOLDER=$(ls ~/".mozilla/firefox" | grep ".default-release$")
touch ~/".mozilla/firefox/"$FFFOLDER"/user.js"
echo 'user_pref("extensions.formautofill.available", "on");' >> ~/".mozilla/firefox/"$FFFOLDER"/user.js"
echo 'user_pref("extensions.formautofill.creditCards.available", true);' >> ~/".mozilla/firefox/"$FFFOLDER"/user.js"
echo 'user_pref("extensions.formautofill.supportedCountries", "US,CA");' >> ~/".mozilla/firefox/"$FFFOLDER"/user.js"
echo 'user_pref("browser.bookmarks.autoExportHTML", true);' >> ~/".mozilla/firefox/"$FFFOLDER"/user.js"
```
5. Tweak settings
