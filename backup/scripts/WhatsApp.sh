#!/bin/bash

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../../variables.sh
if [ -z "$PCBACKUPS" ] || [ -z "$PCOTHER" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$PCBACKUPS" ] || [ ! -d "$PCOTHER" ]; then
    echo "Some directories from ../variables.sh are missing!"
    exit
fi

echo "When ready, enter the directory path containing the WhatsApp folder and press Enter:"
read mountpoint

if [ ! -z "$mountpoint" ]; then
  if [ -z "$(ls -a ~ | grep "^.tmp$")" ]; then
    mkdir ~/.tmp
  fi
  if [ ! -d "$PCBACKUPS"/WhatsApp ]; then
	  mkdir "$PCBACKUPS"/WhatsApp
  fi
  cp -rv "$mountpoint"/WhatsApp ~/.tmp
  rsync -av ~/.tmp/WhatsApp/ "$PCBACKUPS"/WhatsApp --delete
  echo "$(date)" > "$PCBACKUPS"/WhatsApp/lastBackedUp.txt
  rm -rf ~/.tmp/WhatsApp
  echo "WhatsApp backup done, running rsync to WhatsApp-AllMedia"
  if [ ! -d "$PCOTHER"/Museum/WhatsApp-AllMedia ]; then
	  echo "WhatsApp-AllMedia not found!"
  else
    rsync -av "$PCBACKUPS"/WhatsApp/ "$PCOTHER"/Museum/WhatsApp-AllMedia
  fi
  
fi