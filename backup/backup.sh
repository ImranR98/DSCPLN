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
echo "3 - Reddit - Webninja98"
echo "4 - Reddit - ImranR98"
echo "5 - Notion"
echo "6 - Balance.xlsx"
echo "7 - Medium"
echo "8 - Google Takeout"
echo "9 - WhatsApp"
echo "10 - School Emails"
echo "11 - Discord"
echo "12 - PS4 Saves & Media"
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
  echo "Reddit - Webninja98"
  "$HERE"/scripts/redditBackup.sh Webninja98
  ;;

4) 
  echo "==============================="
  echo "Reddit - ImranR98"
  "$HERE"/scripts/redditBackup.sh ImranR98
  ;;

5)
  echo "==============================="
  echo "Notion"
  "$HERE"/scripts/Notion.sh
  ;;

6)
  echo "==============================="
  echo "Balance.xlsx"
  "$HERE"/scripts/balanceXLSX.sh
  ;;

7)
  echo "==============================="
  echo "Medium"
  "$HERE"/scripts/Medium.sh
  ;;

8)
  echo "==============================="
  echo "Google Takeout"
  "$HERE"/scripts/googleTakeout.sh
  ;;

9)
  echo "==============================="
  echo "WhatsApp"
  "$HERE"/scripts/WhatsApp.sh
  ;;

10)
  echo "==============================="
  echo "School Emails"
  echo "This is not automated. Export the .pst files manually using Outlook."
  ;;

11)
  echo "==============================="
  echo "Discord"
  echo "This is not automated. Export the desired channels manually using DiscordChatExporter."
  ;;

12)
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