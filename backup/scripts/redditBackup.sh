#!/bin/bash

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../variables.sh
if [ -z "$REDDITBACKUPDIR" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$REDDITBACKUPDIR" ]; then
    echo "Some directories from ../variables.sh are missing!"
    exit
fi

if [ -z "$1" ]; then
    echo "Please provide a username"
    exit
fi

if [ ! -d "$REDDITBACKUPDIR" ]; then
    mkdir "$REDDITBACKUPDIR"
fi
if [ ! -d "$REDDITBACKUPDIR"/"$1" ]; then
    mkdir "$REDDITBACKUPDIR"/"$1"
fi
if [ ! -d "$REDDITBACKUPDIR"/"$1"/Oldest ]; then
    mkdir "$REDDITBACKUPDIR"/"$1"/Oldest
fi
if [ ! -d "$REDDITBACKUPDIR"/"$1"/Latest ]; then
    mkdir "$REDDITBACKUPDIR"/"$1"/Latest
fi
cd "$HERE"/dydr
node access.js "$REDDITBACKUPDIR"/"$1" # Making sure access is available
node backup.js "$REDDITBACKUPDIR"/"$1" # Running backup
cd ..
echo "$(date)" > "$REDDITBACKUPDIR"/"$1"/lastBackedUp.txt
