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

COMMAND=$(node "$HERE"/DCEA.js "$DISCORDCHATEXPORTERCLI" "$PCBACKUPS/Discord" "$token")
echo "$COMMAND"