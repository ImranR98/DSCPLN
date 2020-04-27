#!/bin/bash
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../../variables.sh
if [ -z "$BACKUPS" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$BACKUPS" ]; then
    echo "Some directories from variables.sh are missing!"
    exit
fi

FFFOLDER=$(ls ~/.mozilla/firefox/ | grep ".default-release$")
if [ ! -z "$FFFOLDER" ]; then
	if [ -f ~/.mozilla/firefox/"$FFFOLDER"/bookmarks.html ]; then
        cp -v ~/.mozilla/firefox/"$FFFOLDER"/bookmarks.html "$BACKUPS"
    else
        echo "No bookmarks.html found."
    fi
else
    echo "Firefox folder not found!"
fi