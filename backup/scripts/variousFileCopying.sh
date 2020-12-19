#!/bin/bash
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../variables.sh
if [ -z "$BACKUPSDIR" ] || [ -z "$SSHDIR" ] || [ -z "$FIREFOXCONFIGDIR" ] || [ -z "$SSHBACKUPDIR" ] || [ -z "$STARTUPBACKUPDIR" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$BACKUPSDIR" ] || [ ! -d "$SSHDIR" ] || [ ! -d "$FIREFOXCONFIGDIR" ]; then
    echo "Some directories from ../variables.sh are missing!"
    exit
fi

echo "Firefox Bookmarks..."
FFFOLDER=$(ls "$FIREFOXCONFIGDIR" | grep ".default-release$")
if [ ! -z "$FFFOLDER" ]; then
	if [ -f "$FIREFOXCONFIGDIR"/"$FFFOLDER"/bookmarks.html ]; then
        cp -v "$FIREFOXCONFIGDIR"/"$FFFOLDER"/bookmarks.html "$BACKUPSDIR"
        echo '<!-- Backed up on '"$(date)"' -->' >> "$BACKUPSDIR"/bookmarks.html
    else
        echo "No bookmarks.html found."
    fi
else
    echo "Firefox folder not found!"
fi

echo "SSH Folder..."
if [ ! -d "$SSHBACKUPDIR" ]; then
    mkdir "$SSHBACKUPDIR"
fi;
rsync -av "$SSHDIR/" "$SSHBACKUPDIR" --delete
echo "$(date)" > "$SSHBACKUPDIR"/lastBackedUp.txt

echo "Startup Folder..."
if [ ! -d "$STARTUPBACKUPDIR" ]; then
    mkdir "$STARTUPBACKUPDIR"
fi;
rsync -av "$STARTUPDIR/" "$STARTUPBACKUPDIR" --delete
echo "$(date)" > "$STARTUPBACKUPDIR"/lastBackedUp.txt

echo "Bashrc..."
cp -v ~/.bashrc "$BACKUPSDIR"
echo '# Backed up on '"$(date)" >> "$BACKUPSDIR"/.bashrc