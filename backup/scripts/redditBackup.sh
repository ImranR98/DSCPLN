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

if [ ! -d "$BACKUPS"/Reddit ]; then
    mkdir "$BACKUPS"/Reddit
fi
if [ ! -d "$BACKUPS"/Reddit/Oldest ]; then
    mkdir "$BACKUPS"/Reddit/Oldest
fi
if [ ! -d "$BACKUPS"/Reddit/Latest ]; then
    mkdir "$BACKUPS"/Reddit/Latest
fi
cd "$HERE"/dydr
node access.js # Making sure access is available
node backup.js "$BACKUPS"/Reddit # Running backup
cd ..
echo "$(date)" >"$BACKUPS"/Reddit/lastBackedUp.txt
