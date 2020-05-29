#!/bin/bash
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../../variables.sh
if [ -z "$PCBACKUPS" ] || [ -z "$CLOUDSSH" ] || [ -z "$CLOUDSSHPORT" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$PCBACKUPS" ]; then
    echo "Some directories from ../variables.sh are missing!"
    exit
fi

if [ ! -d "$PCBACKUPS"/MarkD ]; then
	mkdir "$PCBACKUPS"/MarkD
fi

rsync -av --rsh='ssh -p '"$CLOUDSSHPORT" "$CLOUDSSH":/root/MarkD/userData/ "$PCBACKUPS"/MarkD --delete
echo "$(date)" > "$PCBACKUPS"/MarkD/lastBackedUp.txt