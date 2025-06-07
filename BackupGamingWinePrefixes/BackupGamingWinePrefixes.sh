#!/bin/bash
set -e

# If "$1" is a directory containing a bunch of Wine prefixes used for gaming,
# And "$2" is an existing folder that game saves need to be backed up to,
# This script will back up the home directories of all the Wine prefixes the the backup folder
# The existence of the 'steamuser' home directory indicates the prefix is used for gaming
# The thinking behind this script is that the home directory would contain the save files
# And any other random Windows files would be of negligible size
# So this is a good-enough generic way to back up saves for any Windows-Game-on-Linux without game-specific code

if [ ! -d "$1" ]; then
    echo "No valid Games directory specified!" >&2
    exit 1
fi

if [ ! -d "$2" ]; then
    mkdir -p "$2"
fi

CURRENT_DIR="$(pwd)"
TMP_DIR="$(mktemp -d)"
trap 'cd "$CURRENT_DIR"; rm -rf "$TMP_DIR";' EXIT

cd "$1"

for dir in *; do
    if [ -d ./"$dir"/drive_c/users/steamuser/ ]; then
        GAME_NAME="$(basename "$dir")"
        BACKUP_PATH="$TMP_DIR/${GAME_NAME} (Wine prefix home dir)"
        mkdir "$BACKUP_PATH"
        rsync -a ./"$dir"/drive_c/users/steamuser/ "$BACKUP_PATH/"
        echo "$(date)" > "$BACKUP_PATH/lastBackedUp.txt"
    else
        echo "WARNING: DIR IS NOT A WINE PREFIX WITH a 'steamuser' USER. SKIPPING: $dir" >&2
    fi
done

rsync -a "$TMP_DIR/" "$2/"