#!/bin/bash

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../variables.sh
if [ -z "$PS4SAVESBACKUPDIR" ] || [ -z "$PS4UNSORTEDMEDIADIR" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$PS4SAVESBACKUPDIR" ]; then
    echo "Some directories from ../variables.sh are missing!"
    exit
fi

echo "Insert the USB drive containing PS4 data (A 'PS4' directory containing 'SAVEDATA' and/or 'SHARE' directories)."
echo "Enter the mount point below (example /media/imranr/D6D9-9E3A) or leave empty to cancel:"
read mountpoint
if [ ! -z "$mountpoint" ]
then
    if [ -d "$mountpoint"/PS4/SAVEDATA ]; then
        if [ ! -d PS4SAVESBACKUPDIR ]; then
	        mkdir PS4SAVESBACKUPDIR
        fi
	    rsync -av "$mountpoint"/PS4/SAVEDATA PS4SAVESBACKUPDIR --delete
        echo "$(date)" > PS4SAVESBACKUPDIR/lastBackedUp.txt
    fi
    if [ -d "$mountpoint"/PS4/SHARE ]; then
        if [ ! -d "$PS4UNSORTEDMEDIADIR" ]; then
	        mkdir "$PS4UNSORTEDMEDIADIR"
        fi
	    rsync -av "$mountpoint"/PS4/SHARE "$PS4UNSORTEDMEDIADIR"
    fi
fi