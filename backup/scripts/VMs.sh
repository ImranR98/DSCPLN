#!/bin/bash
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../variables.sh
if [ -z "$VMSBACKUPDIR" ] || [ -z "$VMSDIR" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$VMSBACKUPDIR" ] || [ ! -d "$VMSDIR" ]; then
    echo "Some directories from ../variables.sh are missing!"
    exit
fi
if [ -d "$VMSDIR" ]; then
    rsync -av "$VMSDIR/" "$VMSBACKUPDIR" --delete
    echo "$(date)" > "$VMSBACKUPDIR/lastBackedUp.txt"
else
    echo "Virtual Machines folder not found!"
fi