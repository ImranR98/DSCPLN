#!/bin/bash

# Ensure dependencies
for dep in rsync; do
	if [ -z "$(which $dep)" ]; then
		echo >&2 "The following dependency is missing: $dep"
		exit 5
	fi
done

# Usage function
function usage() {
    echo >&2 "Usage: $(basename $0) [path to the 'PS4' directory] [path to PS4 save backup directory] [path to unsorted PS4 media directory]"
    exit 1
}

# Validate arguments
if [ ! "$#" -eq 3 ]; then
    usage
fi
if [ ! -d "$1" ]; then
    echo >&2 "The PS4 directory does not exist: $1."
    exit 2
fi
if [ ! -d "$2" ]; then
    echo "Created PS4 save backup directory at $2."
    mkdir "$2"
fi
if [ ! -d "$3" ]; then
    echo "Created unsorted PS4 media directory at $3."
    mkdir "$3"
fi

# Run
if [ -d "$1"/SAVEDATA ]; then
    rsync -rLq "$1"/SAVEDATA "$2" --delete
    echo "$(date)" >"$2"/lastBackedUp.txt
fi
if [ -d "$1"/SHARE ]; then
    rsync -rLq "$1"/SHARE "$3"
    echo "$(date)" >"$3"/lastBackedUp.txt
fi
