#!/bin/bash
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../../variables.sh

if [ -z "$PCRYERSON" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$PCRYERSON" ]; then
    echo "Some directories from ../variables.sh are missing!"
    exit
fi

if [ ! -d "$PCRYERSON"/Moon ]; then
	mkdir "$PCRYERSON"/Moon
fi

rsync -av iremtull@moon.cs.ryerson.ca:. "$PCRYERSON"/Moon --delete
echo "$(date)" > "$PCRYERSON"/Moon/lastBackedUp.txt