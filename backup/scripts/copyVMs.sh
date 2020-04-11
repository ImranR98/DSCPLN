#!/bin/bash

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../../variables.sh
if [ -z "$VMS" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$VMS" ]; then
    echo "Some directories from variables.sh are missing!"
    exit
fi

rsync -av ~/vmware/ "$VMS" --delete
echo "$(date)" > "$VMS"/lastBackedUp.txt
