#!/bin/bash

# Ensure dependencies
for dep in rsync; do
	if [ -z "$(which $dep)" ]; then
		echo >&2 "The following dependency is missing: $dep"
		exit 5
	fi
done

# Store script location
SCRIPTDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

# Usage function
function usage() {
    echo >&2 "Usage: $(basename $0) [path to active WhatsApp directory] [path to WhatsApp backup directory]"
    echo >&2 "Backup various WhatsApp for Android files into a folder (existing chat backup files are overwritten and existing media files are kept in place)"
    exit 1
}

# Validate arguments
if [ ! "$#" -eq 2 ]; then
    usage
fi
if [ ! -d "$1" ]; then
    echo >&2 "The specified directory does not exist: $1."
    exit 2
fi
if [ ! -d "$2" ]; then
    echo >&2 "The specified directory does not exist: $2."
    exit 3
fi
TEMPDIR="$(mktemp -d)"
TEMPWAD="$TEMPDIR/"$(basename "$1")""

cp -r "$1" "$TEMPWAD"
rsync -aq "$TEMPWAD"/ "$2"
echo "$(date)" > "$2"/lastBackedUp.txt
rm -r "$TEMPWAD"