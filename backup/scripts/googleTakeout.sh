#!/bin/bash
# Prompts for confirmation unless --nowait is provided as an argument

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../variables.sh
if [ -z "$GOOGLETAKEOOUTBACKUPDIR" ] || [ -z "$DOWNLOADSDIR" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$GOOGLETAKEOOUTBACKUPDIR" ] || [ ! -d "$DOWNLOADSDIR" ]; then
    echo "Some directories from ../variables.sh are missing!"
    exit
fi

if [ ! "$1" = '--nowait' ]; then
	echo "Order a takeout from takeout.google.com and download it when ready."
	echo "After download is complete, press enter. To cancel, type 0 then press enter (run this command with --nowait to avoid this prompt). Waiting..."
	read choice
else
	choice=1
fi

if [ "$choice" = 0 ]; then
	exit
fi
takeoutfile=$(ls "$DOWNLOADSDIR" | grep takeout-.*.zip$)
if [ ! -z "$takeoutfile" ]; then
	echo "$DOWNLOADSDIR/$takeoutfile" | while read -r line ; do
    	unzip -o "$line" -d "$DOWNLOADSDIR"
		rm "$line"
	done
	node "$HERE"/renameFilesEndingWithDot.js "$DOWNLOADSDIR/Takeout"
	if [ ! -d "$GOOGLETAKEOOUTBACKUPDIR" ]; then
		mkdir "$GOOGLETAKEOOUTBACKUPDIR"
	fi
	rsync -av "$DOWNLOADSDIR/Takeout/" "$GOOGLETAKEOOUTBACKUPDIR" --delete
	echo "$(date)" > "$GOOGLETAKEOOUTBACKUPDIR"/lastBackedUp.txt
	rm -rf "$DOWNLOADSDIR/Takeout"
else
	echo "No takeout zip found."
	exit
fi