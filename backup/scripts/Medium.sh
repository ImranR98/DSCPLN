#!/bin/bash
# Prompts for confirmation unless --nowait is provided as an argument

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../variables.sh
if [ -z "$PCBACKUPS" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$PCBACKUPS" ]; then
    echo "Some directories from ../variables.sh are missing!"
    exit
fi

if [ ! "$1" = '--nowait' ]; then
	echo "Export your Medium data and download it when ready."
	echo "After download is complete, press enter. To cancel, type 0 then press enter (run this command with --nowait to avoid this prompt). Waiting..."
	read choice
else
	choice=1
fi

if [ "$choice" = 0 ]; then
	exit
fi
exportfile=$(find "$PCHOME/Downloads/" | grep medium-export.zip$)
if [ ! -z "$exportfile" ]; then
	echo "$exportfile" | while read -r line ; do
    	unzip -o "$line" -d "$PCHOME/Downloads/Medium"
		rm "$line"
	done
	node "$HERE"/renameFilesEndingWithDot.js "$PCHOME/Downloads/Medium"
	if [ ! -d "$PCBACKUPS"/'Medium' ]; then
		mkdir "$PCBACKUPS"/'Medium'
	fi
	rsync -av "$PCHOME/Downloads/Medium/" "$PCBACKUPS"/'Medium' --delete
	echo "$(date)" >"$PCBACKUPS"/'Medium'/lastBackedUp.txt
	rm -rf "$PCHOME/Downloads/Medium"
else
	echo "No export zip found."
	exit
fi