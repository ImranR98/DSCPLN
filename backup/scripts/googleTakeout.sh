#!/bin/bash

# Store script location
SCRIPTDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

# Usage function
function usage() {
	echo >&2 "Usage: $(basename $0) [-nv] [Directory containing Takeout .zip file(s)] [Backup directory]"
	echo >&2 "Extract a downloaded Google Takeout to a specified directory (then delete the compressed download)."
	echo >&2 "   -v          Increase verbosity."
	exit 1
}

# Verbose-only echo
function echoVerbose() {
	if [ "$verbose" == "1" ]; then echo "${1}"; fi
}

# Parse options
while getopts v opt; do
	case $opt in
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
	echo >&2 "The specified directory containing Takeout .zip files(s) does not exist: $1."
fi
if [ ! -d "$2" ]; then
	echoVerbose "Created backup directory at $2."
	mkdir "$2"
fi

# Run
takeoutfile=$(ls "$1" | grep takeout-.*.zip$)
if [ ! -z "$takeoutfile" ]; then
	echo "$1/$takeoutfile" | while read -r line; do
		unzip -o "$line" -d "$1"
		rm "$line"
	done
	node "$SCRIPTDIR"/renameFilesEndingWithDot.js "$1/Takeout"
	if [ ! -d "$2" ]; then
		mkdir "$2"
	fi
	rsync -av "$1/Takeout/" "$2" --delete
	echo "$(date)" >"$2"/lastBackedUp.txt
	rm -r "$1/Takeout"
else
	echo >&2 "No takeout zip found."
	exit 2
fi
