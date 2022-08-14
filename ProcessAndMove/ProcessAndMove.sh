#!/bin/bash

# Ensure dependencies
for dep in realpath; do
    if [ -z "$(which $dep)" ]; then
        echo >&2 "The following dependency is missing: $dep"
        exit 2
    fi
done

# Usage function
function usage() {
    echo >&2 "Usage: $(basename $0) [-c] [path to processing script] [path to source directory] [path to target directory]"
    echo >&2 "Copy all files from a source directory into a temporary directory, run a provided script on that directory (\"process\" the files in some way), then move the results to a destination directory and delete the originals."
    echo >&2 "   -c              Get user confirmation before doing anything."
    exit 1
}

# Parse options
while getopts c opt; do
	case $opt in
	c) confirm=1 ;;
	\?) usage ;;
	esac
done
shift $((OPTIND - 1))

# Validate arguments
if [ ! "$#" -eq 3 ]; then
    usage
fi
if [ ! -f "$1" ]; then
    echo >&2 "The specified script file does not exist: '"$1"'"
    exit 3
fi
if [[ ! -x "$1" ]]; then
    echo >&2 "The specified script file is not executable: '"$1"'"
    exit 4
fi
if [ ! -d "$2" ] || [ ! -d "$3" ]; then
    echo >&2 "One or both directories not found: '"$2"' '"$3"'"
    exit 5
fi

# Run process
if [ "$(find "$2" -maxdepth 1 -type f | wc -l)" -eq 0 ]; then
	echo "No files in directory, skipped: '"$2"'"
else
    RUN=1
    if [ "$confirm" == "1" ]; then
	    echo "About to move all files from '"$2"' to '"$3"' after processing with '"$1"'. Continue? Y/N"
        read CHOICE
        if [ "$CHOICE" == 'Y' ] || [ "$CHOICE" == 'y' ]; then
            RUN=0
        fi
    fi
    if [ "$RUN" == "1" ]; then
	    TEMPDIR="$(mktemp -d)" || exit 6
	    cp "$2"/* "$TEMPDIR"
	    "$1" "$TEMPDIR" || exit 7
	    mv "$TEMPDIR"/* "$3" || exit 8
	    rm -r "$TEMPDIR"
	    unset TEMPDIR
	    rm -r "$2"/*
    fi
fi