#!/bin/bash
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../../variables.sh
if [ -z "$BACKUPS" ] || [ -z "$CLOUDSSH" ] || [ -z "$CLOUDSSHPORT" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$BACKUPS" ]; then
    echo "Some directories from variables.sh are missing!"
    exit
fi

if [ ! -d "$BACKUPS"/Notes ]; then
	mkdir "$BACKUPS"/Notes
fi

rsync -av --rsh='ssh -p '"$CLOUDSSHPORT" "$CLOUDSSH":/root/MarkD/userData/ "$BACKUPS"/Notes --delete
echo "$(date)" > "$BACKUPS"/Notes/lastBackedUp.txt