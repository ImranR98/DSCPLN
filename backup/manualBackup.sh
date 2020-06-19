#!/bin/bash
# Backup files from various sources manually

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

while [ true ]; do

echo "============="
echo "ImranR Backup"
echo "============="
echo "Pick an option:"
echo ""
echo "1 - MarkD"
echo "2 - Balance.xlsx"
echo "3 - Seneca Matrix"
echo "4 - Firefox Bookmarks"
echo "5 - Reddit"
echo "6 - MySeneca Email"
echo "7 - WhatsApp"
echo "8 - Google Takeout"
echo "9 - Copy VMs"
echo "10 - PS4 Saves"
echo "11 - Backup to Hard Drive"
echo ""
echo "Anything else - exit"
echo ""
echo "Enter an option number now:"
read choice

case $choice in

1)
  echo "==============================="
  echo "MarkD"
  "$HERE"/scripts/markd.sh
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
  echo "Firefox Bookmarks"
  "$HERE"/scripts/firefoxBookmarks.sh
  ;;

5)
  echo "==============================="
  echo "Reddit"
  "$HERE"/scripts/redditBackup.sh
  ;;

6)
  echo "==============================="
  echo "MySeneca Email"
  echo "==============================="
  echo "No automation available."
  echo "Open email in outlook (in a Windows VM), then export to the Backup folder in .pst."
  echo "==============================="
  ;;

7)
  echo "==============================="
  echo "WhatsApp"
  "$HERE"/scripts/WhatsApp.sh
  ;;

8)
  echo "==============================="
  echo "Google Takeout"
  "$HERE"/scripts/googleTakeout.sh
  ;;

9)
  echo "==============================="
  echo "Copy VMs"
  "$HERE"/scripts/copyVMs.sh
  ;;

10)
  echo "==============================="
  echo "PS4 Saves"
  "$HERE"/scripts/PS4SavesCopy.sh
  ;;

11)
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