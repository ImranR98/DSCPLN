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
echo "2 - NUC - Various File Copying"
echo "3 - Ryerson Moon"
echo "4 - Cloud Systemctl Service Files"
echo "5 - Reddit - Webninja98"
echo "6 - Reddit - ImranR98"
echo "7 - Notion"
echo "8 - Balance.xlsx"
echo "9 - Medium"
echo "10 - Google Takeout"
echo "11 - Apple Folder"
echo "12 - School Emails"
echo "13 - Discord"
echo "14 - PS4 Saves & Media"
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
  echo "NUC - Various File Copying"
  "$HERE"/scripts/NUCFiles.sh
  ;;

3)
  echo "==============================="
  echo "Ryerson Moon"
  "$HERE"/scripts/RyersonMoon.sh
  ;;

4)
  echo "==============================="
  echo "Cloud Systemctl Service Files"
  "$HERE"/scripts/imranrdevsystemctl.sh
  ;;

5) 
  echo "==============================="
  echo "Reddit - Webninja98"
  "$HERE"/scripts/redditBackup.sh Webninja98
  ;;

6) 
  echo "==============================="
  echo "Reddit - ImranR98"
  "$HERE"/scripts/redditBackup.sh ImranR98
  ;;

7)
  echo "==============================="
  echo "Notion"
  "$HERE"/scripts/Notion.sh
  ;;

8)
  echo "==============================="
  echo "Balance.xlsx"
  "$HERE"/scripts/balanceXLSX.sh
  ;;

9)
  echo "==============================="
  echo "Medium"
  "$HERE"/scripts/Medium.sh
  ;;

10)
  echo "==============================="
  echo "Google Takeout"
  "$HERE"/scripts/googleTakeout.sh
  ;;

11)
  echo "==============================="
  echo "Apple Folder"
  echo "No manual backup for this. Copy the folder manually from Windows."
  ;;

12)
  echo "==============================="
  echo "School Emails"
  echo "This is not automated. Export the .pst files manually using Outlook."
  ;;

13)
  echo "==============================="
  echo "Discord"
  "$HERE"/scripts/Discord.sh
  ;;

14)
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