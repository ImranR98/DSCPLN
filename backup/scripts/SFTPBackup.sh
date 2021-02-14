#!/bin/bash

# Store script location
SCRIPTDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

# Usage function
function usage() {
    echo >&2 "Usage: $(basename $0) [Username@SSH hostname/IP] [SSH port] [Rsync target string] [path to backup directory]"
    echo >&2 "Backup files from a server using Rsync via SSH."
    echo >&2 "   -v          Increase verbosity."
    echo >&2 "   -d          Use the Rsync --delete option."
    exit 1
}

# Verbose-only echo
function echoVerbose() {
    if [ "$verbose" == "1" ]; then echo "${1}"; fi
}

# Parse options
while getopts vd opt; do
    case $opt in
    v) verbose=1 ;;
    d) delete=1 ;;
    \?) usage ;;
    esac
done
shift $((OPTIND - 1))

# Validate arguments
if [ ! "$#" -eq 3 ]; then
    usage
fi
if [[ "$2" =~ ^[0-9]+$ ]]; then
    echo >&2 "The specified SSH port is not a number."
    exit 2
fi
if [ ! -d "$4" ]; then
    echoVerbose "Created backup directory at $4."
    mkdir "$4"
fi

# Run
rsync -av -e "ssh -p $2" $1:"$3" "$4" "$(if [ "$delete" == "1" ]; then echo '--delete'; fi)"
echo "$(date)" >"$4"/lastBackedUp.txt