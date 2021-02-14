#!/bin/bash

# Store script location
SCRIPTDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

# Usage function
function usage() {
    echo >&2 "Usage: $(basename $0) [-n] [path to accounts file] [path to balance directory]"
    echo >&2 "Convert my accounts text file into something that can be pasted into my Balance.xlsx file, and commit the change to git."
    echo >&2 "   -n          Don't wait for user action (also skips git commit)."
    exit 1
}

# Parse options
while getopts n opt; do
    case $opt in
    n) nowait=1 ;;
    \?) usage ;;
    esac
done
shift $((OPTIND - 1))

# Validate arguments
if [ ! "$#" -eq 2 ]; then
    usage
fi
if [ ! -f "$1" ]; then
    echo >&2 "The specified accounts file does not exist: $1."
    exit 2
fi
if [ ! -d "$2" ]; then
    echo >&2 "The specified balance directory does not exist: $2."
    exit 3
fi

# Run
node "$SCRIPTDIR"/accMDToXLSX.js "$1" "$2"/Balance.xlsx

if [ "$nowait" != "1" ]; then
    echo "Paste the results into Balance.xlsx. When ready, press [ENTER]."
    read choice
    here="$(pwd)"
    cd "$2"
    git add .
    git commit . -m "$(date)"
    cd "$here"
fi
