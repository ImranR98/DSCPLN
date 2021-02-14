#!/bin/bash

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

MAINDIR=~/"Main"
ZIPSDIR=~/"Downloads"

echo "ImranR Backup"

PS3="
Pick an option: "
options=(
  "Local Files"
  "NUC Files"
  "Cloud Files"
  "Ryerson Moon"
  "Reddit - WebNinja98"
  "Reddit - ImranR98"
  "Notion"
  "Balance"
  "Medium"
  "Twitter"
  "Google"
  "iPhone"
  "School Emails"
  "Discord"
  "PS4"
)
select option in "${options[@]}"; do
  case "$option" in
  "Local Files")
    "$HERE"/scripts/variousFileCopying.sh "$MAINDIR/Backups"
    ;;
  "NUC Files")
    "$HERE"/scripts/SFTPBackup.sh -d "user@home.example.com" "9999" ~/"{*.sh,.bashrc,*.yml}" "$MAINDIR/Backups/NUCFiles"
    ;;
  "Cloud Files")
    "$HERE"/scripts/SFTPBackup.sh -d "root@example.com" "22" ":/lib/systemd/system/imranr_*" "$MAINDIR/Backups/CloudFiles"
    ;;
  "Ryerson Moon")
    "$HERE"/scripts/SFTPBackup.sh -d "iremtull@moon.cs.ryerson.ca" "22" "." "$MAINDIR/Ryerson/Moon"
    ;;
  "Reddit - WebNinja98")
    "$HERE"/scripts/redditBackup.sh "Webninja98" "$MAINDIR/Backups/Reddit"
    ;;
  "Reddit - ImranR98")
    "$HERE"/scripts/redditBackup.sh "ImranR98" "$MAINDIR/Backups/Reddit"
    ;;
  "Notion")
    "$HERE"/scripts/extractZips.sh -d "$(find "$ZIPSDIR/" | grep Export-.*.zip$)" "$MAINDIR/Backups/Notion"
    ;;
  "Balance")
    "$HERE"/scripts/balanceXLSX.sh "$(echo "$MAINDIR/Backups/Notion"/Acc*)" "$MAINDIR/Documents/Balance"
    ;;
  "Medium")
    "$HERE"/scripts/extractZips.sh -d "$(find "$ZIPSDIR/" | grep medium-export.zip$)" "$MAINDIR/Backups/Medium"
    ;;
  "Twitter")
    "$HERE"/scripts/extractZips.sh -d "$(find "$ZIPSDIR/" | grep twitter.*.zip$)" "$MAINDIR/Backups/Twitter"
    ;;
  "Google")
    "$HERE"/scripts/extractZips.sh -d "$(ls "$ZIPSDIR" | grep takeout-.*.zip$)" "$MAINDIR/Backups/Google Takeout"
    ;;
  "iPhone")
    echo "This is not automated. Copy the folder manually from Windows."
    ;;
  "School Emails")
    echo "This is not automated. Export the .pst files manually using Outlook."
    ;;
  "Discord")
    "$HERE"/scripts/Discord.sh "$MAINDIR/Backups/Discord" ~/"DiscordChatExporter.CLI"
    ;;
  "PS4")
    "$HERE"/scripts/PS4.sh "$ps4" "$MAINDIR/Backups/PS4Saves" "$MAINDIR/Media/Unsorted-PS4Media"
    ;;
  *)
    echo "
$REPLY is not an option. Bye!"
    break
    ;;
  esac
done
