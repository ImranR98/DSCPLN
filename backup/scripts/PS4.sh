#!/bin/bash

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../../variables.sh
if [ -z "$PCBACKUPS" ] || [ -z "$PCPICTURES" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$PCBACKUPS" ] || [ ! -d "$PCPICTURES" ]; then
    echo "Some directories from ../variables.sh are missing!"
    exit
fi

echo "Insert the USB drive containing PS4 data (A 'PS4' directory containing 'SAVEDATA' and/or 'SHARE' directories)."
echo "Enter the mount point below (example /media/imranr/D6D9-9E3A) or leave empty to cancel:"
read mountpoint
if [ ! -z "$mountpoint" ]
then
    if [ -d "$mountpoint"/PS4/SAVEDATA ]; then
        if [ ! -d "$PCBACKUPS"/PS4Saves ]; then
	        mkdir "$PCBACKUPS"/PS4Saves
        fi
	    rsync -av "$mountpoint"/PS4/SAVEDATA "$PCBACKUPS"/PS4Saves --delete
        echo "$(date)" > "$PCBACKUPS"/PS4Saves/lastBackedUp.txt
    fi
    if [ -d "$mountpoint"/PS4/SHARE ]; then
        if [ ! -d "$PCPICTURES"/Unsorted-PS4Media ]; then
	        mkdir "$PCPICTURES"/Unsorted-PS4Media
        fi
	    rsync -av "$mountpoint"/PS4/SHARE "$PCPICTURES"/Unsorted-PS4Media
    fi
fi