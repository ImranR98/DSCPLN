#!/bin/bash

# Ensure dependencies
for dep in rsync git; do
    if [ -z "$(which $dep)" ]; then
        echo >&2 "The following dependency is missing: $dep"
        exit 5
    fi
done

# Store script location
SCRIPTDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

# Usage function
function usage() {
    echo >&2 "Usage: $(basename $0) [-d] [path to file/directory to copy] [path to target directory]"
    echo >&2 "Copy a file/directory to a target directory with a git history"
    echo >&2 "   -d              Delete original file/directory after copying."
    echo >&2 "   -g              Use git to save changes (initializes an empty repo or uses an existing one)."
    exit 1
}

# Parse options
while getopts dg opt; do
    case $opt in
    d) delete=1 ;;
    g) git=1 ;;
    \?) usage ;;
    esac
done
shift $((OPTIND - 1))

# Validate arguments
if [ ! "$#" -eq 2 ] && [ ! "$#" -eq 3 ]; then
    usage
fi
if [ ! -f "$1" ] && [ ! -d "$1" ]; then
    echo >&2 "The specified file/directory to copy does not exist: $1."
    exit 2
fi

# Remove trailing slashes (important for rsync on directories)
SOURCE="$(echo "$1" | sed 's:/*$::')"
TARGET="$(echo "$2" | sed 's:/*$::')"

if [ ! -d "$TARGET" ]; then
    mkdir -p "$TARGET"
fi

if [ -f "$SOURCE" ]; then
    FINALTARGET="$TARGET"
    if [ -n "$3" ]; then
        FINALTARGET="$TARGET"/"$3"
    fi
    cp "$SOURCE" "$FINALTARGET"
else
    if [ "$git" == "1" ]; then
        rsync -rLq "$SOURCE"/ "$TARGET"/ --delete --exclude '/.git/'
    else
        rsync -rLq "$SOURCE"/ "$TARGET"/ --delete
    fi
fi

# Delete the original file/directory if required
if [ "$delete" == "1" ]; then
    rm -r "$SOURCE"
fi

# Commit to Git
if [ "$git" == "1" ]; then
    here="$(pwd)"
    cd "$TARGET"
    if [ ! -d ./.git ]; then
        git init
    fi
    git add .
    MESSAGE="$(date)"' - Updated: '"$(basename "$TARGET")"
    git commit -q -m "$MESSAGE"
    cd "$here"
fi
