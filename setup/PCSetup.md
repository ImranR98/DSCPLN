# PC Setup

## Step 1 - Install Apps
Run with `sudo`:
```bash
git config --global user.name 'Imran Remtulla'
git config --global user.email 'iremtulla15@gmail.com'
curl -sL https://deb.nodesource.com/setup_15.x | sudo -E bash -
sudo apt install nodejs -y
sudo npm i -g npm-check-updates
sudo snap install restic -y
sudo apt install htop -y
```

Install the following from the AppCentre:
1. Firefox
2. Chromium
3. Clipped
4. Disk Usage Analyzer
5. Evolution
6. GNOME Disks
7. Gparted
8. Krita
9. Inspektor
10. LibreOffice
11. OnlyOffice
12. PDFSam Basic
13. Postman
14. Snaptastic
15. VLC
16. Torrential

## Step 2 - Other
1. Restore the various files backed up by 'VariousFileCopying'.
4. Sign in to Firefox, Mailspring, and Evolution.
6. Change the default Firefox search.
7. Firefox Config changes:
```bash
FFFOLDER=$(ls "~/.mozilla/firefox" | grep ".default-release$")
touch ~/.mozilla/firefox"$FFFOLDER"/user.js
echo 'user_pref("extensions.formautofill.available", "on");' >> ~/.mozilla/firefox"$FFFOLDER"/user.js
echo 'user_pref("extensions.formautofill.creditCards.available", true);' >> ~/.mozilla/firefox"$FFFOLDER"/user.js
echo 'user_pref("extensions.formautofill.supportedCountries", "US,CA");' >> ~/.mozilla/firefox"$FFFOLDER"/user.js
echo 'user_pref("browser.bookmarks.autoExportHTML", true);' >> ~/.mozilla/firefox"$FFFOLDER"/user.js
```
8. Tweak settings