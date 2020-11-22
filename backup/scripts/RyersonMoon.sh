#!/bin/bash
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../variables.sh

if [ -z "$RYERSONDIR" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$RYERSONDIR" ]; then
    echo "Some directories from ../variables.sh are missing!"
    exit
fi

if [ ! -d "$RYERSONDIR"/Moon ]; then
	mkdir "$RYERSONDIR"/Moon
fi

rsync -av iremtull@moon.cs.ryerson.ca:. "$RYERSONDIR"/Moon --delete
echo "$(date)" > "$RYERSONDIR"/Moon/lastBackedUp.txt