#!/bin/bash
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../../variables.sh

if [ -z "$PCBACKUPS" ] || [ -z "$NUCUSERNAME" ] || [ -z "$LOCALNUCDOMAIN" ] || [ -z "$LOCALNUCSSHPORT" ] || [ -z "$NUCDOMAIN" ] || [ -z "$NUCSSHPORT" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$PCBACKUPS" ]; then
    echo "Some directories from ../variables.sh are missing!"
    exit
fi

if [ ! -d "$PCBACKUPS"/NUCFiles ]; then
	mkdir "$PCBACKUPS"/NUCFiles
fi

LOCALNUCACCESSIBLE="$(nmap $LOCALNUCDOMAIN -PN -p $LOCALNUCSSHPORT | grep open)"
NUCACCESSIBLE="$(nmap $NUCDOMAIN -PN -p $NUCSSHPORT | grep open)"
if [ ! -z "$LOCALNUCACCESSIBLE" ]; then
    rsync -av --port=$LOCALNUCSSHPORT $NUCUSERNAME@$LOCALNUCDOMAIN:~/{*.sh,.bashrc} "$PCBACKUPS"/NUCFiles
elif [ ! -z "$NUCACCESSIBLE" ]; then
    rsync -av --port=$NUCSSHPORT $NUCUSERNAME@$NUCDOMAIN:~/{*.sh,.bashrc} "$PCBACKUPS"/NUCFiles
else 
    echo "NUC is not accessible!"
    exit
fi; 

echo "$(date)" > "$PCBACKUPS"/NUCFiles/lastBackedUp.txt