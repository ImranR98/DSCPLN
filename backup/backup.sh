#!/bin/bash

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

MAINDIR=~/"Main"
EXPTDIR=~/"Downloads"

EteSync() {
  echo "No Automation. Export data from http://localhost:37358/.web/"
}

xBrowserSync() {
  echo "This is not automated. Export manually via the extension."
}

podcasts() {
  echo "This is not automated. Export the .opml file manually."
}

RSS() {
  echo "This is not automated. Export the .opml file manually."
}

chooseScript() {
  PS3="
  Pick an option: "
  options=(
    "Local Files"
    "Balance"
    "Bitwarden"
    "Other Manual Exports"
    "WhatsApp"
    "Emails"
    "Discord"
    "Medium"
    "Google"
    "Twitter"
    "Spotify"
    "Netflix"
    "Reddit"
    "PS4"
  )
  while [ true ]; do
    select option in "${options[@]}"; do
      case "$option" in

      "Local Files")
        TARGET="$MAINDIR/Backups/Local Files"
        SOURCES=(~/".bashrc" ~/".ssh")
        for SOURCE in "${SOURCES[@]}"; do
          echo "Attempting to copy '"$SOURCE"' into '"$TARGET"' and commit changes to Git..."
          "$HERE"/GitCopy/GitCopy.sh "$SOURCE" "$TARGET"
        done
        break
        ;;

      "Balance")
        BALANCEDIR="$MAINDIR/Documents/Balance"
        echo "Attempting to parse user input into a format used by Balance.xlsx, then commiting any changes in '"$BALANCEDIR"' to Git upon user confirmation..."
        "$HERE"/Balance/Balance.sh "$BALANCEDIR"
        break
        ;;

      "Bitwarden")
        echo "This is not automated. Export manually via the app or extension (USE THE ENCRYPTED OPTION)."
        break
        ;;

      "Other Manual Exports")
        TARGET="$MAINDIR/Backups/Manual"
        EXTS=(ics vcf opml json jex)
        echo "Will attempt to copy all files in '"$EXPTDIR"' with specific extensions ("${EXTS[@]}") to '"$TARGET"', then commit changes to Git."
        echo "Note: This is meant for Contacts, Calendar (EteSync exports from http://localhost:37358/.web/), Bookmarks, Podcasts, RSS, and Joplin. Since this is done by file extension, 'missing' files are not errors."
        echo "Ensure files are named appropriately for effecient Git tracking, then press [ENTER] to continue..."
        read choice
        for EXT in "${EXTS[@]}"; do
          SOURCES=("$EXPTDIR"/*."$EXT")
          for SOURCE in "${SOURCES[@]}"; do
            echo "Attempting to copy '"$SOURCE"' into '"$TARGET"' and commit changes to Git..."
            "$HERE"/GitCopy/GitCopy.sh "$SOURCE" "$TARGET"
          done
        done
        break
        ;;

      "WhatsApp")
        WSDIR="$MAINDIR/Backups/WhatsApp"
        WSAMDIR="$MAINDIR/Backups/Archive/WhatsApp-AllMedia"
        echo "Attempting to find a WhatsApp directory in '"$EXPTDIR"' and copy it to '"$WSDIR"' and '"$WSAMDIR"' (if either already exists, the former is replaced and the latter is merged)... "
        DIRB="$EXPTDIR"/com.whatsapp/WhatsApp
        DIRC="$EXPTDIR"/WhatsApp
        DIR="$DIRA"
        if [ ! -d "$DIR" ]; then DIR="$DIRB"; fi
        if [ ! -d "$DIR" ]; then DIR="$DIRC"; fi
        "$HERE"/WhatsApp/WhatsApp.sh "$DIR" "$WSDIR" "$WSAMDIR"
        break
        ;;

      "Emails")
        echo "This is not automated. Use the Protonmail tool to export that, then use Outlook to expose the others."
        break
        ;;

      "Discord")
        CLI=~/"DiscordChatExporter.CLI"
        DIR="$MAINDIR/Backups/Discord"
        echo "Attempting to find the DiscordChatExporter CLI app in '"$CLI"' and use it to allow the user to export chats to '"$DIR"'..."
        "$HERE"/Discord/Discord.sh "$CLI" "$DIR"
        break
        ;;

      "Medium")
        BACKUPSDIR="$MAINDIR/Backups"
        echo "Attempting to find a Medium export in '"$EXPTDIR"', extract it to a subdirectory of '"$BACKUPSDIR"', and commit changes to Git..."
        "$HERE"/ExtractZips/ExtractZips.sh -dg -n 'awk -F '"'"'<'"'"' '"'"'{ print $15 }'"'"' profile/profile.html | awk -F '"'"'>'"'"' '"'"'{ print $2 }'"'"' | awk NF | tail -c +2' "$(find "$EXPTDIR/" | grep medium-export-.*.zip$)" "$BACKUPSDIR/Medium"
        break
        ;;

      "Google")
        BACKUPSDIR="$MAINDIR/Backups"
        echo "Attempting to find a Google takeout in '"$EXPTDIR"', extract it to a subdirectory of '"$BACKUPSDIR"', and commit changes to Git..."
        "$HERE"/ExtractZips/ExtractZips.sh -dg -n 'grep -Eo '"'"': ".*@'"'"' Takeout/Profile/Profile.json | head -1 | tail -c +4 | head -c -2' "$(find "$EXPTDIR" | grep takeout-.*.zip$)" "$BACKUPSDIR/Google"
        break
        ;;

      "Twitter")
        BACKUPSDIR="$MAINDIR/Backups"
        echo "Attempting to find a Twitter export in '"$EXPTDIR"', extract it to a subdirectory of '"$BACKUPSDIR"', and commit changes to Git..."
        "$HERE"/ExtractZips/ExtractZips.sh -dg -n 'grep -Eo "accountId\" : \".*\"" data/account.js | tail -c +15 | head -c -2' "$(find "$EXPTDIR/" | grep twitter.*.zip$)" "$BACKUPSDIR/Twitter"
        break
        ;;

      "Spotify")
        BACKUPSDIR="$MAINDIR/Backups"
        echo "Attempting to find a Spotify export in '"$EXPTDIR"', extract it to a subdirectory of '"$BACKUPSDIR"', and commit changes to Git..."
        "$HERE"/ExtractZips/ExtractZips.sh -dg -n 'grep -Eo "username\": \".*\"" MyData/Userdata.json | tail -c +13 | head -c -2' "$(find "$EXPTDIR/" | grep my_spotify_data.zip$)" "$BACKUPSDIR/Spotify"
        break
        ;;

      "Netflix")
        BACKUPSDIR="$MAINDIR/Backups"
        echo "Attempting to find a Spotify export in '"$EXPTDIR"', extract it to a subdirectory of '"$BACKUPSDIR"', and commit changes to Git..."
        "$HERE"/ExtractZips/ExtractZips.sh -dg -n 'cat ACCOUNT/AccountDetails.csv | head -2 | tail -1 | awk -F , "{print \$3}" | head -c -2 | tail -c +2' "$(find "$EXPTDIR/" | grep netflix-report.zip$)" "$BACKUPSDIR/Netflix"
        break
        ;;

      "Reddit")
        BACKUPSDIR="$MAINDIR/Backups"
        echo "Attempting to find a Netflix export in '"$EXPTDIR"', extract it to a subdirectory of '"$BACKUPSDIR"', and commit changes to Git..."
        "$HERE"/ExtractZips/ExtractZips.sh -dg -n 'grep "account name," statistics.csv | tail -c +14 | head -c -2' "$(find "$EXPTDIR/" | grep export_.*.zip$)" "$BACKUPSDIR/Reddit"
        break
        ;;

      "PS4")
        USBS=/run/media/"$(whoami)"
        SAVESDIR="$MAINDIR/Backups/PS4Saves"
        MEDIADIR="$MAINDIR/Media/Unsorted-PS4Media"
        echo "Attempting to find a PS4 directory in '"$EXPTDIR"' or a subdirectory of '"$USBS"' and copy save files to '"$SAVESDIR"' and media files to '"$MEDIADIR"'... "
        DIR="$EXPTDIR"/PS4
        USB="$(ls "$USBS"/ | head -1)"
        if [ ! -z "$USB" ] && [ -d "$USBS"/"$USB"/PS4 ]; then
          DIR="$USBS"/"$USB"/PS4
        fi
        "$HERE"/PS4/PS4.sh "$DIR" "$SAVESDIR" "$MEDIADIR"
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
echo "Run scripts to backup various things (with varying degrees of automation)"
echo ""
chooseScript
