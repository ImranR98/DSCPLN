#!/bin/bash

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

# Run
if [ ! -d "$1/Other" ]; then mkdir "$1/Other"; fi

FFFOLDER=$(ls ~"/.mozilla/firefox" | grep ".default-release$")
cp -v ~"/.mozilla/firefox/$FFFOLDER/bookmarks.html" "$1/Other" && echo '<!-- Backed up on '"$(date)"' -->' >>"$1/Other/bookmarks.html"

cp -v ~"/.bashrc" "$1/Other" && echo '# Backed up on '"$(date)" >>"$1/Other/.bashrc"

if [ ! -d "$1/ssh" ]; then mkdir "$1/ssh"; fi
rsync -av ~"/.ssh" "$1/Other" --delete
echo "$(date)" >"$1/Other"/lastBackedUp.txt

if [ ! -d "$1/Startup" ]; then mkdir "$1/Startup"; fi
rsync -av ~"/.config/autostart/" "$1/Startup" --delete
echo "$(date)" >"$1/Startup"/lastBackedUp.txt
