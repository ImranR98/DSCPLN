#!/bin/bash
# Prompts for confirmation unless --nowait is provided as an argument

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../variables.sh
if [ -z "$PCBACKUPS" ] || [ -z "$PCDOCUMENTS" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$PCBACKUPS" ] || [ ! -d "$PCDOCUMENTS" ]; then
    echo "Some directories from ../variables.sh are missing!"
    exit
fi

if [ ! "$1" = '--nowait' ]; then
	echo "Create a 'Markdown/CSV' backup from Notion and download it when ready."
	echo "After download is complete, press enter. To cancel, type 0 then press enter (run this command with --nowait to avoid this prompt). Waiting..."
	read choice
else
	choice=1
fi

if [ "$choice" = 0 ]; then
	exit
fi
exportfile=$(find "$PCHOME/Downloads/" | grep Export-.*.zip$)
if [ ! -z "$exportfile" ]; then
	echo "$exportfile" | while read -r line ; do
    	unzip -o "$line" -d "$PCHOME/Downloads/Notion"
		rm "$line"
	done
	node "$HERE"/renameFilesEndingWithDot.js "$PCHOME/Downloads/Notion"
	if [ ! -d "$PCBACKUPS"/'Notion' ]; then
		mkdir "$PCBACKUPS"/'Notion'
	fi
	rsync -av "$PCHOME/Downloads/Notion/" "$PCBACKUPS"/'Notion' --delete
	echo "$(date)" >"$PCBACKUPS"/'Notion'/lastBackedUp.txt
	rm -rf "$PCHOME/Downloads/Notion"
else
	echo "No export zip found."
	exit
fi