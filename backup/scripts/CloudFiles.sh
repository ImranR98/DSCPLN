#!/bin/bash

# Store script location
SCRIPTDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

# Usage function
function usage() {
    echo >&2 "Usage: $(basename $0) [Cloud SSH hostname/IP] [Cloud SSH port] [path to Cloud backup directory]"
    echo >&2 "Backup various important files from my Cloud server via SSH."
    exit 1
}

# Verbose-only echo
function echoVerbose() {
    if [ "$verbose" == "1" ]; then echo "${1}"; fi
}

# Validate arguments
if [ ! "$#" -eq 3 ]; then
    usage
fi
if [[ "$2" =~ ^[0-9]+$ ]]; then
    echo >&2 "The specified SSH port is not a number."
fi
if [ ! -d "$3" ]; then
    echoVerbose "Created backup directory at $3."
    mkdir "$3"
fi

# Run
rsync -av --port="$2" "$1":/lib/systemd/system/imranr_* "$3" --delete
echo "$(date)" >"$3"/lastBackedUp.txt
