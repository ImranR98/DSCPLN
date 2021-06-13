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
  "VPS Files"
  "Ryerson Moon"
  "Reddit - WebNinja98"
  "Reddit - ImranR98"
  "Notion"
  "Balance"
  "Medium"
  "Twitter"
  "Spotify"
  "Google"
  "Podcasts"
  "iPhone"
  "School Emails"
  "Discord"
  "PS4"
)
while [ true ]; do
  select option in "${options[@]}"; do
    case "$option" in
    "Local Files")
      "$HERE"/VariousFileCopying/VariousFileCopying.sh "$MAINDIR/Backups"
      break
      ;;
    "NUC Files")
      "$HERE"/SFTPBackup/SFTPBackup.sh -d "user@home.example.com" "9999" ~/"{*.sh,.bashrc,*.yml}" "$MAINDIR/Backups/NUCFiles"
      break
      ;;
    "VPS Files")
      "$HERE"/SFTPBackup/SFTPBackup.sh -d "user@vps.example.com" "22" "/lib/systemd/system/imranr_*" "$MAINDIR/Backups/VPSFiles"
      break
      ;;
    "Ryerson Moon")
      "$HERE"/SFTPBackup/SFTPBackup.sh -d "iremtull@moon.cs.ryerson.ca" "22" "." "$MAINDIR/Career/Ryerson/Moon"
      break
      ;;
    "Reddit - WebNinja98")
      "$HERE"/Reddit/Reddit.sh "Webninja98" "$MAINDIR/Backups/Reddit"
      break
      ;;
    "Reddit - ImranR98")
      "$HERE"/Reddit/Reddit.sh "ImranR98" "$MAINDIR/Backups/Reddit"
      break
      ;;
    "Notion")
      "$HERE"/ExtractZips/ExtractZips.sh -dg "$(find "$ZIPSDIR/" | grep Export-.*.zip$)" "$MAINDIR/Backups/Notion"
      break
      ;;
    "Balance")
      "$HERE"/Balance/Balance.sh "$(echo "$MAINDIR/Backups/Notion"/Acc*)" "$MAINDIR/Documents/Balance"
      break
      ;;
    "Medium")
      "$HERE"/ExtractZips/ExtractZips.sh -dg "$(find "$ZIPSDIR/" | grep medium-export.zip$)" "$MAINDIR/Backups/Medium"
      break
      ;;
    "Twitter")
      "$HERE"/ExtractZips/ExtractZips.sh -dg "$(find "$ZIPSDIR/" | grep twitter.*.zip$)" "$MAINDIR/Backups/Twitter"
      break
      ;;
    "Spotify")
      "$HERE"/ExtractZips/ExtractZips.sh -dg "$(find "$ZIPSDIR/" | grep my_spotify_data.zip$)" "$MAINDIR/Backups/Spotify"
      break
      ;;
    "Google")
      "$HERE"/ExtractZips/ExtractZips.sh -d "$(find "$ZIPSDIR" | grep takeout-.*.zip$)" "$MAINDIR/Backups/Google Takeout"
      break
      ;;
    "Podcasts")
      echo "This is not automated. Export the .opml file manually."
      break
      ;;
    "iPhone")
      echo "This is not automated. Copy the folder manually from Windows."
      break
      ;;
    "School Emails")
      echo "This is not automated. Export the .pst files manually using Outlook."
      break
      ;;
    "Discord")
      "$HERE"/Discord/Discord.sh ~/"DiscordChatExporter.CLI" "$MAINDIR/Backups/Discord"
      break
      ;;
    "PS4")
      "$HERE"/PS4/PS4.sh "$ps4" "$MAINDIR/Backups/PS4Saves" "$MAINDIR/Media/Unsorted-PS4Media"
      break
      ;;
    *)
      echo "Do you see '$REPLY' in the options? FOCUS."
      break
      ;;
    esac
  done
  echo ''
done
