#!/bin/bash

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../../variables.sh
if [ -z "$PCVMS" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$PCVMS" ]; then
    echo "Some directories from ../variables.sh are missing!"
    exit
fi

rsync -av '/mnt/c/Users/Imran Remtulla/Documents/Virtual Machine' "$PCVMS" --delete
echo "$(date)" > "$PCVMS"/lastBackedUp.txt
