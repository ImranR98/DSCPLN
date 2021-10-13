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
    echo >&2 "Usage: $(basename $0) [path to the directory containing the '.SeedVaultAndroidBackup' directory] [path to copy backup directory]"
    echo >&2 "Copy a SeedVault backup from the provided directory into another directory."
    exit 1
}

# Validate arguments
if [ ! "$#" -eq 2 ]; then
    usage
fi
if [ ! -d "$1" ]; then
    echo >&2 "The specified directory does not exist: $1."
    exit 2
fi
if [ ! -d "$2" ]; then
    echo >&2 "The specified directory does not exist: $2."
    exit 3
fi
if [ ! -d "$1/.SeedVaultAndroidBackup" ]; then
    echo >&2 "The '.SeedVaultAndroidBackup' directory does not exist inside $1."
    exit 4
fi
TEMPDIR="$(mktemp -d)"
TEMPWAD="$TEMPDIR/"$(basename "$1")""

echo "Copying .SeedVaultAndroidBackup to a temporary directory..."
cp -r "$1/.SeedVaultAndroidBackup" "$TEMPWAD"
echo "Saving to backup directory.."
rsync -a "$TEMPWAD"/ "$2" --delete
echo "$(date)" > "$2"/lastBackedUp.txt
rm -r "$TEMPWAD"