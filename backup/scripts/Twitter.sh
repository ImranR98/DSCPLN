#!/bin/bash
# Prompts for confirmation unless --nowait is provided as an argument

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../variables.sh
if [ -z "$TWITTERBACKUPDIR" ] || [ -z "$DOWNLOADSDIR" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$DOWNLOADSDIR" ]; then
    echo "Some directories from ../variables.sh are missing!"
    exit
fi

if [ ! "$1" = '--nowait' ]; then
	echo "Export your Twitter data and download it when ready."
	echo "After download is complete, press enter. To cancel, type 0 then press enter (run this command with --nowait to avoid this prompt). Waiting..."
	read choice
else
	choice=1
fi

if [ "$choice" = 0 ]; then
	exit
fi
exportfile=$(find "$DOWNLOADSDIR/" | grep twitter.*.zip$)
if [ ! -z "$exportfile" ]; then
	echo "$exportfile" | while read -r line ; do
    	unzip -o "$line" -d "$DOWNLOADSDIR/Twitter"
		rm "$line"
	done
	node "$HERE"/renameFilesEndingWithDot.js "$DOWNLOADSDIR/Twitter"
	if [ ! -d "$TWITTERBACKUPDIR" ]; then
		mkdir "$TWITTERBACKUPDIR"
	fi
	rsync -av "$DOWNLOADSDIR/Twitter/" "$TWITTERBACKUPDIR" --delete
	echo "$(date)" > "$TWITTERBACKUPDIR"/lastBackedUp.txt
	rm -rf "$DOWNLOADSDIR/Twitter"
else
	echo "No export zip found."
	exit
fi