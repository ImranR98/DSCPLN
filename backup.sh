#!/bin/bash

# Define these as needed (MAINDIR should also have various subdirectories as required by the relevant scripts)
MAINDIR=~/"Main"
PHONESYNCDIR=~/Documents/"Phone Sync Folders"
EXPTDIR=~/"Downloads"
# Check if on PC
if [ "$(hostname)" = "PC" ]; then
  ISPC=1
fi
# Set NUC-Specific variables
if [ "$ISPC" != 1 ]; then
  MAINDIR="/HDD/Main"
  PHONESYNCDIR="/HDD/Phone Sync Folders"
fi

# Save script location
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

chooseScript() {
  # Ensure the script choice list below is in sync with the case clause further below where scripts are defined.
  PS3="
Pick a backup script to run: "
  options=(
    "Local Files"
    "NUC Files"
    "Media Import"
    "Balance"
    "Veracrypted Bitwarden"
    "Other File Exports (Group)"
    "WhatsApp"
    "WhatsApp TXT"
    "Emails"
    # "Discord"
    "GitHub (no repos/releases)"
    "Medium"
    "Instagram"
    "Snapchat"
    "Presto Transit Usage Report"
    "Google"
    "Twitter"
    "Spotify Account Data"
    "Spotify Extended Streaming History"
    "Spotify Technical Logs"
    "Netflix"
    "Reddit"
    "PS4"
  )
  while [ true ]; do
    select option in "${options[@]}"; do
      case "$option" in

      "Local Files")
        # Some local files (like ~/.ssh and ~/.bashrc) must exist in specific locations to be usable, so cannot live directly in MAINDIR.
        # Thus they need to be periodically backed up to MAINDIR.
        # This is fully automated.
        TARGET="$MAINDIR/Backups/Local Files"
        SOURCES=(~/".bashrc" ~/".ssh" ~/".mozilla/firefox" ~/".config/autostart" ~/".local/share/applications" ~/".config/gtk-3.0/bookmarks")
        # === ONLY ON PC ===
        if [ "$ISPC" != 1 ]; then
          echo "Only available on PC"
          break
        fi
        # ==================
        for SOURCE in "${SOURCES[@]}"; do
          echo "Attempting to copy '"$SOURCE"' into '"$TARGET"' and commit changes to Git..."
          "$HERE"/GitCopy/GitCopy.sh "$SOURCE" "$TARGET"
        done
        break
        ;;

      "NUC Files")
        # NUC files must exist on the NUC to be usable, so cannot live directly in MAINDIR.
        # Thus they need to be periodically backed up to MAINDIR.
        # This is fully automated.
        TARGET="$MAINDIR/Backups/NUC"
        # === ONLY ON PC ===
        if [ "$ISPC" != 1 ]; then
          echo "Only available on PC"
          break
        fi
        # ==================
        "$HERE"/SFTPBackup/SFTPBackup.sh -dg user@nuc.example.com 8888 "~/.ssh/" "$TARGET"/.ssh/
        
        "$HERE"/SFTPBackup/SFTPBackup.sh -g user@nuc.example.com 8888 "/etc/systemd/system/filebrowser.service" "$TARGET"/systemd/
        "$HERE"/SFTPBackup/SFTPBackup.sh -g user@nuc.example.com 8888 "/etc/systemd/system/photoprism.service" "$TARGET"/systemd/
        "$HERE"/SFTPBackup/SFTPBackup.sh -g user@nuc.example.com 8888 "/etc/systemd/system/frpc.service" "$TARGET"/systemd/
        "$HERE"/SFTPBackup/SFTPBackup.sh -g user@nuc.example.com 8888 "/etc/systemd/system/mmproxy.service" "$TARGET"/systemd/
        "$HERE"/SFTPBackup/SFTPBackup.sh -g user@nuc.example.com 8888 "/etc/systemd/system/mmproxy-rules.service" "$TARGET"/systemd/
        "$HERE"/SFTPBackup/SFTPBackup.sh -g user@nuc.example.com 8888 "/etc/systemd/system/certbot-fix.service" "$TARGET"/systemd/
        "$HERE"/SFTPBackup/SFTPBackup.sh -g user@nuc.example.com 8888 "/etc/systemd/system/filebrowser-update.timer" "$TARGET"/systemd/
        "$HERE"/SFTPBackup/SFTPBackup.sh -g user@nuc.example.com 8888 "/etc/systemd/system/filebrowser-update.service" "$TARGET"/systemd/
        "$HERE"/SFTPBackup/SFTPBackup.sh -g user@nuc.example.com 8888 "/etc/systemd/system/photoprism-index.timer" "$TARGET"/systemd/
        "$HERE"/SFTPBackup/SFTPBackup.sh -g user@nuc.example.com 8888 "/etc/systemd/system/photoprism-index.service" "$TARGET"/systemd/
        "$HERE"/SFTPBackup/SFTPBackup.sh -g user@nuc.example.com 8888 "/etc/systemd/system/photoprism-convert.timer" "$TARGET"/systemd/
        "$HERE"/SFTPBackup/SFTPBackup.sh -g user@nuc.example.com 8888 "/etc/systemd/system/photoprism-convert.service" "$TARGET"/systemd/
        "$HERE"/SFTPBackup/SFTPBackup.sh -g user@nuc.example.com 8888 "/etc/systemd/system/nuc-nginx-log-notify.service" "$TARGET"/systemd/
        
        "$HERE"/SFTPBackup/SFTPBackup.sh -g user@nuc.example.com 8888 "~/.mozilla/firefox" "$TARGET"/firefox/
        "$HERE"/SFTPBackup/SFTPBackup.sh -g user@nuc.example.com 8888 "~/photoprism/docker-compose.yml" "$TARGET"/photoprism/
        "$HERE"/SFTPBackup/SFTPBackup.sh -g user@nuc.example.com 8888 "/etc/nginx/conf.d/" "$TARGET"/nginx-conf.d/
        "$HERE"/SFTPBackup/SFTPBackup.sh -g user@nuc.example.com 8888 "/frpc.ini" "$TARGET"/frpc.ini
        "$HERE"/SFTPBackup/SFTPBackup.sh -g user@nuc.example.com 8888 "/etc/fail2ban/jail.local" "$TARGET"/fail2ban/

        break
        ;;

      "Media Import")
        # Some local media files must exist in holding locations to be processed or synced from other devices (or both) before being moved to MAINDIR.
        # Thus they need to be periodically processed (date/time EXIF and filename standardization) and moved to MAINDIR.
        # This is fully automated.
        PROCESS_SCRIPT="$MAINDIR"/Code/Automation/random-utils-ir/ExifStandardize.sh
        echo "Importing Camera Files..."
        "$HERE"/ProcessAndMove/ProcessAndMove.sh "$PROCESS_SCRIPT" "$PHONESYNCDIR"/DCIM/Camera "$MAINDIR"/Media/Camera
        echo "Importing Snaps..."
        "$HERE"/ProcessAndMove/ProcessAndMove.sh "$PROCESS_SCRIPT" "$PHONESYNCDIR"/DCIM/Snapchat "$MAINDIR"/Media/Camera
        echo "Importing Phone Screenshots..."
        "$HERE"/ProcessAndMove/ProcessAndMove.sh "$PROCESS_SCRIPT" "$PHONESYNCDIR"/Screenshots "$MAINDIR"/Media/Screenshots
        # === ONLY ON PC ===
        if [ "$ISPC" != 1 ]; then
          echo "Not on PC - Will skip screenshot import"
        else
          echo "Importing PC Screenshots..."
          "$HERE"/ProcessAndMove/ProcessAndMove.sh -c "$PROCESS_SCRIPT" ~/Pictures/Screenshots "$MAINDIR"/Media/Screenshots
        fi
        # ==================

        echo "Moving Call Recordings..."
        mv "$PHONESYNCDIR"/Calls/All/{.?*,*} "$MAINDIR"/Media/Audio/Recordings/"Call Recorder"
        mv "$PHONESYNCDIR"/Calls/All/.props/{.?*,*} "$MAINDIR"/Media/Audio/Recordings/"Call Recorder"/.props
        break
        ;;

      "Balance")
        # All finances are tracked in a Balance.xlsx file.
        # When a transaction occurs, details are immediately noted down in a notes app (as Excel editing on a phone is inconvenient and would require file syncing).
        # Thus the notes need to be periodically converted into a format that can be pasted in to Balance.xlsx.
        # This is not fully automated; the user must copy/paste the script's output into Balance.xlsx.
        BALANCEDIR="$MAINDIR/Documents/Balance"
        ACCFILE="$(ls "$MAINDIR"/Notes/Transactions/Acc*.md)"
        echo "Attempting to parse user input into a format used by Balance.xlsx, then commiting any changes in '"$BALANCEDIR"' to Git upon user confirmation..."
        "$HERE"/Balance/Balance.sh "$BALANCEDIR" "$ACCFILE"
        break
        ;;

      "Veracrypted Bitwarden")
        # Bitwarden is a cloud service. Thus, data from the service must be periodically exported and backed up.
        # Due to the sensitive nature of this service's data, this needs to be saved into an encrypted container.
        # This is not fully automated; files must be manually placed in EXPTDIR, and the Veracrypt container must already exist.
        BITWARDENCONTAINER="$MAINDIR/Backups/Auth.hc"
        echo "Attempting to find a Bitwarden JSON export in '"$EXPTDIR"', move it into the '"$BITWARDENCONTAINER"' Veracrypt container, and commit changes to Git..."
        "$HERE"/BitwardenVeracrypted/BitwardenVeracrypted.sh "$BITWARDENCONTAINER" "$EXPTDIR"/bitwarden_export_*.json
        break
        ;;

      "Other File Exports (Group)")
        # Various cloud services are used for management of contacts, calendar events, tasks, podcast and RSS feeds, bookmarks, and notes.
        # Thus, data from these services must be periodically exported and backed up.
        # These have been lumped into one script for convenience as exporting them only takes a few minutes and is usually done as a group.
        # But this script is error-prone; breaking it up into service-specific scripts may be a good idea.
        # This is not fully automated; files must be manually placed in EXPTDIR.
        TARGET="$MAINDIR/Backups/Manual"
        echo "Will attempt to copy and rename all relevant files in '"$EXPTDIR"' to '"$TARGET"', then commit changes to Git."
        echo "This is meant for the following backups: Contacts+Tasks (VCF+ICS EteSync exports from http://localhost:37358/.web/), Calendar (ICS from https://account.proton.me/u/0/calendar/import-export) Bookmarks (JSON), Obtainium Apps (JSON), Podcasts (AntennaPod OPML), RSS (Read You OPML), 2FA Codes (Aegis), and SMS (QKSMS JSON)."
        echo "Press [ENTER] to continue..."
        read choice

        gitCopyHelper() {
          FILE="$1"
          TARGET="$2"
          FNAME="$3"
          if [ -f "$FILE" ]; then
            echo "Attempting to move '"$FILE"' into '"$TARGET"/"$FNAME"' and commit changes to Git..."
            "$HERE"/GitCopy/GitCopy.sh -d "$FILE" "$TARGET" "$FNAME"
          else
            echo "No file matching the pattern: "$FILE""
          fi
        }

        gitCopyHelper "$EXPTDIR"/"My Contacts.vcf" "$TARGET" 'My Contacts.vcf'
        gitCopyHelper "$EXPTDIR"/"My Tasks.ics" "$TARGET" 'My Tasks.ics'
        gitCopyHelper "$EXPTDIR"/My\ calendar-*.ics "$TARGET" 'My Calendar.ics'
        gitCopyHelper "$EXPTDIR"/bookmarks-*.json "$TARGET" 'bookmarks.json'
        gitCopyHelper "$EXPTDIR"/obtainium-export-*.json "$TARGET" 'Obtainium.json'
        gitCopyHelper "$EXPTDIR"/antennapod-feeds-*.opml "$TARGET" 'Podcasts.opml'
        gitCopyHelper "$EXPTDIR"/ReadYou.opml "$TARGET" 'RSS.opml'
        gitCopyHelper "$EXPTDIR"/aegis-export-*.json "$TARGET" 'aegis-export.json'
        gitCopyHelper "$EXPTDIR"/backup-*.json "$TARGET" 'SMS.json'

        break
        ;;

      "WhatsApp")
        # WhatsApp data is used on a phone and so cannot live directly in MAINDIR. Thus the data needs to be periodically backed up.
        # Due to the long-term accumulation of media files in WhatsApp, two backup copies are maintained:
        # - One with all accumulated media files.
        # - One containing only those from the latest backup.
        # This is not fully automated. The WhatsApp directory must be manually copied to EXPTDIR.
        WSAMDIR="$MAINDIR/Backups/Archive/WhatsApp-AllMedia"
        echo "Attempting to find a WhatsApp directory in '"$EXPTDIR"' and copy it to '"$WSAMDIR"' (merging with existing, if any)... "
        DIRB="$EXPTDIR"/com.whatsapp/WhatsApp
        DIRC="$EXPTDIR"/WhatsApp
        DIR="$DIRA"
        if [ ! -d "$DIR" ]; then DIR="$DIRB"; fi
        if [ ! -d "$DIR" ]; then DIR="$DIRC"; fi
        "$HERE"/WhatsApp/WhatsApp.sh "$DIR" "$WSAMDIR"
        break
        ;;

      "WhatsApp TXT")
        # WhatsApp data is used on a phone and so cannot live directly in MAINDIR. Thus the data needs to be periodically backed up.
        # This version backs up only text files exported from the app.
        # This is not fully automated. The text files must be manually copied to a WhatsAppTXT directory in EXPTDIR.
        WSTXTDIR="$MAINDIR/Backups/WhatsApp TXT"
        echo "Attempting to find a WhatsAppTXT directory in '"$EXPTDIR"' and merge it into '"$WSTXTDIR"'... "
        node "$HERE"/WhatsAppTXT/WhatsAppTXT.js "$WSTXTDIR" "$EXPTDIR"/WhatsAppTXT &&  rm -r "$EXPTDIR"/WhatsAppTXT
        break
        ;;

      "Emails")
        # Emails are used on email servers and so cannot live directly in MAINDIR. Thus emails must be periodically exported and backed up.
        # This is not fully automated; the .mbox files must be manually exported and placed in EXPTDIR.
        DIR="$MAINDIR/Backups/Email"
        echo "Attempting to find MBOX files in '"$EXPTDIR"' and copy them into '"$DIR"', replacing existing files..."
        if [ "$(ls "$EXPTDIR"/*.mbox 2>/dev/null | wc -l)" -gt 0 ]; then
          rm "$DIR"/*
          mv "$EXPTDIR"/*.mbox "$DIR"
        else
          echo "No MBOX files found in "$EXPTDIR""
        fi
        break
        ;;

      "Discord")
        # Discord is a cloud service. Thus, data from the service must be periodically exported and backed up.
        # This is not fully automated; the user must manually obtain a Discord access token, then manually select the chats to back up.
        CLI=~/"DiscordChatExporter.CLI"
        DIR="$MAINDIR/Backups/Discord"
        echo "Attempting to find the DiscordChatExporter CLI app in '"$CLI"' and use it to allow the user to export chats to '"$DIR"'..."
        "$HERE"/Discord/Discord.sh "$CLI" "$DIR"
        break
        ;;

      "GitHub (no repos/releases)")
        # GitHub is a cloud service. Thus, data from the service must be periodically exported and backed up.
        # This is not fully automated; the data must be manually exported and placed in EXPTDIR.
        # The repositories and releases directories are deleted
        BACKUPSDIR="$MAINDIR/Backups"
        echo "Attempting to find a GitHub export in '"$EXPTDIR"', extract it to a subdirectory of '"$BACKUPSDIR"' (removing repositories and releases), and commit changes to Git..."
        "$HERE"/ExtractZips/ExtractZips.sh -dg -n 'rm -rf repositories && rm -rf releases && cat users_000001.json | jq "(.[] | select(.billing_plan != null)).login" | head -c -2 | tail -c +2' "$(find "$EXPTDIR/" | grep -E '[a-z0-9]+-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+\.tar.gz$')" "$BACKUPSDIR/GitHub"
        break
        ;;

      "Medium")
        # Medium is a cloud service. Thus, data from the service must be periodically exported and backed up.
        # This is not fully automated; the data must be manually exported and placed in EXPTDIR.
        BACKUPSDIR="$MAINDIR/Backups"
        echo "Attempting to find a Medium export in '"$EXPTDIR"', extract it to a subdirectory of '"$BACKUPSDIR"', and commit changes to Git..."
        "$HERE"/ExtractZips/ExtractZips.sh -dg -n 'awk -F '"'"'<'"'"' '"'"'{ print $15 }'"'"' profile/profile.html | awk -F '"'"'>'"'"' '"'"'{ print $2 }'"'"' | awk NF | tail -c +2' "$(find "$EXPTDIR/" | grep medium-export-.*.zip$)" "$BACKUPSDIR/Medium"
        break
        ;;

      "Instagram")
        # Instagram is a cloud service. Thus, data from the service must be periodically exported and backed up.
        # This is not fully automated; the data must be manually exported and placed in EXPTDIR.
        BACKUPSDIR="$MAINDIR/Backups"
        echo "Attempting to find a Instagram export in '"$EXPTDIR"', extract it to a subdirectory of '"$BACKUPSDIR"', and commit changes to Git..."
        "$HERE"/ExtractZips/ExtractZips.sh -dg -n 'cat personal_information/personal_information.json | jq ".profile_user[0].string_map_data.Username.value" | head -c -2 | tail -c +2' "$(find "$EXPTDIR/" | grep -E '.+_[0-9]{8}\.zip$')" "$BACKUPSDIR/Instagram"
        break
        ;;

      "Snapchat")
        # Snapchat is a cloud service. Thus, data from the service must be periodically exported and backed up.
        # This is not fully automated; the data must be manually exported and placed in EXPTDIR.
        BACKUPSDIR="$MAINDIR/Backups"
        echo "Attempting to find a Medium export in '"$EXPTDIR"', extract it to a subdirectory of '"$BACKUPSDIR"', and commit changes to Git..."
        "$HERE"/ExtractZips/ExtractZips.sh -dg -n 'awk -F , '"'"'{print $1}'"'"' json/account.json | head -c -2 | tail -c +37' "$(find "$EXPTDIR/" | grep -E '.*/mydata~.*\.zip$')" "$BACKUPSDIR/Snapchat"
        break
        ;;

      "Presto Transit Usage Report")
        # Presto TUR data is generated on the Presto website servers. Thus, reports from the website must be periodically exported and backed up.
        # This is not fully automated; the data must be manually exported and placed in EXPTDIR.
        BACKUPSDIR="$MAINDIR/Backups/Archive/Presto Transit Usage Reports"
        echo "Attempting to find Presto TUR export(s) in '"$EXPTDIR"', move them into "$BACKUPSDIR"', and commit changes to Git..."
        IFS=$'\n' read -r -d '' -a SOURCES < <(find "$EXPTDIR" | grep -E '.*/TUR_20[0-9]{2}_.*\.pdf$' && printf '\0')
        for SOURCE in "${SOURCES[@]}"; do
          "$HERE"/GitCopy/GitCopy.sh -d "$SOURCE" "$BACKUPSDIR"
        done
        if [ "${#SOURCES[@]}" -eq 0 ]; then
          echo "No Presto TUR PDFs found in "$EXPTDIR""
        else
          echo "Moved "${#SOURCES[@]}" files"
        fi
        break
        ;;

      "Google")
        # Google is a cloud service. Thus, data from the service must be periodically exported and backed up.
        # This is not fully automated; the data must be manually exported and placed in EXPTDIR.
        BACKUPSDIR="$MAINDIR/Backups"
        echo "Attempting to find a Google takeout in '"$EXPTDIR"', extract it to a subdirectory of '"$BACKUPSDIR"', and commit changes to Git..."
        "$HERE"/ExtractZips/ExtractZips.sh -dg -n 'grep -Eo '"'"': ".*@'"'"' Takeout/Profile/Profile.json | head -1 | tail -c +4 | head -c -2' "$(find "$EXPTDIR" | grep takeout-.*.zip$)" "$BACKUPSDIR/Google"
        break
        ;;

      "Twitter")
        # Twitter is a cloud service. Thus, data from the service must be periodically exported and backed up.
        # This is not fully automated; the data must be manually exported and placed in EXPTDIR.
        BACKUPSDIR="$MAINDIR/Backups"
        echo "Attempting to find a Twitter export in '"$EXPTDIR"', extract it to a subdirectory of '"$BACKUPSDIR"', and commit changes to Git..."
        "$HERE"/ExtractZips/ExtractZips.sh -dg -n 'grep -Eo "accountId\" : \".*\"" data/account.js | tail -c +15 | head -c -2' "$(find "$EXPTDIR/" | grep twitter.*.zip$)" "$BACKUPSDIR/Twitter"
        break
        ;;

      "Spotify Account Data")
        # Spotify is a cloud service. Thus, data from the service (1 of 3 export types) must be periodically exported and backed up.
        # This is not fully automated; the data must be manually exported and placed in EXPTDIR.
        BACKUPSDIR="$MAINDIR/Backups"
        echo "Attempting to find a Spotify export in '"$EXPTDIR"', extract it to a subdirectory of '"$BACKUPSDIR"', and commit changes to Git..."
        "$HERE"/ExtractZips/ExtractZips.sh -dg -n 'grep -Eo "username\": \".*\"" MyData/Userdata.json | tail -c +13 | head -c -2' "$(find "$EXPTDIR/" | grep my_spotify_data.zip$)" "$BACKUPSDIR/Spotify_account"
        break
        ;;

      "Spotify Extended Streaming History")
        # Spotify is a cloud service. Thus, data from the service (1 of 3 export types) must be periodically exported and backed up.
        # This is not fully automated; the data must be manually exported and placed in EXPTDIR.
        BACKUPSDIR="$MAINDIR/Backups"
        echo "Attempting to find a Spotify export in '"$EXPTDIR"', extract it to a subdirectory of '"$BACKUPSDIR"', and commit changes to Git..."
        "$HERE"/ExtractZips/ExtractZips.sh -dg "$(find "$EXPTDIR/" | grep my_spotify_data.zip$)" "$BACKUPSDIR/Spotify_history"
        break
        ;;

      "Spotify Technical Logs")
        # Spotify is a cloud service. Thus, data from the service (1 of 3 export types) must be periodically exported and backed up.
        # This is not fully automated; the data must be manually exported and placed in EXPTDIR.
        BACKUPSDIR="$MAINDIR/Backups"
        echo "Attempting to find a Spotify export in '"$EXPTDIR"', extract it to a subdirectory of '"$BACKUPSDIR"', and commit changes to Git..."
        "$HERE"/ExtractZips/ExtractZips.sh -dg "$(find "$EXPTDIR/" | grep my_spotify_data.zip$)" "$BACKUPSDIR/Spotify_techlogs"
        break
        ;;

      "Netflix")
        # Netflix is a cloud service. Thus, data from the service must be periodically exported and backed up.
        # This is not fully automated; the data must be manually exported and placed in EXPTDIR.
        BACKUPSDIR="$MAINDIR/Backups"
        echo "Attempting to find a Netflix export in '"$EXPTDIR"', extract it to a subdirectory of '"$BACKUPSDIR"', and commit changes to Git..."
        "$HERE"/ExtractZips/ExtractZips.sh -dg -n 'cat ACCOUNT/AccountDetails.csv | head -2 | tail -1 | awk -F , "{print \$3}" | head -c -2 | tail -c +2' "$(find "$EXPTDIR/" | grep netflix-report.zip$)" "$BACKUPSDIR/Netflix"
        break
        ;;

      "Reddit")
        # Reddit is a cloud service. Thus, data from the service must be periodically exported and backed up.
        # This is not fully automated; the data must be manually exported and placed in EXPTDIR.
        BACKUPSDIR="$MAINDIR/Backups"
        echo "Attempting to find a Reddit export in '"$EXPTDIR"', extract it to a subdirectory of '"$BACKUPSDIR"', and commit changes to Git..."
        "$HERE"/ExtractZips/ExtractZips.sh -dg -n 'grep "account name," statistics.csv | tail -c +14 | head -c -2' "$(find "$EXPTDIR/" | grep export_.*.zip$)" "$BACKUPSDIR/Reddit"
        break
        ;;

      "PS4")
        # PS4 save data and media is used on a PS4 and so cannot live directly in MAINDIR. Thus the data needs to be periodically backed up.
        # This is not fully automated. The PS4 data must be manually exported and the resulting directory must be manually copied to EXPTDIR.
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
echo "My CLI tool to help automate the backup process for various local and cloud-based files. Some manual steps involved."
echo ""
chooseScript
