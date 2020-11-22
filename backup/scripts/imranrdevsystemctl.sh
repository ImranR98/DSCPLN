#!/bin/bash
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../variables.sh

if [ -z "$CLOUDSYSTEMCTLSERVICEFILESBACKUPDIR" ] || [ -z "$CLOUDSSH" ] || [ -z "$CLOUDSSHPORT" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$CLOUDSYSTEMCTLSERVICEFILESBACKUPDIR" ]; then
    echo "Some directories from ../variables.sh are missing!"
    exit
fi

if [ ! -d "$CLOUDSYSTEMCTLSERVICEFILESBACKUPDIR" ]; then
	mkdir "$CLOUDSYSTEMCTLSERVICEFILESBACKUPDIR"
fi

rsync -av --port="$CLOUDSSHPORT" "$CLOUDSSH":/lib/systemd/system/imranr_* "$CLOUDSYSTEMCTLSERVICEFILESBACKUPDIR" --delete
echo "$(date)" > "$CLOUDSYSTEMCTLSERVICEFILESBACKUPDIR"/lastBackedUp.txt