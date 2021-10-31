#!/bin/bash

# Ensure dependencies
for dep in rsync; do
	if [ -z "$(which $dep)" ]; then
		echo >&2 "The following dependency is missing: $dep"
		exit 5
	fi
done

# Store script location
SCRIPTDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

# Usage function
function usage() {
    echo >&2 "Usage: $(basename $0) [path to backup directory]"
    echo >&2 "Backup various local files."
    exit 1
}

# Validate arguments
if [ ! "$#" -eq 1 ]; then
    usage
fi
if [ ! -d "$1" ]; then
    echo >&2 "The specified backup directory does not exist: $1."
    exit 2
fi

cp -v ~/".bashrc" "$1/Other" && echo '# Backed up on '"$(date)" >>"$1/Other/.bashrc"

rsync -rL ~/".ssh" "$1/Other" --delete
echo "$(date)" >"$1/Other"/lastBackedUp.txt
