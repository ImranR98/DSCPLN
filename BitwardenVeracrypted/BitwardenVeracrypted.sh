#!/bin/bash

# Ensure dependencies
for dep in veracrypt; do
	if [ -z "$(which $dep)" ]; then
		echo >&2 "The following dependency is missing: $dep"
		exit 5
	fi
done

# Usage function
function usage() {
    echo >&2 "Usage: $(basename $0) [path to the Veracrypt container] [path to the Bitwarden export JSON]"
    exit 1
}

# Validate arguments
if [ ! "$#" -eq 2 ]; then
    usage
fi
if [ ! -f "$1" ]; then
    echo >&2 "The Veracrypt container does not exist: $1."
    exit 2
fi
if [ ! -f "$2" ]; then
    echo "The Bitwarden JSON does not exist: $2."
    exit 3
fi

# Run
sudo veracrypt "$1"
MOUNTPATH="$(sudo veracrypt -t -l | grep "$(basename "$1")" | awk '{print $4}')"
here="$(pwd)"
cd "$MOUNTPATH"
mv "$2" ./latest-bitwarden_export.json
if [ ! -d ./.git ]; then
    git init
fi
git add .
git commit -m "$(date)"
cd "$here"
sudo veracrypt -d