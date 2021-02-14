#!/bin/bash

# Store script location
SCRIPTDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

# Usage function
function usage() {
	echo >&2 "Usage: $(basename $0) [-d] [path(s) to .zip file(s)] [path to directory]"
	echo >&2 "Extract a one or more .zip files into a directory."
	echo >&2 "   -d          Delete .zip files after extraction."
	exit 1
}

# Parse options
while getopts vd opt; do
	case $opt in
	d) delete=1 ;;
	\?) usage ;;
	esac
done
shift $((OPTIND - 1))

# Validate arguments
if [ ! "$#" -eq 2 ]; then
	usage
fi
files=($1)
for i in "${files[@]}"; do
	if [ ! -f "$i" ]; then
		echo >&2 "The specified file does not exist: $i."
		exit 2
	fi
done
if [ ! -d "$2" ]; then
	echo "Created backup directory at $2."
	mkdir "$2"
fi

# Run
tempfolder=$(mktemp -d 2>/dev/null || mktemp -d -t 'tempfolder')

if [ -z "$tempfolder" ] || [ ! -d "$tempfolder" ]; then
	echo >&2 "Could not create temporary directory."
	exit 3
fi

function cleanup() {
	rm -r "$tempfolder"
}

trap cleanup EXIT

for i in "${files[@]}"; do
	unzip -o "$i" -d "$tempfolder"
done

node "$SCRIPTDIR"/renameFilesEndingWithDot.js "$tempfolder"

if [ ! -d "$2" ]; then
	mkdir "$2"
fi

rsync -av "$tempfolder/" "$2" --delete

if [ "$delete" == "1" ]; then
	for i in "${files[@]}"; do
		rm "$i"
	done
fi

echo "$(date)" >"$2"/lastBackedUp.txt