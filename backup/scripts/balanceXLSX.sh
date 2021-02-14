#!/bin/bash
# Prompts for confirmation unless --nowait is provided as an argument

# Store script location
SCRIPTDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

# Usage function
function usage() {
    echo >&2 "Usage: $(basename $0) [-nv] [path to accounts file] [path to balance directory]"
    echo >&2 "Convert my accounts text file into something that can be pasted into my Balance.xlsx file, and commit the change to git."
    echo >&2 "   -n          Don't wait for user action (also skips git commit)."
    echo >&2 "   -v          Increase verbosity."
    exit 1
}

# Verbose-only echo
function echoVerbose() {
    if [ "$verbose" == "1" ]; then echo "${1}"; fi
}

# Parse options
while getopts vn opt; do
    case $opt in
    n) nowait=1 ;;
    v) verbose=1 ;;
    \?) usage ;;
    esac
done
shift $((OPTIND - 1))

# Validate arguments
if [ ! "$#" -eq 2 ]; then
    usage
fi
if [ ! -d "$1" ]; then
    echo >&2 ""
fi

# Run
echoVerbose "New entries for Balance.xlsx will now be generated from $1:"

node "$SCRIPTDIR"/accMDToXLSX/accMDToXLSX.js "$1" "$2"/Balance.xlsx

if [ "$nowait" != "1" ]; then
    echo "Paste the results into Balance.xlsx. When ready, press [ENTER]."
    read choice
    here="$(pwd)"
    cd "$2"
    git add .
    git commit . -m "$(date)"
    cd "$here"
else
    echoVerbose "-n option used; will not perform git commit."
fi
