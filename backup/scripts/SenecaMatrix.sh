#!/bin/bash

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../../variables.sh
if [ -z "$PCSCHOOL" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$PCSCHOOL" ]; then
    echo "Some directories from ../variables.sh are missing!"
    exit
fi

if [ ! -d "$PCSCHOOL"/Matrix ]; then
	mkdir "$PCSCHOOL"/Matrix
fi
rsync -av iremtulla@matrix.senecac.on.ca:. "$PCSCHOOL"/Matrix --delete
echo "$(date)" > "$PCSCHOOL"/Matrix/lastBackedUp.txt