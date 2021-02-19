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
  "Spotify"
  "Google"
  "iPhone"
  "School Emails"
  "Discord"
  "PS4"
)
select option in "${options[@]}"; do
  case "$option" in
  "Local Files")
    "$HERE"/VariousFileCopying/VariousFileCopying.sh "$MAINDIR/Backups"
    ;;
  "NUC Files")
    "$HERE"/SFTPBackup/SFTPBackup.sh -d "user@home.example.com" "9999" ~/"{*.sh,.bashrc,*.yml}" "$MAINDIR/Backups/NUCFiles"
    ;;
  "Cloud Files")
    "$HERE"/SFTPBackup/SFTPBackup.sh -d "root@example.com" "22" "/lib/systemd/system/imranr_*" "$MAINDIR/Backups/CloudFiles"
    ;;
  "Ryerson Moon")
    "$HERE"/SFTPBackup/SFTPBackup.sh -d "iremtull@moon.cs.ryerson.ca" "22" "." "$MAINDIR/Ryerson/Moon"
    ;;
  "Reddit - WebNinja98")
    "$HERE"/Reddit/Reddit.sh "Webninja98" "$MAINDIR/Backups/Reddit"
    ;;
  "Reddit - ImranR98")
    "$HERE"/Reddit/Reddit.sh "ImranR98" "$MAINDIR/Backups/Reddit"
    ;;
  "Notion")
    "$HERE"/ExtractZips/ExtractZips.sh -d "$(find "$ZIPSDIR/" | grep Export-.*.zip$)" "$MAINDIR/Backups/Notion"
    ;;
  "Balance")
    "$HERE"/Balance/Balance.sh "$(echo "$MAINDIR/Backups/Notion"/Acc*)" "$MAINDIR/Documents/Balance"
    ;;
  "Medium")
    "$HERE"/ExtractZips/ExtractZips.sh -d "$(find "$ZIPSDIR/" | grep medium-export.zip$)" "$MAINDIR/Backups/Medium"
    ;;
  "Twitter")
    "$HERE"/ExtractZips/ExtractZips.sh -d "$(find "$ZIPSDIR/" | grep twitter.*.zip$)" "$MAINDIR/Backups/Twitter"
    ;;
  "Spotify")
    "$HERE"/ExtractZips/ExtractZips.sh -d "$(find "$ZIPSDIR/" | grep my_spotify_data.zip$)" "$MAINDIR/Backups/Spotify"
    ;;
  "Google")
    "$HERE"/ExtractZips/ExtractZips.sh -d "$(ls "$ZIPSDIR" | grep takeout-.*.zip$)" "$MAINDIR/Backups/Google Takeout"
    ;;
  "iPhone")
    echo "This is not automated. Copy the folder manually from Windows."
    ;;
  "School Emails")
    echo "This is not automated. Export the .pst files manually using Outlook."
    ;;
  "Discord")
    "$HERE"/Discord/Discord.sh "$MAINDIR/Backups/Discord" ~/"DiscordChatExporter.CLI"
    ;;
  "PS4")
    "$HERE"/PS4/PS4.sh "$ps4" "$MAINDIR/Backups/PS4Saves" "$MAINDIR/Media/Unsorted-PS4Media"
    ;;
  *)
    echo "
$REPLY is not an option. Bye!"
    break
    ;;
  esac
done
