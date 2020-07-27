#!/bin/bash
# Prompts for confirmation unless --nowait is provided as an argument

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../../variables.sh
if [ -z "$PCBACKUPS" ] || [ -z "$PCDOCUMENTS" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$PCBACKUPS" ] || [ ! -d "$PCDOCUMENTS" ]; then
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
takeoutfile=$(find '/mnt/c/Users/Imran Remtulla/Downloads' | grep takeout-.*.zip$)
if [ ! -z "$takeoutfile" ]; then
	echo "$takeoutfile" | while read -r line ; do
    	unzip -o "$line" -d '/mnt/c/Users/Imran Remtulla/Downloads/'
		rm "$line"
	done
	node "$HERE"/renameFilesEndingWithDot.js '/mnt/c/Users/Imran Remtulla/Downloads/Takeout'
	if [ ! -d "$PCBACKUPS"/'Google Takeout' ]; then
		mkdir "$PCBACKUPS"/'Google Takeout'
	fi
	rsync -av '/mnt/c/Users/Imran Remtulla/Downloads/Takeout/' "$PCBACKUPS"/'Google Takeout' --delete
	echo "$(date)" >"$PCBACKUPS"/'Google Takeout'/lastBackedUp.txt
	rm -rf '/mnt/c/Users/Imran Remtulla/Downloads/Takeout'
else
	echo "No takeout zip found."
	exit
fi