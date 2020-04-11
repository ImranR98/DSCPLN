#!/bin/bash

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../../variables.sh
if [ -z "$SCHOOL" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$SCHOOL" ]; then
    echo "Some directories from variables.sh are missing!"
    exit
fi

if [ ! -d "$SCHOOL"/Matrix ]; then
	mkdir "$SCHOOL"/Matrix
fi
rsync -av iremtulla@matrix.senecac.on.ca:. "$SCHOOL"/Matrix --delete
echo "$(date)" > "$SCHOOL"/Matrix/lastBackedUp.txt