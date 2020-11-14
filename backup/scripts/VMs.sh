#!/bin/bash
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../variables.sh
if [ -z "$PCBACKUPS" ] || [ -z "$PCHOME" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$PCBACKUPS" ] || [ ! -d "$PCHOME" ]; then
    echo "Some directories from ../variables.sh are missing!"
    exit
fi
if [ -d "$PCHOME/vmware" ]; then
    rsync -av "$PCHOME/vmware/" "$PCBACKUPS/Virtual Machines" --delete
    echo "$(date)" >"$PCBACKUPS/Virtual Machines/lastBackedUp.txt"
else
    echo "Virtual Machines folder not found!"
fi