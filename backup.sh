#!/bin/bash

# Define these as needed (MAINDIR should also have various subdirectories as required by the relevant scripts)
MAINDIR=~/"Main"
PHONESYNCDIR=~/deviceSync
EXPTDIR=~/"Downloads"
# Check if on PC
if [ "$(hostname)" = "PC" ]; then
  ISPC=1
fi
# Set Core-Specific variables
if [ "$ISPC" != 1 ]; then
  PHONESYNCDIR=~/deviceSync
fi

# Save script location
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

chooseScript() {
  # Ensure the script choice list below is in sync with the case clause further below where scripts are defined.
  PS3="
Pick a backup script to run: "
  options=(
    "Local Files"
    "Core Files"
    "Core Landscape State"
    "Core Wine Game Save Files"
    "Media Import"
    "Balance"
    "Wealthsimple Recents to Balance"
    "Bank Statements + Balance Extras"
    "Bitwarden (encrypted with 'age')"
    "Other File Exports (Group)"
    "WhatsApp"
    "WhatsApp TXT"
    "ProtonMail"
    # "Discord"
    "GitHub (no repos/releases)"
    # "ChatGPT"
    "Medium"
    "Instagram"
    "Snapchat"
    "Presto Transit Usage Report"
    "Google"
    "Twitter"
    "Mastodon"
    "TikTok"
    "Instacart Orders"
    "DeepSeek Chats"
    "Music (Spotify Sync)"
    "Spotify Account Data"
    "Spotify Extended Streaming History"
    "Spotify Technical Logs"
    "Reddit"
    "Quest Media"
    "Quest Files"
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
        dconf dump /org/gnome/shell/extensions/ >~/.local/share/gnome-shell/extensions/gnome-extension-settings.conf
        SOURCES_GIT=(~/".bashrc.d" ~/".bash_history" ~/".ssh" ~/".gnupg" ~/.vscode-oss ~/".config/autostart" ~/".local/share/applications" ~/".config/gtk-3.0/bookmarks" ~/.local/share/gnome-shell/extensions/gnome-extension-settings.conf ~/".config/syncthing")
        for SOURCE in "${SOURCES_GIT[@]}"; do
          echo "Attempting to copy '"$SOURCE"' into '"$TARGET"' and commit changes to Git..."
          "$HERE"/DirCopy/DirCopy.sh -g "$SOURCE" "$TARGET"/"$(basename "$SOURCE")"
        done
        SOURCES_NO_GIT=(~/".var/app/io.gitlab.librewolf-community/.librewolf/" ~/".config/trivalent")
        for SOURCE in "${SOURCES_NO_GIT[@]}"; do
          echo "Attempting to copy '"$SOURCE"' into '"$TARGET"'..."
          "$HERE"/DirCopy/DirCopy.sh "$SOURCE" "$TARGET"/"$(basename "$SOURCE")"
        done
        rm ~/.local/share/gnome-shell/extensions/gnome-extension-settings.conf
        break
        ;;

      "Core Files")
        # Core files must exist on the Core to be usable, so cannot live directly in MAINDIR.
        # Thus they need to be periodically backed up to MAINDIR.
        # This is fully automated.
        TARGET="$MAINDIR/Backups/Core"
        # === ONLY ON PC ===
        if [ "$ISPC" != 1 ]; then
          echo "Only available on PC"
          break
        fi
        # ==================
        "$HERE"/SFTPBackup/SFTPBackup.sh -dg -p ubuntu@bridge.example.com user@localhost 8888 "~/.ssh/" "$TARGET"/.ssh/

        "$HERE"/SFTPBackup/SFTPBackup.sh -g -p ubuntu@bridge.example.com user@localhost 8888 "~/config/config.xml" "$TARGET"/syncthing-config/
        "$HERE"/SFTPBackup/SFTPBackup.sh -g -p ubuntu@bridge.example.com user@localhost 8888 "~/config/cert.pem" "$TARGET"/syncthing-config/
        "$HERE"/SFTPBackup/SFTPBackup.sh -g -p ubuntu@bridge.example.com user@localhost 8888 "~/config/key.pem" "$TARGET"/syncthing-config/
        "$HERE"/SFTPBackup/SFTPBackup.sh -g -p ubuntu@bridge.example.com user@localhost 8888 "~/config/https-key.pem" "$TARGET"/syncthing-config/
        "$HERE"/SFTPBackup/SFTPBackup.sh -g -p ubuntu@bridge.example.com user@localhost 8888 "~/config/https-cert.pem" "$TARGET"/syncthing-config/
        "$HERE"/SFTPBackup/SFTPBackup.sh -g -p ubuntu@bridge.example.com user@localhost 8888 "~/config/csrftokens.txt.pem" "$TARGET"/syncthing-config/

        "$HERE"/SFTPBackup/SFTPBackup.sh -g -p ubuntu@bridge.example.com user@localhost 8888 "~/.bashrc" "$TARGET"/.bashrc
        "$HERE"/SFTPBackup/SFTPBackup.sh -g -p ubuntu@bridge.example.com user@localhost 8888 "~/.bash_history" "$TARGET"/.bash_history
        "$HERE"/SFTPBackup/SFTPBackup.sh -g -p ubuntu@bridge.example.com user@localhost 8888 "~/.config/gtk-3.0/bookmarks" "$TARGET"/bookmarks

        "$HERE"/SFTPBackup/SFTPBackup.sh -dg -p ubuntu@bridge.example.com user@localhost 8888 "~/.config/autostart/" "$TARGET"/autostart/
        "$HERE"/SFTPBackup/SFTPBackup.sh -dg -p ubuntu@bridge.example.com user@localhost 8888 "~/.config/applications/" "$TARGET"/applications/

        ssh -oProxyCommand="ssh -p22 ubuntu@bridge.example.com -W %h:%p" -p8888 user@localhost "dconf dump /org/gnome/shell/extensions/ >~/.local/share/gnome-shell/extensions/gnome-extension-settings.conf"
        "$HERE"/SFTPBackup/SFTPBackup.sh -g -p ubuntu@bridge.example.com user@localhost 8888 "~/.local/share/gnome-shell/extensions/gnome-extension-settings.conf" "$TARGET"/gnome-extension-settings.conf
        ssh -oProxyCommand="ssh -p22 ubuntu@bridge.example.com -W %h:%p" -p8888 user@localhost "rm ~/.local/share/gnome-shell/extensions/gnome-extension-settings.conf"

        "$HERE"/SFTPBackup/SFTPBackup.sh -dg -e "/runners/" -e "/runtime/" -p ubuntu@bridge.example.com user@localhost 8888 "~/.local/share/lutris/" "$TARGET"/lutris/

        "$HERE"/SFTPBackup/SFTPBackup.sh -d -p ubuntu@bridge.example.com user@localhost 8888 "~/.var/app/io.gitlab.librewolf-community/.librewolf/" "$TARGET"/librewolf/

        break
        ;;

      "Core Landscape State")
        # Core service (specific unsynced) files must exist on the Core to be usable, so cannot live directly in MAINDIR.
        # Thus they need to be periodically backed up to MAINDIR.
        # This is fully automated.
        SERVICE_DATA_UNSYNCED_TARGET="$MAINDIR"/Landscape/state
        # === ONLY ON PC ===
        if [ "$ISPC" != 1 ]; then
          echo "Only available on PC"
          break
        fi
        # ==================
        "$HERE"/SFTPBackup/SFTPBackup.sh -s -e immich/upload -d -p ubuntu@bridge.example.com user@localhost 8888 "~/Main/Landscape/state/" "$SERVICE_DATA_UNSYNCED_TARGET"

        break
        ;;

      "Core Wine Game Save Files")
        # Game save files on Core gaming Wine prefixes must exist on the Core to be usable, so cannot live directly in MAINDIR.
        # Thus they need to be periodically backed up to MAINDIR.
        # This is fully automated.
        # === ONLY ON PC ===
        if [ "$ISPC" != 1 ]; then
          echo "Only available on PC"
          break
        fi
        # ==================        
        RAND_DIRPREF="$RANDOM"
        "$HERE"/RunScriptRemotely/RunScriptRemotely.sh -p ubuntu@bridge.example.com user@localhost 8888 "$HERE"/BackupGamingWinePrefixes/BackupGamingWinePrefixes.sh /mnt/ssd2/Game_Installs "/home/node/Downloads/${RAND_DIRPREF}_winegamehomebak"
        "$HERE"/SFTPBackup/SFTPBackup.sh -p ubuntu@bridge.example.com user@localhost 8888 "~/Downloads/${RAND_DIRPREF}_winegamehomebak/" "$MAINDIR/Backups/Game Save Files/"
        ssh -oProxyCommand="ssh -p22 ubuntu@bridge.example.com -W %h:%p" -p8888 user@localhost "rm -r ~/Downloads/${RAND_DIRPREF}_winegamehomebak"
        break
        ;;

      "Media Import")
        # Some local media files must exist in holding locations to be processed or synced from other devices (or both) before being moved to MAINDIR.
        # Thus they need to be periodically processed (date/time EXIF and filename standardization) and moved to MAINDIR.
        # Other local media files are automatically processed and moved to MAINDIR in real time, but the originals still need to be periodically deleted.
        # This is fully automated.
        PROCESS_SCRIPT="$MAINDIR"/Code/Automation/MediaDateStandardize/mediaDateStandardize.sh
        RM_SCRIPT="$MAINDIR"/Code/Automation/MediaDateStandardize/deleteSynced.sh
        # Delete files already synced by real time MDSCL
        echo "Deleting Synced Camera Files..."
        "$RM_SCRIPT" "$PHONESYNCDIR"/DCIM/Camera "$MAINDIR"/Media/Camera
        echo "Deleting Synced Phone Screenshots..."
        "$RM_SCRIPT" "$PHONESYNCDIR"/Screenshots "$MAINDIR"/Media/Screenshots
        echo "Deleting Synced Phone Screenrecs..."
        "$RM_SCRIPT" "$PHONESYNCDIR"/ScreenRecs "$MAINDIR"/Media/Screenshots
        # Sync everything else
        echo "Importing Camera Files..."
        "$HERE"/ProcessAndMove/ProcessAndMove.sh "$PROCESS_SCRIPT" "$PHONESYNCDIR"/DCIM/Camera "$MAINDIR"/Media/Camera
        echo "Importing Phone Screenshots..."
        "$HERE"/ProcessAndMove/ProcessAndMove.sh "$PROCESS_SCRIPT" "$PHONESYNCDIR"/Screenshots "$MAINDIR"/Media/Screenshots
        echo "Importing Phone Screenrecs..."
        "$HERE"/ProcessAndMove/ProcessAndMove.sh "$PROCESS_SCRIPT" "$PHONESYNCDIR"/ScreenRecs "$MAINDIR"/Media/Screenshots
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
        mv "$PHONESYNCDIR"/Calls/{.?*,*} "$MAINDIR"/Media/Audio/Recordings/"Call Recorder"
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

      "Bitwarden (encrypted with 'age')")
        # Bitwarden is a cloud service. Thus, data from the service must be periodically exported and backed up.
        # Due to the sensitive nature of this service's data, this needs to be saved in an encrypted format.
        # This is not fully automated; files must be manually placed in EXPTDIR.
        BITWARDENDIR="$MAINDIR/Backups/Bitwarden"
        echo "Attempting to find a Bitwarden JSON export in '"$EXPTDIR"', encrypt it, save it into '"$BITWARDENDIR"', and commit changes to Git..."
        "$HERE"/BitwardenEncrypted/BitwardenEncrypted.sh "$BITWARDENDIR" "$EXPTDIR"/bitwarden_export_*.json
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
        echo "This is meant for the following backups: Contacts+Tasks (VCF+ICS EteSync exports from http://localhost:37358/.web/), Calendar (ICS from https://account.proton.me/u/0/calendar/import-export) Bookmarks (JSON), Obtainium Apps (JSON), Podcasts (AntennaPod OPML), AntennaPod DB, RSS (Read You OPML), 2FA Codes (Aegis), Cheogram (CEB), NTFY Subscriptions (JSON), and example.com DNS entries (zip)."
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
        gitCopyHelper "$EXPTDIR"/aegis-*.json "$TARGET" 'aegis-export.json'
        gitCopyHelper "$EXPTDIR"/*.ceb "$TARGET" 'Cheogram.ceb'
        gitCopyHelper "$EXPTDIR"/ntfy-*.json "$TARGET" 'ntfy-subscriptions.json'
        gitCopyHelper "$EXPTDIR"/"example.com.txt" "$TARGET" "example.com.txt"

        echo ""
        echo "Do NOT FORGET to re-enable your Cheogram account as the backup process disables all active accounts."

        break
        ;;

      "WhatsApp")
        # WhatsApp data is used on a phone and so cannot live directly in MAINDIR. Thus the data needs to be periodically backed up
        # This assumes the live WhatsApp folder is being continuously synced from the phone (local synced copy is backed up)
        # The backed up version is cumulative, so files deleted from the live version are not deleted from the backup
        # After the backup, media files are copied and standardized to a temporary location for review, and the live media folder is deleted
        WSAMDIR="$MAINDIR/Backups/Archive/WhatsApp-AllMedia"
        DIR=~/"Main/WhatsApp"
        read -p "Manually copy anything in WA gifs to video folder, then press Enter to continue... " anything
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

      "ProtonMail")
        # Emails are used on email servers and so cannot live directly in MAINDIR. Thus emails must be periodically exported and backed up.
        # This is not fully automated; the user must enter their account credentials.
        echo "Running ProtonMail export CLI and back up emails to '"$DIR"', then delete older backups..."
        if [ ! -f ~/proton-mail-export-cli-linux_x86_64/proton-mail-export-cli ]; then
          mkdir -p ~/proton-mail-export-cli-linux_x86_64
          wget https://proton.me/download/export-tool/proton-mail-export-cli-linux_x86_64.tar.gz -O ~/proton-mail-export-cli-linux_x86_64/proton-mail-export-cli-linux_x86_64.tar.gz
          tar xf ~/proton-mail-export-cli-linux_x86_64/proton-mail-export-cli-linux_x86_64.tar.gz -C ~/proton-mail-export-cli-linux_x86_64
          rm ~/proton-mail-export-cli-linux_x86_64/proton-mail-export-cli-linux_x86_64.tar.gz
          chmod +x ~/proton-mail-export-cli-linux_x86_64/proton-mail-export-cli
        fi
        DIR="$MAINDIR/Backups/Email"
        EMAIL_ACC="ImranR98@proton.me"
        ~/proton-mail-export-cli-linux_x86_64/proton-mail-export-cli -k -o backup -d "$DIR" -u "$EMAIL_ACC"
        if [ $? == 0 ]; then
          LATEST_EXPORT_DIR="$DIR/$EMAIL_ACC/$(ls "$DIR/$EMAIL_ACC" | sort -V | head -n -1)"
          LATEST_EXPORT_FILE_COUNT="$(ls "$LATEST_EXPORT_DIR" | wc -l)"
          for dir in $(ls "$DIR/$EMAIL_ACC" | sort -V | head -n -1); do
            CURRENTLY_TARGETED_EXPORT_DIR="$DIR/$EMAIL_ACC/$dir"
            CURRENTLY_TARGETED_EXPORT_FILE_COUNT="$(ls "$CURRENTLY_TARGETED_EXPORT_DIR" | wc -l)"
            if [[ $CURRENTLY_TARGETED_EXPORT_FILE_COUNT -gt $LATEST_EXPORT_FILE_COUNT ]]; then
              echo "WARNING: PREVIOUS BACKUP '$dir' HAS MORE FILES THAN THE LATEST ONE. IT WILL NOT BE DELETED!"
            else
              rm -r "$CURRENTLY_TARGETED_EXPORT_DIR"
            fi
          done
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
        "$HERE"/ExtractZips/ExtractZips.sh -dg -n 'cat user.json | jq ".email" | head -c -2 | tail -c +2' "$(find "$EXPTDIR/" | grep -E [a-z0-9]+-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[a-z0-9]+.zip$)" "$BACKUPSDIR/ChatGPT"
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

      "Mastodon")
        # Mastodon is a cloud service. Thus, data from the service must be periodically exported and backed up.
        # This is not fully automated; the data must be manually exported and placed in EXPTDIR.
        BACKUPSDIR="$MAINDIR/Backups"
        echo "Attempting to find a Mastodon export in '"$EXPTDIR"', extract it to a subdirectory of '"$BACKUPSDIR"', and commit changes to Git..."
        "$HERE"/ExtractZips/ExtractZips.sh -dg -n 'jq -r '.id' actor.json | sed '"'"'s|https\?://||; s|/|_|g; s|:|_|g; s|[?&=]|_|g; s|[^a-zA-Z0-9._-]|_|g'"'"'' "$(find "$EXPTDIR/" | grep archive-.*\.zip$)" "$BACKUPSDIR/Mastodon"
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

      "DeepSeek Chats")
        # DeepSeek is a cloud service. Thus, data from the service must be periodically exported and backed up.
        # This is mostly automated but may require some manual steps.
        BACKUPSDIR="$MAINDIR/Backups"
        DEEPSEEK_BACKUP_DIR="$BACKUPSDIR"/DeepSeek
        BACKUP_SCRIPT="$MAINDIR"/Code/Automation/deepseek-chat-exporter/main.py
        echo "Attempting to scrape DeepSeek chat history and save the data to '"$DEEPSEEK_BACKUP_DIR"'..."
        mkdir -p "$DEEPSEEK_BACKUP_DIR"
        python "$BACKUP_SCRIPT" -o "$DEEPSEEK_BACKUP_DIR/deepseek-chats.json"
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
        echo "Attempting to find a Spotify export (assumed to be Account Data) in '"$EXPTDIR"', extract it to a subdirectory of '"$BACKUPSDIR"', and commit changes to Git..."
        "$HERE"/ExtractZips/ExtractZips.sh -dg -n 'grep -Eo "username\": \".*\"" "Spotify Account Data/Userdata.json" | tail -c +13 | head -c -2' "$(find "$EXPTDIR/" | grep my_spotify_data.zip$)" "$BACKUPSDIR/Spotify_account"
        break
        ;;

      "Spotify Extended Streaming History")
        # Spotify is a cloud service. Thus, data from the service (1 of 3 export types) must be periodically exported and backed up.
        # This is not fully automated; the data must be manually exported and placed in EXPTDIR.
        BACKUPSDIR="$MAINDIR/Backups"
        echo "Attempting to find a Spotify export (assumed to be Extended Streaming History) in '"$EXPTDIR"', extract it to a subdirectory of '"$BACKUPSDIR"', and commit changes to Git..."
        "$HERE"/ExtractZips/ExtractZips.sh -dg "$(find "$EXPTDIR/" | grep my_spotify_data.zip$)" "$BACKUPSDIR/Spotify_history"
        break
        ;;

      "Spotify Technical Logs")
        # Spotify is a cloud service. Thus, data from the service (1 of 3 export types) must be periodically exported and backed up.
        # This is not fully automated; the data must be manually exported and placed in EXPTDIR.
        BACKUPSDIR="$MAINDIR/Backups"
        echo "Attempting to find a Spotify export (assumed to be Technical Logs) in '"$EXPTDIR"', extract it to a subdirectory of '"$BACKUPSDIR"', and commit changes to Git..."
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

      "Quest Media")
        # Meta Quest camera media needs to be synced/moved from the device.
        # This is fully automated if the device is connected.
        PROCESS_SCRIPT="$MAINDIR"/Code/Automation/MediaDateStandardize/mediaDateStandardize.sh
        RM_SCRIPT="$MAINDIR"/Code/Automation/MediaDateStandardize/deleteSynced.sh
        MEDIADIR="$(ls -d /run/user/1000/gvfs/mtp:host=Oculus_Quest_*/"Internal shared storage")"
        if [ -z "$MEDIADIR" ]; then
          echo "Quest not connected!" >&2
          break
        fi
        # Delete files already synced in the past
        if [ -d "$MEDIADIR"/Oculus/Screenshots ]; then
          echo "Deleting Synced Quest Pictures..."
          "$RM_SCRIPT" "$MEDIADIR"/Oculus/Screenshots "$MAINDIR"/Media/Camera
        fi
        if [ -d "$MEDIADIR"/Oculus/VideoShots ]; then
          echo "Deleting Synced Quest Videos..."
          "$RM_SCRIPT" "$MEDIADIR"/Oculus/VideoShots "$MAINDIR"/Media/Camera
        fi
        # Sync new files
        if [ -d "$MEDIADIR"/Oculus/Screenshots ]; then
          echo "Importing Quest Pictures..."
          "$HERE"/ProcessAndMove/ProcessAndMove.sh "$PROCESS_SCRIPT" "$MEDIADIR"/Oculus/Screenshots "$MAINDIR"/Media/Camera
        fi
        if [ -d "$MEDIADIR"/Oculus/VideoShots ]; then
          echo "Importing Quest Videos..."
          "$HERE"/ProcessAndMove/ProcessAndMove.sh "$PROCESS_SCRIPT" "$MEDIADIR"/Oculus/VideoShots "$MAINDIR"/Media/Camera
        fi
        ;;

      "Quest Files")
        # Meta Quest files need to be periodically backed up to MAINDIR.
        # This is fully automated if the device is connected.
        TARGET="$MAINDIR/Backups/Meta_Quest"
        MEDIADIR="$(ls -d /run/user/1000/gvfs/mtp:host=Oculus_Quest_*/"Internal shared storage")"
        if [ -z "$MEDIADIR" ]; then
          echo "Quest not connected!" >&2
          break
        fi
        SOURCES_NO_GIT=(ModData ModsBeforeFriday Android)
        for SOURCE in "${SOURCES_NO_GIT[@]}"; do
          if [ -d "$MEDIADIR"/"$SOURCE" ]; then
            echo "Attempting to copy '<Quest>/"$SOURCE"' into '"$TARGET"'..."
            "$HERE"/DirCopy/DirCopy.sh "$MEDIADIR"/"$SOURCE" "$TARGET"/"$SOURCE"
          else
            echo "DOES NOT EXIST: <Quest>/$SOURCE"
          fi
        done
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
