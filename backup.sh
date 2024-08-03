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
  PHONESYNCDIR=~"/Phone Sync Folders"
fi

# Save script location
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

chooseScript() {
  # Ensure the script choice list below is in sync with the case clause further below where scripts are defined.
  PS3="
Pick a backup script to run: "
  options=(
    "Local Files"
    "GNOME Boxes"
    "NUC Files"
    "SRV Files"
    "Media Import"
    "Balance"
    "Wealthsimple Recents to Balance"
    "Bank Statements + Balance Extras"
    "Veracrypted Bitwarden"
    "Other File Exports (Group)"
    "WhatsApp"
    "WhatsApp TXT"
    "Emails"
    # "Discord"
    "GitHub (no repos/releases)"
    "ChatGPT"
    "Medium"
    "Instagram"
    "Snapchat"
    "Presto Transit Usage Report"
    "Google"
    "Twitter"
    "TikTok"
    "Instacart Orders"
    "Music (Spotify Sync)"
    "Spotify Account Data"
    "Spotify Extended Streaming History"
    "Spotify Technical Logs"
    "Reddit"
    "PS5"
  )
  while [ true ]; do
    select option in "${options[@]}"; do
      case "$option" in

      "Local Files")
        # Some local files (like ~/.ssh and ~/.bashrc) must exist in specific locations to be usable, so cannot live directly in MAINDIR.
        # Thus they need to be periodically backed up to MAINDIR.
        # This is fully automated.
        TARGET="$MAINDIR/Backups/Local Files"
        # === ONLY ON PC ===
        if [ "$ISPC" != 1 ]; then
          echo "Only available on PC"
          break
        fi
        # ==================
        SOURCES_GIT=(~/".bashrc" ~/".bash_history" ~/".ssh" ~/".gnupg" ~/.vscode-oss ~/".config/autostart" ~/".local/share/applications" ~/".config/gtk-3.0/bookmarks" ~/".local/share/gnome-shell/extensions")
        for SOURCE in "${SOURCES_GIT[@]}"; do
          echo "Attempting to copy '"$SOURCE"' into '"$TARGET"' and commit changes to Git..."
          "$HERE"/DirCopy/DirCopy.sh -g "$SOURCE" "$TARGET"/"$(basename "$SOURCE")"
        done
        SOURCES_NO_GIT=(~/".var/app/org.mozilla.firefox/.mozilla/firefox")
        for SOURCE in "${SOURCES_NO_GIT[@]}"; do
          echo "Attempting to copy '"$SOURCE"' into '"$TARGET"'..."
          "$HERE"/DirCopy/DirCopy.sh "$SOURCE" "$TARGET"/"$(basename "$SOURCE")"
        done
        break
        ;;

      "GNOME Boxes")
        # GNOME Boxes VMs must exist in specific locations to be usable, so cannot live directly in MAINDIR.
        # Thus they need to be periodically backed up to MAINDIR.
        # This is fully automated.
        TARGET="$MAINDIR/Backups/Local Files"
        # === ONLY ON PC ===
        if [ "$ISPC" != 1 ]; then
          echo "Only available on PC"
          break
        fi
        # ==================
        # Generate gnome-boxes XML files before copying
        for name in $(virsh -c qemu:///session list --all | tail -n +3 | head -n -1 | awk '{print $2}'); do virsh dumpxml "$name" >~/.local/share/gnome-boxes/"$name".xml; done
        SOURCES_NO_GIT=(~/".local/share/gnome-boxes")
        for SOURCE in "${SOURCES_NO_GIT[@]}"; do
          echo "Attempting to copy '"$SOURCE"' into '"$TARGET"'..."
          "$HERE"/DirCopy/DirCopy.sh "$SOURCE" "$TARGET"/"$(basename "$SOURCE")"
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
        "$HERE"/SFTPBackup/SFTPBackup.sh -dg -p ubuntu@nuc.example.com user@localhost 8888 "~/.ssh/" "$TARGET"/.ssh/

        "$HERE"/SFTPBackup/SFTPBackup.sh -g -p ubuntu@nuc.example.com user@localhost 8888 "/etc/systemd/system/dservices.service" "$TARGET"/systemd/
        "$HERE"/SFTPBackup/SFTPBackup.sh -g -p ubuntu@nuc.example.com user@localhost 8888 "/etc/systemd/system/frpc.service" "$TARGET"/systemd/
        "$HERE"/SFTPBackup/SFTPBackup.sh -g -p ubuntu@nuc.example.com user@localhost 8888 "/etc/systemd/system/logntfy.service" "$TARGET"/systemd/

        "$HERE"/SFTPBackup/SFTPBackup.sh -g -p ubuntu@nuc.example.com user@localhost 8888 "~/config/config.xml" "$TARGET"/syncthing-config/
        "$HERE"/SFTPBackup/SFTPBackup.sh -g -p ubuntu@nuc.example.com user@localhost 8888 "~/config/cert.pem" "$TARGET"/syncthing-config/
        "$HERE"/SFTPBackup/SFTPBackup.sh -g -p ubuntu@nuc.example.com user@localhost 8888 "~/config/key.pem" "$TARGET"/syncthing-config/
        "$HERE"/SFTPBackup/SFTPBackup.sh -g -p ubuntu@nuc.example.com user@localhost 8888 "~/config/https-key.pem" "$TARGET"/syncthing-config/
        "$HERE"/SFTPBackup/SFTPBackup.sh -g -p ubuntu@nuc.example.com user@localhost 8888 "~/config/https-cert.pem" "$TARGET"/syncthing-config/
        "$HERE"/SFTPBackup/SFTPBackup.sh -g -p ubuntu@nuc.example.com user@localhost 8888 "~/config/csrftokens.txt.pem" "$TARGET"/syncthing-config/

        "$HERE"/SFTPBackup/SFTPBackup.sh -dg -p ubuntu@nuc.example.com user@localhost 8888 "~/.local/share/gnome-shell/extensions/" "$TARGET"/extensions/

        "$HERE"/SFTPBackup/SFTPBackup.sh -d -p ubuntu@nuc.example.com user@localhost 8888 "~/.var/app/org.mozilla.firefox/.mozilla/firefox/" "$TARGET"/firefox/

        break
        ;;

      "SRV Files")
        # SRV files must exist on the SRV to be usable, so cannot live directly in MAINDIR.
        # Thus they need to be periodically backed up to MAINDIR.
        # This is fully automated.
        TARGET="$MAINDIR/Backups/SRV"
        "$HERE"/SFTPBackup/SFTPBackup.sh -dg ubuntu@nuc.example.com 22 "~/" "$TARGET"/homeDir/
        "$HERE"/SFTPBackup/SFTPBackup.sh -g ubuntu@nuc.example.com 22 "/etc/systemd/system/nuc-healthcheck.service" "$TARGET"/systemd/
        "$HERE"/SFTPBackup/SFTPBackup.sh -g ubuntu@nuc.example.com 22 "/etc/systemd/system/docker-compose.service" "$TARGET"/systemd/

        break
        ;;

      "Media Import")
        # Some local media files must exist in holding locations to be processed or synced from other devices (or both) before being moved to MAINDIR.
        # Thus they need to be periodically processed (date/time EXIF and filename standardization) and moved to MAINDIR.
        # Other local media files are automatically processed and moved to MAINDIR in real time, but the originals still need to be periodically deleted.
        # This is fully automated.
        PROCESS_SCRIPT="$MAINDIR"/Code/Automation/MediaDateStandardize/mediaDateStandardize.sh
        RM_SCRIPT="$MAINDIR"/Code/Automation/MediaDateStandardize/deleteSynced.sh
        echo "Deleting Synced Camera Files..."
        "$RM_SCRIPT" "$PHONESYNCDIR"/DCIM/Camera "$MAINDIR"/Media/Camera
        echo "Deleting Synced Phone Screenshots..."
        "$RM_SCRIPT" "$PHONESYNCDIR"/Screenshots "$MAINDIR"/Media/Screenshots
        echo "Deleting Synced Phone Screenrecs..."
        "$RM_SCRIPT" "$PHONESYNCDIR"/"Screen Recordings" "$MAINDIR"/Media/Screenshots
        echo "Importing Snaps..."
        "$HERE"/ProcessAndMove/ProcessAndMove.sh "$PROCESS_SCRIPT" "$PHONESYNCDIR"/DCIM/Snapchat "$MAINDIR"/Media/Camera
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
        ACCFILE="$(ls "$MAINDIR"/Notes/Transactions/Acc*.md | tail -1)"
        echo "Attempting to parse user input into a format used by Balance.xlsx, then commiting any changes in '"$BALANCEDIR"' to Git upon user confirmation..."
        "$HERE"/Balance/Balance.sh "$BALANCEDIR" "$ACCFILE"
        break
        ;;

      "Wealthsimple Recents to Balance")
        PROCESS_SCRIPT_A="$MAINDIR"/Code/Automation/Wealthsimpleton/main.py
        PROCESS_SCRIPT_B="$MAINDIR"/Code/Automation/Wealthsimpleton/myResultParser.js
        TEMP_FILE="$(mktemp)"
        python "$MAINDIR"/Code/Automation/Wealthsimpleton/main.py >"$TEMP_FILE"
        echo "Paste the following into Balance.xlsx, remembering to skip duplicates:"
        node "$MAINDIR"/Code/Automation/Wealthsimpleton/myResultParser.js "$TEMP_FILE"
        rm "$TEMP_FILE"
        break
        ;;

      "Bank Statements + Balance Extras")
        STATEMENTS_DIR="$MAINDIR/Documents/Banking/eStatements"
        PROCESS_SCRIPT="$MAINDIR"/Code/Automation/BrokeETL/resultHelpers/filterDirect.sh
        "$PROCESS_SCRIPT" "$STATEMENTS_DIR" "$EXPTDIR"/*.pdf
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
        echo "This is meant for the following backups: Contacts+Tasks (VCF+ICS EteSync exports from http://localhost:37358/.web/), Calendar (ICS from https://account.proton.me/u/0/calendar/import-export) Bookmarks (JSON), Obtainium Apps (JSON), Podcasts (AntennaPod OPML), AntennaPod DB, RSS (Read You OPML), 2FA Codes (Aegis), Cheogram (CEB), and NTFY Subscriptions (JSON)."
        echo "Press [ENTER] to continue..."
        read choice

        gitCopyHelper() {
          FILE="$1"
          TARGET="$2"
          FNAME="$3"
          if [ -f "$FILE" ]; then
            echo "Attempting to move '"$FILE"' into '"$TARGET"/"$FNAME"' and commit changes to Git..."
            "$HERE"/DirCopy/DirCopy.sh -g -d "$FILE" "$TARGET" "$FNAME"
          else
            echo "No file matching the pattern: "$FILE""
          fi
        }

        gitCopyHelper "$EXPTDIR"/"My Contacts.vcf" "$TARGET" 'My Contacts.vcf'
        gitCopyHelper "$EXPTDIR"/"TODO.ics" "$TARGET" 'TODO.ics'
        gitCopyHelper "$EXPTDIR"/"Regular or Long Term.ics" "$TARGET" 'Regular.ics'
        gitCopyHelper "$EXPTDIR"/Events-*.ics "$TARGET" 'Events.ics'
        gitCopyHelper "$EXPTDIR"/bookmarks-*.json "$TARGET" 'bookmarks.json'
        gitCopyHelper "$EXPTDIR"/obtainium-export-*.json "$TARGET" 'Obtainium.json'
        gitCopyHelper "$EXPTDIR"/antennapod-feeds-*.opml "$TARGET" 'Podcasts.opml'
        gitCopyHelper "$EXPTDIR"/AntennaPodBackup-*.db "$TARGET" 'AntennaPod.opml'
        gitCopyHelper "$EXPTDIR"/Read-You-*.opml "$TARGET" 'RSS.opml'
        gitCopyHelper "$EXPTDIR"/aegis-*-*.json "$TARGET" 'aegis-export.json'
        gitCopyHelper "$EXPTDIR"/*.ceb "$TARGET" 'Cheogram.ceb'
        gitCopyHelper "$EXPTDIR"/ntfy-*.json "$TARGET" 'ntfy-subscriptions.json'

        break
        ;;

      "WhatsApp")
        # WhatsApp data is used on a phone and so cannot live directly in MAINDIR. Thus the data needs to be periodically backed up
        # This assumes the live WhatsApp folder is being continuously synced from the phone (local synced copy is backed up)
        # The backed up version is cumulative, so files deleted from the live version are not deleted from the backup
        # After the backup, media files are copied and standardized to a temporary location for review, and the live media folder is deleted
        WSAMDIR="$MAINDIR/Backups/Archive/WhatsApp-AllMedia"
        DIR=~/"Main/WhatsApp"
        echo "Attempting to copy the WhatsApp directory in '"$DIR"' to '"$WSAMDIR"' (merging with existing, if any)... "
        "$HERE"/WhatsApp/WhatsApp.sh "$DIR" "$WSAMDIR"
        DIR2=~/Downloads/WAMedia
        PROCESS_SCRIPT="$MAINDIR"/Code/Automation/MediaDateStandardize/mediaDateStandardize.sh
        echo "Attempting to copy WhatsApp media in '"$DIR"' to '"$DIR2"', standardize them, and delete the original media..."
        mkdir -p "$DIR2"/"WhatsApp Images"
        mkdir -p "$DIR2"/"WhatsApp Video"
        mkdir -p "$DIR2"/"WhatsApp Video Notes"
        rsync -aq "$DIR"/Media/"WhatsApp Images"/ "$DIR2"/"WhatsApp Images"/
        rsync -aq "$DIR"/Media/"WhatsApp Video"/ "$DIR2"/"WhatsApp Video"/
        rsync -aq "$DIR"/Media/"WhatsApp Video Notes"/ "$DIR2"/"WhatsApp Video Notes"/
        HAD_ERROR=""
        for dir in ""$DIR2"/WhatsApp Images/" ""$DIR2"/WhatsApp Video/" ""$DIR2"/WhatsApp Video Notes/"; do
          for entry in "$dir"/* .; do
            entryPath="$dir"/"$(basename "$entry")"
            if [ -d "$entryPath" ]; then
              "$PROCESS_SCRIPT" "$entryPath" || HAD_ERROR="true"
            fi
          done
        done
        mkdir -p "$DIR2"/"WhatsApp Voice Notes"
        rsync -aq "$DIR"/Media/"WhatsApp Voice Notes"/ "$DIR2"/"WhatsApp Voice Notes"/
        PROCESS_SCRIPT_AUDIO="$MAINDIR"/Code/Automation/random-utils-ir/concatAudio.sh
        for dir in ""$DIR2"/WhatsApp Voice Notes/"; do
          for entry in "$dir"/* .; do
            entryPath="$dir"/"$(basename "$entry")"
            if [ -d "$entryPath" ]; then
              mkdir -p "$entryPath"/processed
              "$PROCESS_SCRIPT_AUDIO" "$entryPath" "$entryPath"/processed || HAD_ERROR="true"
              "$PROCESS_SCRIPT" "$entryPath"/processed || HAD_ERROR="true"
            fi
          done
        done
        if [ -z "$HAD_ERROR" ]; then
          rm -r "$DIR"/Media
        else
          echo 'THERE WERE MEDIA PROCESSING ERRORS - THE ORIGINALS IN '"$DIR"' WILL NOT BE DELETED.' >&2
        fi
        break
        ;;

      "WhatsApp TXT")
        # WhatsApp data is used on a phone and so cannot live directly in MAINDIR. Thus the data needs to be periodically backed up.
        # This version backs up only text files exported from the app.
        # This is not fully automated. The text files must be manually copied to a WhatsAppTXT directory in EXPTDIR.
        WSTXTDIR="$MAINDIR/Backups/WhatsApp TXT"
        echo "Attempting to find an archive.zip or multiple WhatsApp chat zips in '"$EXPTDIR"' and merge it into '"$WSTXTDIR"'... "
        if [ -f "$EXPTDIR"/archive.zip ]; then
          unzip "$EXPTDIR"/archive.zip -d "$EXPTDIR"
          rm "$EXPTDIR"/archive.zip
        fi
        FILES="$(ls "$EXPTDIR"/WhatsApp\ Chat\ with\ *.zip)"
        mkdir -p "$EXPTDIR"/WhatsAppTXT
        while IFS= read -r f; do
          unzip -o "$f" -d "$EXPTDIR"/WhatsAppTXT
          rm "$f"
        done <<<"$FILES"
        rm "$EXPTDIR"/WhatsAppTXT/*.vcf
        node "$HERE"/WhatsAppTXT/WhatsAppTXT.js "$WSTXTDIR" "$EXPTDIR"/WhatsAppTXT
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

      "ChatGPT")
        # ChatGPT is a cloud service. Thus, data from the service must be periodically exported and backed up.
        # This is not fully automated; the data must be manually exported and placed in EXPTDIR.
        BACKUPSDIR="$MAINDIR/Backups"
        echo "Attempting to find a ChatGPT export in '"$EXPTDIR"', extract it to a subdirectory of '"$BACKUPSDIR"', and commit changes to Git..."
        "$HERE"/ExtractZips/ExtractZips.sh -dg -n 'cat user.json | jq ".email" | head -c -2 | tail -c +2' "$(find "$EXPTDIR/" | grep -E [a-z0-9]+-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2}.zip$)" "$BACKUPSDIR/ChatGPT"
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
        "$HERE"/ExtractZips/ExtractZips.sh -dg -n 'cat personal_information/personal_information/personal_information.json | jq ".profile_user[0].string_map_data.Username.value" | head -c -2 | tail -c +2' "$(find "$EXPTDIR/" | grep -E 'instagram-.*\.zip$')" "$BACKUPSDIR/Instagram"
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
        IFS=$'\n' read -r -d '' -a SOURCES < <(find "$EXPTDIR" | grep -E '.*/TUR_20[0-9]{2}_.*\.csv$' && printf '\0')
        for SOURCE in "${SOURCES[@]}"; do
          "$HERE"/DirCopy/DirCopy.sh -g -d "$SOURCE" "$BACKUPSDIR"
        done
        if [ "${#SOURCES[@]}" -eq 0 ]; then
          echo "No Presto TUR CSVs found in "$EXPTDIR""
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

      "TikTok")
        # TikTok is a cloud service. Thus, data from the service must be periodically exported and backed up.
        # This is not fully automated; the data must be manually exported and placed in EXPTDIR.
        BACKUPSDIR="$MAINDIR/Backups"
        echo "Attempting to find a TikTok export in '"$EXPTDIR"', extract it to a subdirectory of '"$BACKUPSDIR"', and commit changes to Git..."
        "$HERE"/ExtractZips/ExtractZips.sh -dg -n 'grep -Eo "userName\": \".*\"" user_data*.json | tail -c +13 | head -c -2' "$(find "$EXPTDIR/" | grep TikTok_Data.*.zip$)" "$BACKUPSDIR/TikTok"
        break
        ;;

      "Instacart Orders")
        # Instacart is a cloud service. Thus, data from the service must be periodically exported and backed up.
        # This is mostly automated but may require some manual steps.
        BACKUPSDIR="$MAINDIR/Backups"
        INSTACART_BACKUP_DIR="$BACKUPSDIR"/Instacart
        BACKUP_SCRIPT="$MAINDIR"/Code/Automation/InstacartFlation/backup.sh
        DELIVERY_IMAGES_TARGET_DIR="$MAINDIR"/Media/Camera
        PROCESS_SCRIPT="$MAINDIR"/Code/Automation/MediaDateStandardize/mediaDateStandardize.sh
        echo "Attempting to scrape Instacart order history and save the data to '"$INSTACART_BACKUP_DIR"'..."
        mkdir -p "$INSTACART_BACKUP_DIR"
        "$BACKUP_SCRIPT" "$INSTACART_BACKUP_DIR" "$DELIVERY_IMAGES_TARGET_DIR" "$PROCESS_SCRIPT -n" --after "$(date -d "$(date +%Y-%m-%d) -4 months" +%Y-%m-%d) $(date +%H:%M)" >/dev/null
        break
        ;;

      "Music (Spotify Sync)")
        # Spotify is a cloud service. Thus, content from the service must be periodically sourced from YouTube and backed up.
        MUSICDIR="$MAINDIR/External Media/Music"
        MUSIC_SCRIPT="$MAINDIR"/Code/Automation/SpotifARRR/SpotifARRR.sh
        echo "Attempting to find use Zotify to sync Spotify playlists to '"$MUSICDIR"'..."
        export NO_DELETE_UNLISTED=true
        "$MUSIC_SCRIPT" "$MUSICDIR"
        break
        ;;

      "Spotify Account Data")
        # Spotify is a cloud service. Thus, data from the service (1 of 3 export types) must be periodically exported and backed up.
        # This is not fully automated; the data must be manually exported and placed in EXPTDIR.
        BACKUPSDIR="$MAINDIR/Backups"
        echo "Attempting to find a Spotify export in '"$EXPTDIR"', extract it to a subdirectory of '"$BACKUPSDIR"', and commit changes to Git..."
        "$HERE"/ExtractZips/ExtractZips.sh -dg -n 'grep -Eo "username\": \".*\"" "Spotify Account Data/Userdata.json" | tail -c +13 | head -c -2' "$(find "$EXPTDIR/" | grep my_spotify_data.zip$)" "$BACKUPSDIR/Spotify_account"
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

      "Reddit")
        # Reddit is a cloud service. Thus, data from the service must be periodically exported and backed up.
        # This is not fully automated; the data must be manually exported and placed in EXPTDIR.
        BACKUPSDIR="$MAINDIR/Backups"
        echo "Attempting to find a Reddit export in '"$EXPTDIR"', extract it to a subdirectory of '"$BACKUPSDIR"', and commit changes to Git..."
        "$HERE"/ExtractZips/ExtractZips.sh -dg -n 'grep "account name," statistics.csv | tail -c +14 | head -c -2' "$(find "$EXPTDIR/" | grep export_.*.zip$)" "$BACKUPSDIR/Reddit"
        break
        ;;

      "PS5")
        # PS5 data and media is used on a PS5 and so cannot live directly in MAINDIR. Thus the data needs to be periodically backed up.
        # This is not fully automated. The PS5 data must be manually exported and the resulting directory must be manually copied to EXPTDIR.
        USBS=/run/media/"$(whoami)"
        SAVESDIR="$MAINDIR/Backups/PS5Backup"
        UNSORTEDMEDIADIR="$MAINDIR/Media/Unsorted-PS5Media"
        MEDIADIR="$MAINDIR/Media/Game Media"
        echo "Attempting to find a PS5 directory in '"$EXPTDIR"' or a subdirectory of '"$USBS"' and copy save files to '"$SAVESDIR"' and media files to '"$UNSORTEDMEDIADIR"'... "
        DIR="$EXPTDIR"/PS5
        USB="$(ls "$USBS"/ | head -1)"
        if [ ! -z "$USB" ] && [ -d "$USBS"/"$USB"/PS5 ]; then
          DIR="$USBS"/"$USB"/PS5
        fi
        "$HERE"/PS5/PS5.sh "$DIR" "$SAVESDIR" "$UNSORTEDMEDIADIR"
        echo "Attempting to sort and move PS5 media files from '"$UNSORTEDMEDIADIR"' to '"$MEDIADIR"'... "
        "$HERE"/PS5/cleanUpUnsortedPS5Media.sh "$UNSORTEDMEDIADIR" "$MEDIADIR"
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
