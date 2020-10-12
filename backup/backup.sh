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
echo "1 - Various File Copying"
echo "2 - Ryerson Moon"
echo "3 - Cloud Systemctl Service Files"
echo "4 - Reddit - Webninja98"
echo "5 - Reddit - ImranR98"
echo "6 - Notion"
echo "7 - Balance.xlsx"
echo "8 - Medium"
echo "9 - Google Takeout"
echo "10 - WhatsApp"
echo "11 - School Emails"
echo "12 - Discord"
echo "13 - PS4 Saves & Media"
echo ""
echo "Anything else - exit"
echo ""
echo "Enter an option number now:"
read choice

case $choice in

1)
  echo "==============================="
  echo "Various File Copying"
  "$HERE"/scripts/variousFileCopying.sh
  ;;

2)
  echo "==============================="
  echo "Ryerson Moon"
  "$HERE"/scripts/RyersonMoon.sh
  ;;

3)
  echo "==============================="
  echo "Cloud Systemctl Service Files"
  "$HERE"/scripts/imranrdevsystemctl.sh
  ;;

4) 
  echo "==============================="
  echo "Reddit - Webninja98"
  "$HERE"/scripts/redditBackup.sh Webninja98
  ;;

5) 
  echo "==============================="
  echo "Reddit - ImranR98"
  "$HERE"/scripts/redditBackup.sh ImranR98
  ;;

6)
  echo "==============================="
  echo "Notion"
  "$HERE"/scripts/Notion.sh
  ;;

7)
  echo "==============================="
  echo "Balance.xlsx"
  "$HERE"/scripts/balanceXLSX.sh
  ;;

8)
  echo "==============================="
  echo "Medium"
  "$HERE"/scripts/Medium.sh
  ;;

9)
  echo "==============================="
  echo "Google Takeout"
  "$HERE"/scripts/googleTakeout.sh
  ;;

10)
  echo "==============================="
  echo "WhatsApp"
  "$HERE"/scripts/WhatsApp.sh
  ;;

11)
  echo "==============================="
  echo "School Emails"
  echo "This is not automated. Export the .pst files manually using Outlook."
  ;;

12)
  echo "==============================="
  echo "Discord"
  "$HERE"/scripts/Discord.sh
  ;;

13)
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