#!/bin/bash

# Ensure dependencies
for dep in age; do
	if [ -z "$(which $dep)" ]; then
		echo >&2 "The following dependency is missing: $dep"
		exit 5
	fi
done

# Usage function
function usage() {
    echo >&2 "Usage: $(basename $0) [path to the destination directory] [path to the Bitwarden export JSON]"
    exit 1
}

# Validate arguments
if [ ! "$#" -eq 2 ]; then
    usage
fi
if [ ! -d "$1" ]; then
    mkdir -p "$1"
fi
if [ ! -f "$2" ]; then
    echo "The Bitwarden JSON does not exist: $2."
    exit 3
fi

# Run
age --encrypt -p "$2" > "$1"/bitwarden.json
here="$(pwd)"
cd "$1"
if [ ! -d ./.git ]; then
    git init
fi
git add .
git commit -m "$(date)"
cd "$here"
rm "$2"