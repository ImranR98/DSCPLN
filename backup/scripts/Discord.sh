#!/bin/bash
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../variables.sh

if [ -z "$DISCORDBACKUPDIR" ] || [ -z "$DISCORDCHATEXPORTERCLIDIR" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$DISCORDBACKUPDIR" ] || [ ! -d "$DISCORDCHATEXPORTERCLIDIR" ]; then
    echo "Some directories from ../variables.sh are missing!"
    exit
fi

if [ ! -d "$DISCORDBACKUPDIR" ]; then
	mkdir "$DISCORDBACKUPDIR"
fi

echo "Enter a new token from the Discord web client:"
read token

COMMAND=$(node "$HERE"/DCEA/serverListCommand.js "$DISCORDCHATEXPORTERCLIDIR" "$token")
SERVERS="$(eval "$COMMAND")"
echo "Here are your accessible servers:"
echo "$SERVERS" | awk '{ s = ""; for (i = 3; i <= NF; i++) s = s $i " "; print NR,s }'

CHOOSING=1
while [ $CHOOSING == 1 ]; do
    echo "Enter the server number to backup:"
    read SERVERNUM

    if [ $SERVERNUM -gt $(echo "$SERVERS" | wc -l) ] || [ $SERVERNUM -lt 1 ] ; then 
        echo "Enter a number between 1 and $(echo "$SERVERS" | wc -l)"
    else 
        CHOOSING=0
    fi
done 
SERVERID="$(echo "$SERVERS" | head -$SERVERNUM | tail -1 | awk '{print $1}')"
SERVERNAME="$(echo "$SERVERS" | head -$SERVERNUM | tail -1 | awk '{ s = ""; for (i = 3; i <= NF; i++) s = s $i " "; print s }')"

COMMAND="$(node "$HERE"/DCEA/backupCommand.js "$DISCORDCHATEXPORTERCLIDIR" "$token" "$DISCORDBACKUPDIR" "$SERVERID" "$SERVERNAME")"
echo "Running command: $COMMAND"
eval "$COMMAND"