#!/bin/bash
# Prompts for confirmation unless --nowait is provided as an argument

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../../variables.sh
if [ -z "$BACKUPS" ] || [ -z "$DOCUMENTS" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$BACKUPS" ] || [ ! -d "$DOCUMENTS" ]; then
    echo "Some directories from variables.sh are missing!"
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
takeoutfile=$(find ~/Downloads | grep takeout-.*.zip$)
if [ ! -z "$takeoutfile" ]; then
	echo "$takeoutfile" | while read -r line ; do
    	unzip -o "$line" -d ~/Downloads/
		rm "$line"
	done
	downloads=~/Downloads
	node "$HERE"/renameFilesEndingWithDot.js $downloads'/Takeout'
	if [ ! -d "$BACKUPS"/'Google Takeout' ]; then
		mkdir "$BACKUPS"/'Google Takeout'
	fi
	rsync -av ~/Downloads/Takeout/ "$BACKUPS"/'Google Takeout' --delete
	echo "$(date)" >"$BACKUPS"/'Google Takeout'/lastBackedUp.txt
	rm -rf ~/Downloads/Takeout
else
	echo "No takeout zip found."
	exit
fi