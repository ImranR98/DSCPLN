# PC Setup
> TODO: Update
## STEP 1 - Enable Chocolatey
Run in CMD as ADMIN:
```powershell
@"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -InputFormat None -ExecutionPolicy Bypass -Command " [System.Net.ServicePointManager]::SecurityProtocol = 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://chocolatey.org/install.ps1'))" && SET "PATH=%PATH%;%ALLUSERSPROFILE%\chocolatey\bin"
```

## Step 2 - Install Windows Apps
Run in PowerShell as admin:
```powershell
choco install nodejs -y
choco install pgadmin4 -y
choco install postman -y
choco install vmware-workstation-player -y
choco install teamviewer9 -y
choco install mailspring -y
choco install vscode -y
choco install autohotkey -y
choco install microsoft-windows-terminal -y
choco install veracrypt -y
choco install sublimetext3 -y
choco install syncthing-gtk -y
choco install syncthing -y
choco install chromium -y
choco install office365business -y
choco install auto-dark-mode -y
choco install flutter -y
choco install androidstudio -y
choco install firefox -y
choco install searchwithmybrowser -y
choco install git -y
choco install visualstudio2019community -y
npm i -g npm-check-updates
```

## Step 3 - Setup Git
Run in PowerShell:
```powershell
git config --global user.name 'Imran Remtulla'
git config --global user.email 'iremtulla15@gmail.com'
git config --global core.autocrlf false
```

## Step 4 - Enable WSL
1. Run in PowerShell:
```powershell
dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
```
2. Restart
3. Download and run https://wslstorestorage.blob.core.windows.net/wslblob/wsl_update_x64.msi.
4. Run `wsl --set-default-version 2` in PowerShell.
5. Install Ubuntu from MS Store

## Step 5 - Setup WSL
1. Open WSL shell and finish setup.
2. Run in WSL shell:
```bash
git config --global user.name 'Imran Remtulla'
git config --global user.email 'iremtulla15@gmail.com'
curl -sL https://deb.nodesource.com/setup_14.x | sudo -E bash -
sudo apt install nodejs -y
sudo npm i -g npm-check-updates
```

## Step 6 - Other
1. Copy .ssh folder into the home directory.
2. Copy .bashrc into WSL home.
3. Uninstall Windows bloatware.
4. Sign in to Firefox, Mailspring, and Office.
5. Install Creative Cloud + Photoshop + Acrobat, then disable all of CC's startup processes.
6. Change the default Firefox search.
7. Firefox Config changes - run in a WSL shell:
```bash
FFFOLDER=$(ls /mnt/c/Users/ImranR/AppData/Roaming/Mozilla/Firefox/Profiles | grep ".default-release$")
touch /mnt/c/Users/ImranR/AppData/Roaming/Mozilla/Firefox/Profiles/"$FFFOLDER"/user.js
echo 'user_pref("extensions.formautofill.available", "on");' >> /mnt/c/Users/ImranR/AppData/Roaming/Mozilla/Firefox/Profiles/"$FFFOLDER"/user.js
echo 'user_pref("extensions.formautofill.creditCards.available", true);' >> /mnt/c/Users/ImranR/AppData/Roaming/Mozilla/Firefox/Profiles/"$FFFOLDER"/user.js
echo 'user_pref("extensions.formautofill.supportedCountries", "US,CA");' >> /mnt/c/Users/ImranR/AppData/Roaming/Mozilla/Firefox/Profiles/"$FFFOLDER"/user.js
echo 'user_pref("browser.bookmarks.autoExportHTML", true);' >> /mnt/c/Users/ImranR/AppData/Roaming/Mozilla/Firefox/Profiles/"$FFFOLDER"/user.js
```
8. Double click the .deskpack theme backup file to change the Windows theme.
9. Change default Apps.

## Step 7 - Encryption
Open VeraCrypt and encrypt the system disk.