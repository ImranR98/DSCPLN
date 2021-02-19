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
sudo apt install firefox -y
sudo apt install chromium -y
sudo apt install com.github.davidmhewitt.clipped -y
sudo apt install baobab -y
sudo apt install gnome-disk-utility -y
sudo apt install gparted -y
sudo apt install krita -y
sudo apt install com.github.hezral.inspektor -y
sudo apt install libreoffice -y
sudo apt install com.github.bartzaalberg.snaptastic -y
sudo apt install vlc -y
sudo apt install com.github.davidmhewitt.torrential/bionic -y
sudo apt install evolution -y
sudo apt install pdfsam -y
flatpak install flathub org.onlyoffice.desktopeditors -y
flatpak install flathub com.getpostman.Postman -y
```

## Step 2 - Other
1. Restore the various files backed up by 'VariousFileCopying'.
4. Sign in to Firefox, Mailspring, and Evolution.
6. Change the default Firefox search.
7. Firefox Config changes:
```bash
FFFOLDER=$(ls ~/".mozilla/firefox" | grep ".default-release$")
touch ~/".mozilla/firefox"$FFFOLDER"/user.js"
echo 'user_pref("extensions.formautofill.available", "on");' >> ~/".mozilla/firefox"$FFFOLDER"/user.js"
echo 'user_pref("extensions.formautofill.creditCards.available", true);' >> ~/".mozilla/firefox"$FFFOLDER"/user.js"
echo 'user_pref("extensions.formautofill.supportedCountries", "US,CA");' >> ~/".mozilla/firefox"$FFFOLDER"/user.js"
echo 'user_pref("browser.bookmarks.autoExportHTML", true);' >> ~/".mozilla/firefox"$FFFOLDER"/user.js"
```
8. Tweak settings