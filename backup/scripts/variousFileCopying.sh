#!/bin/bash
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../../variables.sh
if [ -z "$PCBACKUPS" ] || [ -z "$WINDOWSHOME" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$PCBACKUPS" ] || [ ! -d "$WINDOWSHOME" ]; then
    echo "Some directories from ../variables.sh are missing!"
    exit
fi

echo "Firefox Bookmarks..."
FFFOLDER=$(ls /mnt/c/Users/ImranR/AppData/Roaming/Mozilla/Firefox/Profiles | grep ".default-release$")
if [ ! -z "$FFFOLDER" ]; then
	if [ -f /mnt/c/Users/ImranR/AppData/Roaming/Mozilla/Firefox/Profiles/"$FFFOLDER"/bookmarks.html ]; then
        cp -v /mnt/c/Users/ImranR/AppData/Roaming/Mozilla/Firefox/Profiles/"$FFFOLDER"/bookmarks.html "$PCBACKUPS"
        echo '<!-- Backed up on '"$(date)"' -->' >> "$PCBACKUPS"/bookmarks.html
    else
        echo "No bookmarks.html found."
    fi
else
    echo "Firefox folder not found!"
fi

echo "SSH Folder..."
SSHFOLDER=$(ls -a "$WINDOWSHOME" | grep ".ssh$")
if [ ! -z "$SSHFOLDER" ]; then
    rsync -av "$WINDOWSHOME/.ssh/" "$PCBACKUPS/.ssh" --delete
    echo "$(date)" >"$PCBACKUPS"/.ssh/lastBackedUp.txt
else
    echo "SSH folder not found!"
fi

echo "WSL Bashrc..."
cp -v ~/.bashrc "$PCBACKUPS"
echo '# Backed up on '"$(date)" >> "$PCBACKUPS"/.bashrc

echo "Manual Windows Apps..."
if [ -d "$WINDOWSMANUALAPPS" ]; then
    rsync -av "$WINDOWSMANUALAPPS/" "$PCBACKUPS/ManualApps" --delete --exclude='node_modules'
    echo "$(date)" >"$PCBACKUPS"/ManualApps/lastBackedUp.txt
else
    echo "Windows Manual Apps folder not found!"
fi

echo "Windows Startup Folder..."
if [ -d "$WINDOWSHOME/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup/" ]; then
    rsync -av "$WINDOWSHOME/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup/" "$PCBACKUPS/Startup" --delete
    echo "$(date)" >"$PCBACKUPS"/Startup/lastBackedUp.txt
else
    echo "Windows Startup folder not found!"
fi