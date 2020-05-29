#!/bin/bash

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../../variables.sh
if [ -z "$PCBACKUPS" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$PCBACKUPS" ]; then
    echo "Some directories from ../variables.sh are missing!"
    exit
fi

if [ ! -d "$PCBACKUPS"/Reddit ]; then
    mkdir "$PCBACKUPS"/Reddit
fi
if [ ! -d "$PCBACKUPS"/Reddit/Oldest ]; then
    mkdir "$PCBACKUPS"/Reddit/Oldest
fi
if [ ! -d "$PCBACKUPS"/Reddit/Latest ]; then
    mkdir "$PCBACKUPS"/Reddit/Latest
fi
cd "$HERE"/dydr
node access.js # Making sure access is available
node backup.js "$PCBACKUPS"/Reddit # Running backup
cd ..
echo "$(date)" >"$PCBACKUPS"/Reddit/lastBackedUp.txt
