#!/bin/bash

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../../variables.sh
if [ -z "$BACKUPS" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$BACKUPS" ]; then
    echo "Some directories from variables.sh are missing!"
    exit
fi

echo "Add USB drive containing PS4 Save data."
echo "Enter the mount point below (example /media/imranr/D6D9-9E3A) or leave empty to cancel:"
read mountpoint
if [ ! -z "$mountpoint" ]
then
    if [ ! -d "$BACKUPS"/PS4Saves ]; then
	    mkdir "$BACKUPS"/PS4Saves
    fi
    rsync -av "$mountpoint"/PS4/ "$BACKUPS"/PS4Saves --delete
    echo "$(date)" > "$BACKUPS"/PS4Saves/lastBackedUp.txt
fi