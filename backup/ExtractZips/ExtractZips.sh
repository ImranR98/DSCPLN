#!/bin/bash

# Ensure dependencies
for dep in node git unzip rsync mktemp; do
	if [ -z "$(which $dep)" ]; then
		echo >&2 "The following dependency is missing: $dep"
		exit 5
	fi
done

# Store script location and current location
SCRIPTDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
HERE="$(pwd)"

# Usage function
function usage() {
	echo >&2 "Usage: $(basename $0) [-d] [-g] [path(s) to .zip file(s)] [path to directory]"
	echo >&2 "Extract a one or more .zip files into a directory."
	echo >&2 "   -d              Delete .zip files after extraction."
	echo >&2 "   -g              Use git to save changes (initializes an empty repo or uses an existing one)."
	echo >&2 "   -n [command]    Bash command whose output is appended to the extracted directory name"
	exit 1
}

# Parse options
while getopts "dgn:" opt; do
	case $opt in
	d) delete=1 ;;
	g) git=1 ;;
	n) nameCommand="$OPTARG" ;;
	\?) usage ;;
	esac
done
shift $((OPTIND - 1))

# Validate arguments
if [ ! "$#" -eq 2 ]; then
	usage
fi
files=($1)
if [ "${#files[@]}" == 0 ]; then
	echo >&2 "There are no files!"
	exit 5
fi
for i in "${files[@]}"; do
	if [ ! -f "$i" ]; then
		echo >&2 "The specified file does not exist: $i."
		exit 2
	fi
done

# Create a temp. folder to unzip into (and register a trap to cleanup the temp. folder)
tempfolder=$(mktemp -d 2>/dev/null || mktemp -d -t 'tempfolder')
if [ -z "$tempfolder" ] || [ ! -d "$tempfolder" ]; then
	echo >&2 "Could not create temporary directory."
	exit 3
fi
function cleanup() {
	rm -r "$tempfolder"
}
trap cleanup EXIT

# Unzip into the temp. folder
for i in "${files[@]}"; do
	unzip -q -o "$i" -d "$tempfolder"
done

# Run the name command (if any) the temp dir to obtain a string, then append that string to the final dir name (else, use the original name)
cd "$tempfolder"
toAppend="$(eval "$nameCommand")"
if [ ! -z "$toAppend" ]; then
	finalDir=""$2" - "$toAppend""
else
	finalDir="$2"
fi
cd "$HERE"

# Run a node script to rename and files ending with dots (these may cause issues in some situations)
node "$SCRIPTDIR"/renameFilesEndingWithDot.js "$tempfolder"

# Prepare the directory and git repo if required
if [ ! -d "$finalDir" ]; then
	echo "Created backup directory at $finalDir."
	mkdir "$finalDir"
fi
if [ "$git" == "1" ] && [ ! -d "$finalDir/.git" ]; then
	cd "$finalDir"
	git init -q
	cd "$HERE"
fi

# Sync the temp. folder with the backup folder while maintaining the .git folder if required
if [ ! "$git" == "1" ]; then
	rsync -rLq "$tempfolder/" "$finalDir" --delete
else
	if [ -d "$tempfolder/.git" ]; then
		echo >&2 "The unzipped directory contains a .git directory at its root, which cannot be copied over while the -g option is in use as it would overwrite the existing .git folder."
		exit 4
	else
		rsync -rLq "$tempfolder/" "$finalDir" --delete --exclude '/.git/'
	fi
fi

# Delete the original zip file if required
if [ "$delete" == "1" ]; then
	for i in "${files[@]}"; do
		rm "$i"
	done
fi

# Save the extraction date in a file
echo "$(date)" > "$finalDir"/lastBackedUp.txt

# Commit to git if required and save the date of extraction in the commit message as well
if [ "$git" == "1" ]; then
	cd "$finalDir"
	git add .
	git commit -q -m "$(date)"
	cd "$HERE"
fi
