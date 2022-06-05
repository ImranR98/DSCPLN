#!/bin/bash

# Ensure dependencies
for dep in node; do
    if [ -z "$(which $dep)" ]; then
        echo >&2 "The following dependency is missing: $dep"
        exit 5
    fi
done

# Store script location
SCRIPTDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

# Usage function
function usage() {
    echo >&2 "Usage: $(basename $0) [path to DiscordChatExporter CLI binary] [path to Discord backup directory]"
    echo >&2 "Backup Discord chats using DiscordChatExporter (https://github.com/Tyrrrz/DiscordChatExporter)."
    exit 1
}

# Validate arguments
if [ ! "$#" -eq 2 ]; then
    usage
fi
if [ ! -d "$2" ]; then
    echo "Created backup directory at $2."
    mkdir "$2"
fi
if [ ! -d "$1" ]; then
    echo >&2 "The specified DiscordChatExporter CLI directory does not exist: $1."
    exit 2
fi

# Run
echo "Enter a new token from the Discord web client:"
read token

command=$(node "$SCRIPTDIR"/serverListCommand.js "$1" "$token")
servers="$(eval "$command")"
echo "Here are your accessible servers:"
echo "$servers" | awk '{ s = ""; for (i = 3; i <= NF; i++) s = s $i " "; print NR,s }'

choosing=1
while [ $choosing == 1 ]; do
    echo "Enter the server number to backup:"
    read servernum

    if [ $servernum -gt $(echo "$servers" | wc -l) ] || [ $servernum -lt 1 ]; then
        echo "Enter a number between 1 and $(echo "$servers" | wc -l)"
    else
        choosing=0
    fi
done
serverid="$(echo "$servers" | head -$servernum | tail -1 | awk '{print $1}')"
servername="$(echo "$servers" | head -$servernum | tail -1 | awk '{ s = ""; for (i = 3; i <= NF; i++) s = s $i " "; print s }')"

echo "$serverid and $servername"
echo "$servers"

echo "Enter the default start date (or leave empty):"
read startDate

command="$(node "$SCRIPTDIR"/backupCommand.js "$1" "$token" "$2" "$serverid" "$servername" "$startDate")"
echo "Running command: $command"
eval "$command"

# Script to remove files w/o me in them - moves "good" dirs to ~/Downloads/new and what's left in current dir can be deleted
<<COMMENT
mkdir ~/Downloads/new/
for folder in *; do
    mkdir ~/Downloads/new/"$folder"
    for subfolder in "$folder"/*; do
    	mkdir ~/Downloads/new/"$subfolder"
    	for file in "$subfolder"/*.html; do
    		if [ ! -z "$(cat "$file" | grep -E '(ImranR|inb4SHTF|Imran)')" ]; then
    			cp "$file" ~/Downloads/new/"$subfolder"/
    			cp -r "$file"_Files ~/Downloads/new/"$subfolder"/
    		fi
    	done
    done
done
COMMENT
