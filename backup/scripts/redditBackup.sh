#!/bin/bash

# Store script location
SCRIPTDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

# Usage function
function usage() {
    echo >&2 "Usage: $(basename $0) [Reddit username] [path to Reddit backup directory]"
    echo >&2 "Backup Reddit data."
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

# Run
if [ ! -d "$2"/"$1" ]; then
    mkdir "$2"/"$1"
fi
if [ ! -d "$2"/"$1"/Oldest ]; then
    mkdir "$2"/"$1"/Oldest
fi
if [ ! -d "$2"/"$1"/Latest ]; then
    mkdir "$2"/"$1"/Latest
fi
here="$(pwd)"
cd "$SCRIPTDIR"/dydr
node access.js "$2"/"$1" # Making sure access is available
node backup.js "$2"/"$1" # Running backup
cd "$here"
echo "$(date)" >"$2"/"$1"/lastBackedUp.txt
