#!/bin/bash
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../variables.sh

if [ -z "$PCBACKUPS" ] || [ -z "$CLOUDSSH" ] || [ -z "$CLOUDSSHPORT" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$PCBACKUPS" ]; then
    echo "Some directories from ../variables.sh are missing!"
    exit
fi

if [ ! -d "$PCBACKUPS"/'Cloud Systemctl Service Files' ]; then
	mkdir "$PCBACKUPS"/'Cloud Systemctl Service Files'
fi

rsync -av --port="$CLOUDSSHPORT" "$CLOUDSSH":/lib/systemd/system/imranr_* "$PCBACKUPS"/'Cloud Systemctl Service Files' --delete
echo "$(date)" > "$PCBACKUPS"/'Cloud Systemctl Service Files'/lastBackedUp.txt