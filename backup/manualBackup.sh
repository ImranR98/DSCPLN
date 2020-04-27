#!/bin/bash
# Backup files from various sources manually

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

while [ true ]; do

echo "============="
echo "ImranR Backup"
echo "============="
echo "Pick an option:"
echo ""
echo "1 - NextCloud"
echo "2 - Balance.xlsx"
echo "3 - Seneca Matrix"
echo "4 - MySeneca Email"
echo "5 - WhatsApp"
echo "6 - Firefox Bookmarks"
echo "7 - Reddit"
echo "8 - Google Takeout"
echo "9 - PS4 Saves"
echo "10 - Backup to Hard Drive"
echo "11 - Copy VMs"
echo ""
echo "Anything else - exit"
echo ""
echo "Enter an option number now:"
read choice

case $choice in

1)
  echo "==============================="
  echo "NextCloud"
  "$HERE"/scripts/nextCloud.sh
  ;;

2)
  echo "==============================="
  echo "Balance.xlsx"
  "$HERE"/scripts/balanceXLSX.sh
  ;;

3)
  echo "==============================="
  echo "Seneca Matrix"
  "$HERE"/scripts/SenecaMatrix.sh --nowait
  ;;

4)
  echo "==============================="
  echo "MySeneca Email"
  echo "==============================="
  echo "No automation available."
  echo "Get new email in thunderbird, then export to the Backup folder."
  echo "==============================="
  ;;

5)
  echo "==============================="
  echo "WhatsApp"
  "$HERE"/scripts/WhatsApp.sh
  ;;

6)
  echo "==============================="
  echo "Firefox Bookmarks"
  "$HERE"/scripts/firefoxBookmarks.sh
  ;;

7)
  echo "==============================="
  echo "Reddit"
  "$HERE"/scripts/redditBackup.sh
  ;;

8)
  echo "==============================="
  echo "Google Takeout"
  "$HERE"/scripts/googleTakeout.sh
  ;;

9)
  echo "==============================="
  echo "PS4 Saves"
  "$HERE"/scripts/PS4SavesCopy.sh
  ;;

10)
  echo "==============================="
  echo "Backup to Hard Drive"
  "$HERE"/scripts/backupToHardDrive.sh
  ;;

11)
  echo "==============================="
  echo "Copy VMs"
  "$HERE"/scripts/copyVMs.sh
  ;;

*)
  exit
  ;;
esac
echo ""
done