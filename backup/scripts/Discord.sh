#!/bin/bash

# Store script location
SCRIPTDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

# Usage function
function usage() {
    echo >&2 "Usage: $(basename $0) [Discord backup directory] [path to DiscordChatExporter CLI binary]"
    echo >&2 "Backup Discord chats using DiscordChatExporter (https://github.com/Tyrrrz/DiscordChatExporter)."
    echo >&2 "   -v          Increase verbosity."
    exit 1
}

# Verbose-only echo
function echoVerbose() {
    if [ "$verbose" == "1" ]; then echo "${1}"; fi
}

# Parse options
while getopts v opt; do
    case $opt in
    v) verbose=1 ;;
    \?) usage ;;
    esac
done
shift $((OPTIND - 1))

# Validate arguments
if [ ! "$#" -eq 2 ]; then
    usage
fi
if [ ! -f "$2" ]; then
    echo >&2 "The specified DiscordChatExporter CLI binary does not exist: $2."
fi

if [ ! -d "$1" ]; then
    mkdir "$1"
fi

echo "Enter a new token from the Discord web client:"
read token

command=$(node "$SCRIPTDIR"/DCEA/serverListCommand.js "$2" "$token")
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

command="$(node "$SCRIPTDIR"/DCEA/backupCommand.js "$2" "$token" "$1" "$serverid" "$servername")"
echoVerbose "Running command: $command"
eval "$command"
