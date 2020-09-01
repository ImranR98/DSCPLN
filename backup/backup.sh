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
echo "4 - Ryerson Moon"
echo "5 - Reddit"
echo "6 - Medium"
echo "7 - WhatsApp"
echo "8 - Google Takeout"
echo "9 - PS4 Saves & Media"
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
  echo "Ryerson Moon"
  "$HERE"/scripts/RyersonMoon.sh
  ;;

5) 
  echo "==============================="
  echo "Reddit"
  "$HERE"/scripts/redditBackup.sh
  ;;

6)
  echo "==============================="
  echo "Medium"
  "$HERE"/scripts/Medium.sh
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
  echo "PS4 Saves & Media"
  "$HERE"/scripts/PS4.sh
  ;;

*)
  exit
  ;;
esac
echo ""
done