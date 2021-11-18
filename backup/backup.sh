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

NUCFiles() {
  "$HERE"/SFTPBackup/SFTPBackup.sh -d "user@home.example.com" "9999" ~/"{*.sh,.bashrc,*.yml}" "$MAINDIR/Backups/NUCFiles"
}

RyersonMoon() {
  "$HERE"/SFTPBackup/SFTPBackup.sh -d "iremtull@moon.cs.ryerson.ca" "22" "." "$MAINDIR/Career/Ryerson/Moon"
}

RedditWebNinja98() {
  "$HERE"/Reddit/Reddit.sh "Webninja98" "$MAINDIR/Backups/Reddit"
}

RedditImranR98() {
  "$HERE"/Reddit/Reddit.sh "ImranR98" "$MAINDIR/Backups/Reddit"
}

balance() {
  "$HERE"/Balance/Balance.sh "$MAINDIR/Notes/Acc.md" "$MAINDIR/Documents/Balance"
}

Medium() {
  "$HERE"/ExtractZips/ExtractZips.sh -dg "$(find "$ZIPSDIR/" | grep medium-export-.*.zip$)" "$MAINDIR/Backups/Medium"
}

Twitter() {
  "$HERE"/ExtractZips/ExtractZips.sh -dg "$(find "$ZIPSDIR/" | grep twitter.*.zip$)" "$MAINDIR/Backups/Twitter"
}

Spotify() {
  "$HERE"/ExtractZips/ExtractZips.sh -dg "$(find "$ZIPSDIR/" | grep my_spotify_data.zip$)" "$MAINDIR/Backups/Spotify"
}

Google() {
  "$HERE"/ExtractZips/ExtractZips.sh -d "$(find "$ZIPSDIR" | grep takeout-.*.zip$)" "$MAINDIR/Backups/Google Takeout"
}

WhatsApp() {
  "$HERE"/WhatsApp/WhatsApp.sh /run/user/1000/gvfs/*/Internal\ shared\ storage/Android/media/com.whatsapp/WhatsApp "$MAINDIR/Backups/WhatsApp" "$MAINDIR/Museum/WhatsApp-AllMedia"
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

schoolEmails() {
  echo "This is not automated. Export the .pst files manually using Outlook."
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
  "$HERE"/PS4/PS4.sh "$ps4" "$MAINDIR/Backups/PS4Saves" "$MAINDIR/Media/Unsorted-PS4Media"
}

automatedScripts() {
  echo "Local Files:"
  localFiles
  echo "NUCFiles:"
  NUCFiles
  echo "Ryerson Moon:"
  RyersonMoon
  echo "Reddit - WebNinja98:"
  RedditWebNinja98
  echo "Reddit - ImranR98:"
  RedditImranR98
  echo "Balance:"
  balance
}

dataScripts() {
  echo "Feedly:"
  Feedly
  echo "Medium:"
  Medium
  echo "Twitter:"
  Twitter
  echo "Spotify:"
  Spotify
  echo "Google:"
  Google
}

phoneScripts() {
 echo "WhatsApp":
 WhatsApp
 echo "Phone (SeedVault):"
 SeedVault
}

manualPrompts() {
  echo "EteSync:"
  EteSync
  echo "Bitwarden:"
  Bitwarden
  echo "xBrowserSync:"
  xBrowserSync
  echo "School Emails:"
  schoolEmails
  echo "Podcasts:"
  podcasts
}

listOtherScripts() {
  echo "Discord."
  echo "PS4."
}

chooseScript() {
  PS3="
  Pick an option: "
  options=(
    "Local Files"
    "NUC Files"
    "Ryerson Moon"
    "Reddit - WebNinja98"
    "Reddit - ImranR98"
    "Balance"
    "Medium"
    "Twitter"
    "Spotify"
    "Google"
    "WhatsApp"
    "EteSync"
    "Bitwarden"
    "xBrowserSync"
    "School Emails"
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
      "NUC Files")
        NUCFiles
        break
        ;;
      "Ryerson Moon")
        RyersonMoon
        break
        ;;
      "Reddit - WebNinja98")
        RedditWebNinja98
        break
        ;;
      "Reddit - ImranR98")
        RedditImranR98
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
      "School Emails")
        schoolEmails
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