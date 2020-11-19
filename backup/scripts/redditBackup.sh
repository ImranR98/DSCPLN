#!/bin/bash

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../variables.sh
if [ -z "$PCBACKUPS" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$PCBACKUPS" ]; then
    echo "Some directories from ../variables.sh are missing!"
    exit
fi

if [ -z "$1" ]; then
    echo "Please provide a username"
    exit
fi

if [ ! -d "$PCBACKUPS"/Reddit ]; then
    mkdir "$PCBACKUPS"/Reddit
fi
if [ ! -d "$PCBACKUPS"/Reddit/"$1" ]; then
    mkdir "$PCBACKUPS"/Reddit/"$1"
fi
if [ ! -d "$PCBACKUPS"/Reddit/"$1"/Oldest ]; then
    mkdir "$PCBACKUPS"/Reddit/"$1"/Oldest
fi
if [ ! -d "$PCBACKUPS"/Reddit/"$1"/Latest ]; then
    mkdir "$PCBACKUPS"/Reddit/"$1"/Latest
fi
cd "$HERE"/dydr
node access.js "$PCBACKUPS"/Reddit/"$1" # Making sure access is available
node backup.js "$PCBACKUPS"/Reddit/"$1" # Running backup
cd ..
echo "$(date)" >"$PCBACKUPS"/Reddit/"$1"/lastBackedUp.txt
