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
else
    echo "SSH folder not found!"
fi

echo "WSL Bashrc..."
cp -v ~/.bashrc "$PCBACKUPS"