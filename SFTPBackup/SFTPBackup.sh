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
    echo >&2 "   -e              A pattern to pass to rsync's --exclude option."
    echo >&2 "   -s              Run rsync with sudo on the remote machine."
    exit 1
}

# Parse options
while getopts dgp:e:s opt; do
    case $opt in
    d) delete=1 ;;
    g) git=1 ;;
    p) PROXY=$OPTARG ;;
    e) EXCLUDE=$OPTARG ;;
    s) USE_SUDO=true ;;
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
REMOTE_RSYNC_PATH="rsync"

# Run
SSH_STRING="ssh -p $2"
if [ -n "$PROXY" ]; then
    SSH_STRING="$SSH_STRING -o 'ProxyCommand ssh -A $PROXY -W %h:%p'"
fi
if [ "$USE_SUDO" = true ]; then
    ENSURE_SUDO_REMOTE_COMMAND='if [ -z "$(sudo grep rsync /etc/sudoers)" ]; then echo "$USER ALL=NOPASSWD:$(which rsync)" | sudo tee -a /etc/sudoers; fi'
    eval "$SSH_STRING -t $1 '$ENSURE_SUDO_REMOTE_COMMAND'"
    REMOTE_RSYNC_PATH="sudo rsync"
fi
if [ "$delete" == "1" ]; then
    if [ "$git" == "1" ]; then
        rsync -rLq --rsync-path="$REMOTE_RSYNC_PATH" -e "$SSH_STRING" $1:"$3" "$4" --delete --exclude '/.git/' --exclude "$EXCLUDE"
    else
        rsync -rLq --rsync-path="$REMOTE_RSYNC_PATH" -e "$SSH_STRING" $1:"$3" "$4" --delete --exclude "$EXCLUDE"
    fi
else
    rsync -rLq --rsync-path="$REMOTE_RSYNC_PATH" -e "$SSH_STRING" $1:"$3" "$4" --exclude "$EXCLUDE"
fi
echo "$(date)" >"$4"/lastBackedUp.txt

# Commit to git if required and save the date of extraction in the commit message as well
if [ "$git" == "1" ]; then
    cd "$4"
    git add .
    git commit -q -m "$(date)"
    cd "$HERE"
fi
