#!/bin/bash
# Backup files from various sources manually

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

while [ true ]; do

echo "============="
echo "ImranR Backup"
echo "============="
echo "Pick an option:"
echo ""
echo "1 - Deck"
echo "2 - Notes"
echo "3 - Balance.xlsx"
echo "4 - Seneca Matrix"
echo "5 - Firefox Bookmarks"
echo "6 - Reddit"
echo "7 - MySeneca Email"
echo "8 - WhatsApp"
echo "9 - Google Takeout"
echo "10 - Copy VMs"
echo "11 - PS4 Saves"
echo "12 - Backup to Hard Drive"
echo ""
echo "Anything else - exit"
echo ""
echo "Enter an option number now:"
read choice

case $choice in

1)
  echo "==============================="
  echo "Deck"
  "$HERE"/scripts/deck.sh
  ;;

2)
  echo "==============================="
  echo "Notes"
  "$HERE"/scripts/notes.sh
  ;;

3)
  echo "==============================="
  echo "Balance.xlsx"
  "$HERE"/scripts/balanceXLSX.sh
  ;;

4)
  echo "==============================="
  echo "Seneca Matrix"
  "$HERE"/scripts/SenecaMatrix.sh --nowait
  ;;

5)
  echo "==============================="
  echo "Firefox Bookmarks"
  "$HERE"/scripts/firefoxBookmarks.sh
  ;;

6)
  echo "==============================="
  echo "Reddit"
  "$HERE"/scripts/redditBackup.sh
  ;;

7)
  echo "==============================="
  echo "MySeneca Email"
  echo "==============================="
  echo "No automation available."
  echo "Get new email in thunderbird, then export to the Backup folder."
  echo "==============================="
  ;;

8)
  echo "==============================="
  echo "WhatsApp"
  "$HERE"/scripts/WhatsApp.sh
  ;;

9)
  echo "==============================="
  echo "Google Takeout"
  "$HERE"/scripts/googleTakeout.sh
  ;;

10)
  echo "==============================="
  echo "Copy VMs"
  "$HERE"/scripts/copyVMs.sh
  ;;

11)
  echo "==============================="
  echo "PS4 Saves"
  "$HERE"/scripts/PS4SavesCopy.sh
  ;;

12)
  echo "==============================="
  echo "Backup to Hard Drive"
  "$HERE"/scripts/backupToHardDrive.sh
  ;;

*)
  exit
  ;;
esac
echo ""
done