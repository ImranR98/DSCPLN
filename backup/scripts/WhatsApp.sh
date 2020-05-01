#!/bin/bash

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../../variables.sh
if [ -z "$BACKUPS" ] || [ -z "$OTHER" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$BACKUPS" ] || [ ! -d "$OTHER" ]; then
    echo "Some directories from variables.sh are missing!"
    exit
fi

echo "When ready, enter the directory path containing the WhatsApp folder and press Enter:"
read mountpoint

if [ ! -z "$mountpoint" ]; then
  if [ -z "$(ls -a ~ | grep "^.tmp$")" ]; then
    mkdir ~/.tmp
  fi
  if [ ! -d "$BACKUPS"/WhatsApp ]; then
	  mkdir "$BACKUPS"/WhatsApp
  fi
  cp -rv "$mountpoint"/WhatsApp ~/.tmp
  rsync -av ~/.tmp/WhatsApp/ "$BACKUPS"/WhatsApp --delete
  echo "$(date)" > "$BACKUPS"/WhatsApp/lastBackedUp.txt
  rm -rf ~/.tmp/WhatsApp
  echo "WhatsApp backup done, running rsync to WhatsApp-AllMedia"
  if [ ! -d "$OTHER"/WhatsApp-AllMedia ]; then
	  mkdir "$OTHER"/WhatsApp-AllMedia
  fi
  rsync -av "$BACKUPS"/WhatsApp/ "$OTHER"/WhatsApp-AllMedia
fi