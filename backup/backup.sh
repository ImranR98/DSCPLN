#!/bin/bash
# Backup files from various sources manually
# Run from within WSL

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

while [ true ]; do

echo "============="
echo "ImranR Backup"
echo "============="
echo "Pick an option:"
echo ""
echo "1 - Notion"
echo "2 - Balance.xlsx"
echo "3 - Various File Copying"
echo "4 - Reddit"
echo "5 - MySeneca Email"
echo "6 - WhatsApp"
echo "7 - Google Takeout"
echo "8 - PS4 Saves & Media"
echo ""
echo "Anything else - exit"
echo ""
echo "Enter an option number now:"
read choice

case $choice in

1)
  echo "==============================="
  echo "Notion"
  "$HERE"/scripts/Notion.sh
  ;;

2)
  echo "==============================="
  echo "Balance.xlsx"
  "$HERE"/scripts/balanceXLSX.sh
  ;;

3)
  echo "==============================="
  echo "Various File Copying"
  "$HERE"/scripts/variousFileCopying.sh
  ;;

4) 
  echo "==============================="
  echo "Reddit"
  "$HERE"/scripts/redditBackup.sh
  ;;

5)
  echo "==============================="
  echo "MySeneca Email"
  echo "==============================="
  echo "No automation available."
  echo "Open email account in Outlook, then export to the Backup folder in .pst."
  echo "==============================="
  ;;

6)
  echo "==============================="
  echo "WhatsApp"
  "$HERE"/scripts/WhatsApp.sh
  ;;

7)
  echo "==============================="
  echo "Google Takeout"
  "$HERE"/scripts/googleTakeout.sh
  ;;

8)
  echo "==============================="
  echo "PS4 Saves & Media"
  "$HERE"/scripts/PS4.sh
  ;;

*)
  exit
  ;;
esac
echo ""
done