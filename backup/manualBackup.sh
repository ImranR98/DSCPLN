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
echo "3 - MySeneca Email"
echo "4 - WhatsApp"
echo "5 - Seneca Matrix"
echo "6 - Reddit"
echo "7 - PS4 Saves"
echo "8 - Backup to Hard Drive"
echo "9 - Copy VMs"
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
  echo "MySeneca Email"
  echo "==============================="
  echo "No automation available."
  echo "Get new email in thunderbird, then export to the Backup folder."
  echo "==============================="
  ;;

4)
  echo "==============================="
  echo "WhatsApp"
  "$HERE"/scripts/WhatsApp.sh
  ;;

5)
  echo "==============================="
  echo "Seneca Matrix"
  "$HERE"/scripts/SenecaMatrix.sh --nowait
  ;;

6)
  echo "==============================="
  echo "Reddit"
  "$HERE"/scripts/redditBackup.sh
  ;;

7)
  echo "==============================="
  echo "PS4 Saves"
  "$HERE"/scripts/PS4SavesCopy.sh
  ;;

8)
  echo "==============================="
  echo "Backup to Hard Drive"
  "$HERE"/scripts/backupToHardDrive.sh
  ;;

9)
  echo "==============================="
  echo "Copy VMs"
  "$HERE"/scripts/copyVMs.sh
  ;;

*)
  exit
  ;;
esac