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
    echo >&2 "Usage: $(basename $0) [-d] [path to file/directory to copy] [path to target directory] [optional - filename to rename to (if copying a file)]"
    echo >&2 "Copy a file/directory to a target directory with a git history"
    echo >&2 "   -d              Delete original file/directory after copying."
    exit 1
}

# Parse options
while getopts d opt; do
	case $opt in
	d) delete=1 ;;
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
if [ ! -d "$2" ]; then
    echo >&2 "The specified target directory does not exist: $2."
    exit 2
fi

# Remove trailing slashes (important for rsync on directories)
SOURCE="$(echo "$1" | sed 's:/*$::')"
TARGET="$(echo "$2" | sed 's:/*$::')"

SOURCE_NAME="$(basename "$SOURCE")"

if [ -f "$SOURCE" ]; then
    if [ -z "$3" ]; then
        cp "$SOURCE" "$TARGET"
    else
        cp "$SOURCE" "$TARGET"/"$3"
    fi
else
    rsync -rLq "$SOURCE" "$TARGET" --delete
    SOURCE_NAME="$SOURCE_NAME"'/'
fi

# Delete the original file/directory if required
if [ "$delete" == "1" ]; then
	rm -r "$SOURCE"
fi

# Commit to Git
here="$(pwd)"
cd "$TARGET"
if [ ! -d ./.git ]; then
    git init
fi
git add .
MESSAGE="$(date)"' - Updated: '"$SOURCE_NAME"
git commit -q -m "$MESSAGE"
cd "$here"
