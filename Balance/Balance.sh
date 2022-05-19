#!/bin/bash

# Ensure dependencies
for dep in node npm git; do
	if [ -z "$(which $dep)" ]; then
		echo >&2 "The following dependency is missing: $dep"
		exit 3
	fi
done

# Store script location
SCRIPTDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

# Usage function
function usage() {
    echo >&2 "Usage: $(basename $0) [-n] [path to balance directory]"
    echo >&2 "Convert my accounts text into something that can be pasted into my Balance.xlsx file, and commit the change to git."
    exit 1
}

# Validate arguments
if [ ! "$#" -eq 1 ]; then
    usage
fi
if [ ! -d "$1" ]; then
    echo >&2 "The specified balance directory does not exist: $1."
    exit 2
fi

# Run
here="$(pwd)"
cd "$SCRIPTDIR"
npm i # Make sure dependencies are installed

echo "Paste the Acc text, then press Ctrl+D:"
ACC_TEXT=$(cat)

node "$SCRIPTDIR"/accMDToXLSX.js "$ACC_TEXT" "$1"/Balance.xlsx

echo "Paste the above results into Balance.xlsx. When ready, press [ENTER]."
read choice
cd "$1"
git add .
git commit -q -m "$(date)"
cd "$here"

echo "
NOTE: You still need to manually add Transaction Types and any Investment changes."