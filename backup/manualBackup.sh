#!/bin/bash
# Backup files from various sources manually

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../variables.sh
if [ -z "$SCHOOL" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$SCHOOL" ]; then
    echo "Some directories from variables.sh are missing!"
    exit
fi

echo "============="
echo "ImranR Backup"
echo "============="
echo "Pick an option:"
echo ""
echo "1 - Google Takeout"
echo "2 - Balance.xlsx"
echo "3 - NextCloud"
echo "4 - MySeneca Email"
echo "5 - WhatsApp"
echo "6 - Seneca Matrix"
echo "7 - Reddit"
echo "8 - PS4 Saves"
echo "9 - Backup to Hard Drive"
echo "10 - Copy VMs"
echo ""
echo "Anything else - exit"
echo ""
echo "Enter an option number now:"
read choice

case $choice in

1)
  echo "==============================="
  echo "Google Takeout"
  "$HERE"/scripts/googleTakeout.sh
  ;;

2)
  echo "==============================="
  echo "Balance.xlsx"
  "$HERE"/scripts/balanceXLSX.sh
  ;;

3)
  echo "==============================="
  echo "NextCloud"
  "$HERE"/scripts/nextCloud.sh
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
  echo "Seneca Matrix"
  "$HERE"/scripts/SenecaMatrix.sh --nowait
  ;;

7)
  echo "==============================="
  echo "Reddit"
  "$HERE"/scripts/redditBackup.sh
  ;;

8)
  echo "==============================="
  echo "PS4 Saves"
  "$HERE"/scripts/PS4SavesCopy.sh
  ;;

9)
  echo "==============================="
  echo "Backup to Hard Drive"
  "$HERE"/scripts/backupToHardDrive.sh
  ;;

10)
  echo "==============================="
  echo "Copy VMs"
  "$HERE"/scripts/copyVMs.sh
  ;;

*)
  exit
  ;;
esac