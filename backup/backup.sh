#!/bin/bash
# Backup files from various sources manually
# Run from within WSL

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/variables.sh

while [ true ]; do

  echo "============="
  echo "ImranR Backup"
  echo "============="
  echo "Pick an option:"
  echo ""
  echo "1 - Various File Copying"
  echo "2 - NUC - Various File Copying"
  echo "3 - Ryerson Moon"
  echo "4 - Cloud - Various File Copying"
  echo "5 - Reddit - Webninja98"
  echo "6 - Reddit - ImranR98"
  echo "7 - Notion"
  echo "8 - Balance.xlsx"
  echo "9 - Medium"
  echo "10 - Twitter"
  echo "11 - Google Takeout"
  echo "12 - Apple Folder"
  echo "13 - School Emails"
  echo "14 - Discord"
  echo "15 - PS4 Saves & Media"
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
    "$HERE"/scripts/SFTPBackup.sh "$NUCUSERNAME"@"$NUCDOMAIN" "$NUCSSHPORT" "~/{*.sh,.bashrc,*.yml}" "$NUCFILESBACKUPDIR"
    ;;

  3)
    echo "==============================="
    echo "Ryerson Moon"
    "$HERE"/scripts/RyersonMoon.sh
    ;;

  4)
    echo "==============================="
    echo "Cloud - Various File Copying"
    "$HERE"/scripts/SFTPBackup.sh "$CLOUDSSH" "$CLOUDSSHPORT" ":/lib/systemd/system/imranr_*" "$CLOUDFILESBACKUPDIR"
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
    "$HERE"/scripts/Notion.sh -d "$(find "$DOWNLOADSDIR/" | grep Export-.*.zip$)" "$NOTIONBACKUPDIR"
    ;;

  8)
    echo "==============================="
    echo "Balance.xlsx"
    "$HERE"/scripts/balanceXLSX.sh "$(echo "$NOTIONBACKUPDIR"/Acc*)" "$BALANCEDIR"
    ;;

  9)
    echo "==============================="
    echo "Medium"
    "$HERE"/scripts/extractZips.sh -d "$(find "$DOWNLOADSDIR/" | grep medium-export.zip$)" "$MEDIUMBACKUPDIR"
    ;;

  10)
    echo "==============================="
    echo "Twitter"
    "$HERE"/scripts/extractZips.sh -d "$(find "$DOWNLOADSDIR/" | grep twitter.*.zip$)" "$TWITTERBACKUPDIR"
    ;;

  11)
    echo "==============================="
    echo "Google Takeout"
    "$HERE"/scripts/extractZips.sh -d "$(ls "$DOWNLOADSDIR" | grep takeout-.*.zip$)" "$GOOGLETAKEOOUTBACKUPDIR"
    ;;

  12)
    echo "==============================="
    echo "Apple Folder"
    echo "No manual backup for this. Copy the folder manually from Windows."
    ;;

  13)
    echo "==============================="
    echo "School Emails"
    echo "This is not automated. Export the .pst files manually using Outlook."
    ;;

  14)
    echo "==============================="
    echo "Discord"
    "$HERE"/scripts/Discord.sh "$DISCORDBACKUPDIR" "$DISCORDCHATEXPORTERCLIDIR"
    ;;

  15)
    echo "==============================="
    echo "PS4 Saves & Media"
    echo "Enter the path to the 'PS4' directory:"
    read ps4
    "$HERE"/scripts/PS4.sh "$ps4" "$PS4SAVESBACKUPDIR" "$PS4UNSORTEDMEDIADIR"
    ;;

  *)
    exit
    ;;
  esac
  echo ""
done
