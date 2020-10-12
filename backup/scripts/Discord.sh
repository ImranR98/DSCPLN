#!/bin/bash
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../../variables.sh

if [ -z "$PCBACKUPS" ] || [ -z "$DISCORDCHATEXPORTERCLI" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$PCBACKUPS" ] || [ ! -d "$DISCORDCHATEXPORTERCLI" ]; then
    echo "Some directories from ../variables.sh are missing!"
    exit
fi

if [ ! -d "$PCBACKUPS"/Discord ]; then
	mkdir "$PCBACKUPS"/Discord
fi

echo "Enter a new token from the Discord web client:"
read token

echo "Here are your accessible servers:"
COMMAND=$(node "$HERE"/DCEA/serverListCommand.js "$DISCORDCHATEXPORTERCLI" "$token")
RES="$(eval "$COMMAND")"
echo "$RES" | awk '{print NR, $3}'

echo "Enter the server number to backup:"
read SERVERNUM

COMMAND=$(node "$HERE"/DCEA/backupCommand.js "$DISCORDCHATEXPORTERCLI" "$token" "$PCBACKUPS/Discord" "$SERVERNUM")