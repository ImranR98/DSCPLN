#!/bin/bash

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

MAINDIR=~/"Main"
ZIPSDIR=~/"Downloads"

usage() {
    echo >&2 "Usage: $(basename $0) [-adpmoh]"
    echo >&2 "Run scripts to backup various things (with varying degrees of automation)."
    echo >&2 "   -a          Run all fully or mostly automated scripts."
    echo >&2 "   -d          Run all scripts that require some data to have been prepared in "$ZIPSDIR"."
    echo >&2 "   -p          Run all scripts that require a phone to be connected via USB."
    echo >&2 "   -m          Show prompts for all backup processes that must be done manually."
    echo >&2 "   -o          List all scripts not covered by other options."
    echo >&2 "After any options are executed, the user is asked to pick an individual script in a continuous loop."
    exit 1
}

localFiles() {
  "$HERE"/VariousFileCopying/VariousFileCopying.sh "$MAINDIR/Backups"
}

RyersonMoon() {
  "$HERE"/SFTPBackup/SFTPBackup.sh -d "iremtull@moon.cs.ryerson.ca" "22" "." "$MAINDIR/Postsecondary/Ryerson/Moon"
}

Reddit() {
  "$HERE"/ExtractZips/ExtractZips.sh -dg -n 'grep "account name," statistics.csv | tail -c +14 | head -c -2' "$(find "$ZIPSDIR/" | grep export_.*.zip$)" "$MAINDIR/Backups/Reddit"
}

balance() {
  "$HERE"/Balance/Balance.sh "$MAINDIR/Notes/Acc.md" "$MAINDIR/Documents/Balance"
}

Medium() {
  "$HERE"/ExtractZips/ExtractZips.sh -dg -n 'awk -F '"'"'<'"'"' '"'"'{ print $15 }'"'"' profile/profile.html | awk -F '"'"'>'"'"' '"'"'{ print $2 }'"'"' | awk NF | tail -c +2' "$(find "$ZIPSDIR/" | grep medium-export-.*.zip$)" "$MAINDIR/Backups/Medium"
}

Twitter() {
  "$HERE"/ExtractZips/ExtractZips.sh -dg -n 'grep -Eo "accountId\" : \".*\"" data/account.js | tail -c +15 | head -c -2' "$(find "$ZIPSDIR/" | grep twitter.*.zip$)" "$MAINDIR/Backups/Twitter"
}

Spotify() {
  "$HERE"/ExtractZips/ExtractZips.sh -dg "$(find "$ZIPSDIR/" | grep my_spotify_data.zip$)" "$MAINDIR/Backups/Spotify"
}

Google() {
  "$HERE"/ExtractZips/ExtractZips.sh -dg -n 'grep -Eo '"'"': ".*@'"'"' Takeout/Profile/Profile.json | head -1 | tail -c +4 | head -c -2' "$(find "$ZIPSDIR" | grep takeout-.*.zip$)" "$MAINDIR/Backups/Google"
}

WhatsApp() {
  DIRA=/run/user/1000/gvfs/*/Internal\ shared\ storage/Android/media/com.whatsapp/WhatsApp
  DIRB=~/Downloads/com.whatsapp/WhatsApp
  DIRC=~/Downloads/WhatsApp
  DIR="$DIRA"
  if [ ! -d "$DIR" ]; then DIR="$DIRB"; fi
  if [ ! -d "$DIR" ]; then DIR="$DIRC"; fi
  "$HERE"/WhatsApp/WhatsApp.sh "$DIR" "$MAINDIR/Backups/WhatsApp" "$MAINDIR/Museum/WhatsApp-AllMedia"
}

SeedVault() {
  "$HERE"/SeedVault/SeedVault.sh /run/user/1000/gvfs/*/Internal\ shared\ storage/ "$MAINDIR/Backups/Phone-SeedVault"
}

EteSync() {
  echo "No Automation. Export data from http://localhost:37358/.web/"
}

Bitwarden() {
  echo "This is not automated. Export manually via the app or extension (USE THE ENCRYPTED OPTION)."
}

xBrowserSync() {
  echo "This is not automated. Export manually via the extension."
}

emails() {
  echo "This is not automated. Use the Protonmail tool to export that, then use Outlook to expose the others."
}

podcasts() {
  echo "This is not automated. Export the .opml file manually."
}

RSS() {
  echo "This is not automated. Export the .opml file manually."
}

Discord() {
  "$HERE"/Discord/Discord.sh ~/"DiscordChatExporter.CLI" "$MAINDIR/Backups/Discord"
}

PS4() {
  DIR=~/Downloads/PS4
  USBS=/run/media/"$(whoami)"
  USB="$(ls "$USBS"/ | head -1)"
  if [ ! -z "$USB" ] && [ -d "$USBS"/"$USB"/PS4 ]; then
    DIR="$USBS"/"$USB"/PS4
  fi
  "$HERE"/PS4/PS4.sh "$DIR" "$MAINDIR/Backups/PS4Saves" "$MAINDIR/Media/Unsorted-PS4Media"
}

chooseScript() {
  PS3="
  Pick an option: "
  options=(
    "Local Files"
    "Ryerson Moon"
    "Reddit"
    "Balance"
    "Medium"
    "Twitter"
    "Spotify"
    "Google"
    "WhatsApp"
    "EteSync"
    "Bitwarden"
    "xBrowserSync"
    "Emails"
    "Podcasts"
    "RSS Feeds"
    "Discord"
    "PS4"
  )
  while [ true ]; do
    select option in "${options[@]}"; do
      case "$option" in
      "Local Files")
        localFiles
        break
        ;;
      "Ryerson Moon")
        RyersonMoon
        break
        ;;
      "Reddit")
        Reddit
        break
        ;;
      "Balance")
        balance
        break
        ;;
      "Medium")
        Medium
        break
        ;;
      "Twitter")
        Twitter
        break
        ;;
      "Spotify")
        Spotify
        break
        ;;
      "Google")
        Google
        break
        ;;
      "WhatsApp")
        WhatsApp
        break
        ;;
      "EteSync")
        EteSync
        break
        ;;
      "Bitwarden")
        Bitwarden
        break
        ;;
      "xBrowserSync")
        xBrowserSync
        break
        ;;
      "Emails")
        emails
        break
        ;;
      "Podcasts")
        podcasts
        break
        ;;
      "RSS Feeds")
        RSS
        break
        ;;
      "Discord")
        Discord
        break
        ;;
      "PS4")
        PS4
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
}

echo "ImranR Backup"

while getopts adpmo opt; do
    case $opt in
    a) automatedScripts ;;
    d) dataScripts ;;
    p) phoneScripts ;;
    m) manualPrompts ;;
    o) listOtherScripts ;;
    \?) usage ;;
    esac
done
shift $((OPTIND - 1))

chooseScript