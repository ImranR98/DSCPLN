#!/bin/bash
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../variables.sh
if [ -z "$PCBACKUPS" ] || [ -z "$PCHOME" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$PCBACKUPS" ] || [ ! -d "$PCHOME" ]; then
    echo "Some directories from ../variables.sh are missing!"
    exit
fi

echo "Firefox Bookmarks..."
FFFOLDER=$(ls "$PCHOME"/.mozilla/firefox | grep ".default-release$")
if [ ! -z "$FFFOLDER" ]; then
	if [ -f "$PCHOME"/.mozilla/firefox/"$FFFOLDER"/bookmarks.html ]; then
        cp -v "$PCHOME"/.mozilla/firefox/"$FFFOLDER"/bookmarks.html "$PCBACKUPS"
        echo '<!-- Backed up on '"$(date)"' -->' >> "$PCBACKUPS"/bookmarks.html
    else
        echo "No bookmarks.html found."
    fi
else
    echo "Firefox folder not found!"
fi

echo "SSH Folder..."
SSHFOLDER=$(ls -a "$PCHOME" | grep ".ssh$")
if [ ! -z "$SSHFOLDER" ]; then
    rsync -av "$PCHOME/.ssh/" "$PCBACKUPS/.ssh" --delete
    echo "$(date)" >"$PCBACKUPS"/.ssh/lastBackedUp.txt
else
    echo "SSH folder not found!"
fi

echo "Bashrc..."
cp -v ~/.bashrc "$PCBACKUPS"
echo '# Backed up on '"$(date)" >> "$PCBACKUPS"/.bashrc

echo "Startup Folder..."
if [ -d "$PCHOME/.config/autostart/" ]; then
    rsync -av "$PCHOME/.config/autostart/" "$PCBACKUPS/Startup" --delete
    echo "$(date)" >"$PCBACKUPS"/Startup/lastBackedUp.txt
else
    echo "Windows Startup folder not found!"
fi