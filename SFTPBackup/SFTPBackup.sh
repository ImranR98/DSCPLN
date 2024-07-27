#!/bin/bash

# Ensure dependencies
for dep in rsync ssh; do
    if [ -z "$(which $dep)" ]; then
        echo >&2 "The following dependency is missing: $dep"
        exit 5
    fi
done

# Store script location
SCRIPTDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
HERE="$(pwd)"

# Usage function
function usage() {
    echo >&2 "Usage: $(basename $0) [-d] [Username@SSH hostname/IP] [SSH port] [Rsync target string] [path to backup directory]"
    echo >&2 "Backup files from a server using Rsync via SSH."
    echo >&2 "   -d          Use the Rsync --delete option."
    echo >&2 "   -g              Use git to save changes (initializes an empty repo or uses an existing one)."
    echo >&2 "   -p              Specify a jump host to proxy through (hardcoded to port 22)."
    exit 1
}

# Parse options
while getopts dgp: opt; do
    case $opt in
    d) delete=1 ;;
    g) git=1 ;;
    p) proxy=$OPTARG ;;
    \?) usage ;;
    esac
done
shift $((OPTIND - 1))

# Validate arguments
if [ ! "$#" -eq 4 ]; then
    usage
fi
if [[ ! "$2" =~ ^[0-9]+$ ]]; then
    echo >&2 "The specified SSH port is not a number."
    exit 2
fi
if [ ! -d "$4" ]; then
    echo "Created backup directory at $4."
    mkdir -p "$4"
fi
if [ "$git" == "1" ] && [ ! -d "$4/.git" ]; then
    cd "$4"
    git init -q
    cd "$HERE"
fi

# Run
if [ "$delete" == "1" ]; then
    SSH_STRING="ssh -p $2"
    if [ -n "$proxy" ]; then
        SSH_STRING="$SSH_STRING -o 'ProxyCommand ssh -A $proxy -W %h:%p'"
    fi
    if [ "$git" == "1" ]; then
        rsync -rLq -e "$SSH_STRING" $1:"$3" "$4" --delete --exclude '/.git/'
    else
        rsync -rLq -e "$SSH_STRING" $1:"$3" "$4" --delete
    fi
else
    rsync -rLq -e "$SSH_STRING" $1:"$3" "$4"
fi
echo "$(date)" >"$4"/lastBackedUp.txt

# Commit to git if required and save the date of extraction in the commit message as well
if [ "$git" == "1" ]; then
    cd "$4"
    git add .
    git commit -q -m "$(date)"
    cd "$HERE"
fi
