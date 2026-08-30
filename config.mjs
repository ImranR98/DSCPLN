// backupctl config — personal backup workflows (committed; this repo is personal).
// Machine values up top, then `groups` (displayed in this exact order); README.md
// documents the schema.
//
// Every task is bash, written as `commands` (string or list) or a shorthand:
// `script:` (bash body, temp-file heredoc wrapper), `move: {rename?, dest?}`
// or `ingest: {suffix, dest?}` (dest defaults to the task's state_dir).
// Simple tasks call backupctl/lib.sh (the built-in {{lib}} token) as a
// subcommand. Runner fields: uploads + glob (drop zone), prompts, require,
// capture + commit_dir (paste dialog), root (availability badge),
// summary_last_line, serial_key (runs one-at-a-time with same-key tasks),
// cwd, note, export_url. Per-run tokens: {{uploads}} plus one per prompt
// key; commands see a per-run $TMPDIR. A group's `defaults` apply to every
// task in it (task fields override).

export default {
  // ---- machine values --------------------------------------------------------

  maindir: '~/Main',                              // root of all backup data
  manual_dir: '{{maindir}}/Backups/Manual',       // small one-shot exports, git-committed
  scriptroot: '{{repo_dir}}/scripts',             // git submodules with personal scripts
  quest_root: '/run/user/1000/gvfs/mtp:host=Oculus_Quest_*/Internal shared storage',

  hosts: {
    bigpc: {              // gaming PC (wine game saves)
      user: 'user',
      host: '192.0.2.226',
      port: 22,
      ssh: '{{hosts.bigpc.user}}@{{hosts.bigpc.host}}',
    },
    srv0: {               // home infra server
      user: 'user',
      host: '192.0.2.176',
      infra_path: '/home/node/Main/Infra',
    },
    vps0: {               // VPS
      host: 'vps0.example.com',
    },
  },

  protonmail_email: 'contact@example.com',

  // ---- groups (display order = array order) ----------------------------------

  groups: [

    {
      name: 'Authentication',
      defaults: { summary_last_line: true },
      tasks: [
        // Drop the Bitwarden JSON export; encrypt it with a prompted passphrase
        // (AGE_PASSPHRASE env, piped through the generic pty runner) and commit.
        {
          name: "Bitwarden (encrypted with 'age')",
          uploads: true,
          glob: 'bitwarden_export_*.json',
          state_dir: '{{maindir}}/Backups/Bitwarden',
          export_url: 'https://vault.bitwarden.com/#/tools/export',
          note: 'Export Bitwarden as JSON, then drop the file here. You will be asked for an encryption passphrase.',
          require: ['password'],
          prompts: [
            { key: 'password', label: 'Passphrase', type: 'secret' },
          ],
          commands: "AGE_PASSPHRASE='{{password}}' bash '{{lib}}' encrypt '{{maindir}}/Backups/Bitwarden' bitwarden.json {{uploads}}",
        },

        // Aegis 2FA vault export -> aegis-export.json.
        {
          name: 'Aegis 2FA',
          serial_key: 'manual',
          uploads: true,
          glob: 'aegis-*.json',
          state_dir: '{{manual_dir}}',
          note: 'Drop the Aegis 2FA backup export (JSON) here.',
          move: { rename: 'aegis-export.json' },
        },
      ],
    },

    {
      name: 'Infrastructure',
      tasks: [
        // DNS zone file (example.com.txt), kept under its own name.
        {
          name: 'example.com DNS Records',
          serial_key: 'manual',
          uploads: true,
          summary_last_line: true,
          glob: 'example.com.txt',
          state_dir: '{{manual_dir}}',
          export_url: 'https://dash.cloudflare.com/00000000000000000000000000000000/example.com/dns/records',
          note: 'Drop the DNS entries export here.',
          move: { rename: 'example.com.txt' },
        },

        // Back up config files, SSH keys, and shell history from this PC into git
        // (dconf dump first, cleanup after).
        {
          name: 'PC Files',
          state_dir: '{{maindir}}/Backups/PC Files',
          summary_last_line: true,
          note: 'Backs up config files, SSH keys, and shell history from this PC into git.',
          commands: "bash '{{lib}}' copy --git --pre 'dconf dump /org/gnome/shell/extensions/ > ~/.local/share/gnome-shell/extensions/gnome-extension-settings.conf' --post 'rm ~/.local/share/gnome-shell/extensions/gnome-extension-settings.conf' '{{maindir}}/Backups/PC Files' ~/.bashrc.d ~/.bash_history ~/.config/mimeapps.list ~/.ssh ~/.gnupg ~/.config/autostart ~/.local/share/applications ~/.config/gtk-3.0/bookmarks ~/.local/share/gnome-shell/extensions/gnome-extension-settings.conf",
        },

        // Pull compose state from the infra hosts via infra.sh.
        {
          name: 'Infra Compose State',
          state_dir: '{{maindir}}/Infra',
          note: 'Pulls compose state from the infra hosts via infra.sh.',
          commands: [
            '{{maindir}}/Infra/infra.sh pc compose backup-state root@{{hosts.vps0.host}}:/root/Infra vps0',
            '{{maindir}}/Infra/infra.sh pc compose backup-state {{hosts.srv0.user}}@{{hosts.srv0.host}}:{{hosts.srv0.infra_path}} srv0',
          ],
        },

        // Obtainium app list export -> Obtainium.json.
        {
          name: 'Obtainium Apps',
          serial_key: 'manual',
          uploads: true,
          summary_last_line: true,
          glob: 'obtainium-export-*.json',
          state_dir: '{{manual_dir}}',
          note: 'Drop the Obtainium app list export (JSON) here.',
          move: { rename: 'Obtainium.json' },
        },

        // ntfy subscriptions export -> ntfy-subscriptions.json.
        {
          name: 'Ntfy Subscriptions',
          serial_key: 'manual',
          uploads: true,
          summary_last_line: true,
          glob: 'ntfy-*.json',
          state_dir: '{{manual_dir}}',
          note: 'Drop the ntfy subscriptions export (JSON) here.',
          move: { rename: 'ntfy-subscriptions.json' },
        },
      ],
    },

    {
      name: 'Communications',
      tasks: [
        // Cheogram (XMPP) backup.
        {
          name: 'Cheogram (CEB)',
          serial_key: 'manual',
          uploads: true,
          summary_last_line: true,
          glob: '*.ceb',
          state_dir: '{{manual_dir}}',
          note: 'Drop the Cheogram export (CEB) here. Do NOT FORGET to re-enable your Cheogram account: the backup process disables all active accounts.',
          move: { rename: 'Cheogram.ceb' },
        },

        // Molly (Signal) backup: select the three files (files, main,
        // metadata) from the backup folder; stored under those names.
        {
          name: 'Molly (Signal)',
          serial_key: 'manual',
          uploads: true,
          summary_last_line: true,
          glob: ['files', 'main', 'metadata'],
          state_dir: '{{manual_dir}}',
          note: 'Select the files, main, and metadata files from the Molly (Signal) backup folder.',
          move: {},
        },

        // Drop WhatsApp chat zips; they are merged into the cumulative TXT backup.
        {
          name: 'WhatsApp TXT',
          uploads: true,
          glob: '*.zip',
          state_dir: '{{maindir}}/Backups/WhatsApp TXT',
          note: 'Drop archive.zip or WhatsApp chat zips here; they will be merged into the cumulative backup.',
          commands: 'mkdir -p "{{maindir}}/Backups/WhatsApp TXT" && unzip -oq {{uploads}} -d "$TMPDIR" && for z in "$TMPDIR"/*.zip; do [ -f "$z" ] || continue; unzip -oq "$z" -d "$TMPDIR"; rm -f "$z"; done && rm -f "$TMPDIR"/*.vcf && node \'{{scriptroot}}/WhatsAppTXT/WhatsAppTXT.js\' "{{maindir}}/Backups/WhatsApp TXT" "$TMPDIR"',
        },

        // Archive the live WhatsApp folder: snapshot it, standardize the media
        // into the staging dir (concatenating voice notes per chat), then delete
        // the originals. set -e means originals are only deleted when every step
        // succeeded; the confirm prompt is required before anything is deleted.
        {
          name: 'WhatsApp',
          summary_last_line: true,
          state_dir: '{{maindir}}/Backups/Archive/WhatsApp-AllMedia',
          root: '{{maindir}}/WhatsApp/Media',
          note: 'Archives the live WhatsApp folder, then standardizes media into a staging dir and deletes the originals on success.',
          script: `source '{{lib}}'
SRC='{{maindir}}/WhatsApp'
MEDIA="$SRC/Media"
OUT="$HOME/Downloads/WAMedia"
ARCHIVE='{{maindir}}/Backups/Archive/WhatsApp-AllMedia'

# snapshot the whole live folder first
log "Snapshotting $SRC → $ARCHIVE..."
mkdir -p "$ARCHIVE"
bctl_rsync "$SRC/" "$ARCHIVE"

# plain subdirs: raw copy, then standardize each chat folder
for d in 'WhatsApp Images' 'WhatsApp Video' 'WhatsApp Video Notes'; do
  src="$MEDIA/$d"
  [[ -d "$src" ]] || continue
  out="$OUT/$d"
  mkdir -p "$out"
  bctl_rsync "$src/" "$out"
  for child in "$src"/*/; do
    [[ -d "$child" ]] || continue
    bctl_process_and_move "$child" "$out" '{{scriptroot}}/MediaDateStandardize/mediaDateStandardize.sh' 1
  done
done

# voice notes: concatenate each chat's segments first, then standardize
src="$MEDIA/WhatsApp Voice Notes"
if [[ -d "$src" ]]; then
  out="$OUT/WhatsApp Voice Notes"
  mkdir -p "$out"
  bctl_rsync "$src/" "$out"
  for child in "$src"/*/; do
    [[ -d "$child" ]] || continue
    processed="$child/processed"
    mkdir -p "$processed"
    bash '{{scriptroot}}/mediaConcat/concatAudio.sh' "$child" "$processed"
    bash '{{scriptroot}}/MediaDateStandardize/mediaDateStandardize.sh' "$processed"
    for f in "$processed"/*; do mv "$f" "$out/$(basename "$f")"; done
    rm -rf "$processed"
  done
fi

# everything succeeded: delete the originals
rm -rf "$MEDIA/WhatsApp Images" "$MEDIA/WhatsApp Video" "$MEDIA/WhatsApp Video Notes" "$MEDIA/WhatsApp Voice Notes"
log "Import completed; originals deleted"
`,
        },

        // Export the ProtonMail mailbox. Password + TOTP prompted. The CLI is
        // downloaded on first use; the export is validated (validate-fresh)
        // before being reported successful, and old exports are pruned after.
        {
          name: 'ProtonMail',
          state_dir: '{{maindir}}/Backups/Email',
          require: ['password'],
          note: 'Exports your ProtonMail mailbox. You will be asked for your password and TOTP code (if 2FA is enabled). The export is validated before being reported as successful.',
          prompts: [
            { key: 'password', label: 'Password', type: 'secret' },
            { key: 'totp', label: 'TOTP code (if 2FA is enabled)', type: 'secret' },
          ],
          commands: [
            `[ -x ~/proton-mail-export-cli-linux_x86_64/proton-mail-export-cli ] || {
  wget -q https://proton.me/download/export-tool/proton-mail-export-cli-linux_x86_64.tar.gz -O /tmp/proton-export.tar.gz &&
  mkdir -p ~/proton-mail-export-cli-linux_x86_64 &&
  tar xf /tmp/proton-export.tar.gz -C ~/proton-mail-export-cli-linux_x86_64 &&
  rm -f /tmp/proton-export.tar.gz &&
  chmod +x ~/proton-mail-export-cli-linux_x86_64/proton-mail-export-cli
}`,
            'EXTRA=(); [ -n "{{totp}}" ] && EXTRA=(-t "{{totp}}"); ~/proton-mail-export-cli-linux_x86_64/proton-mail-export-cli -k -o backup -d "{{maindir}}/Backups/Email" -u "{{protonmail_email}}" -p "{{password}}" "${EXTRA[@]}"',
            "bash '{{lib}}' validate-fresh '{{maindir}}/Backups/Email/{{protonmail_email}}'",
            "bash '{{lib}}' prune-exports '{{maindir}}/Backups/Email/{{protonmail_email}}' --keep-newer",
          ],
        },
      ],
    },

    {
      name: 'Finance',
      tasks: [
        // Drop bank statement PDFs; they are renamed and filed by the parser script.
        {
          name: 'Bank Statements',
          state_dir: '{{maindir}}/Documents/Banking/eStatements',
          uploads: true,
          glob: '*.pdf',
          note: 'Drop the downloaded statement PDFs here.',
          commands: [
            'npm i --prefix \'{{scriptroot}}/BrokeETL\' >/dev/null',
            '{{scriptroot}}/BrokeETL/resultHelpers/filterDirect.sh {{maindir}}/Documents/Banking/eStatements {{uploads}}',
          ],
        },

        // Parse the newest transaction notes into Balance.xlsx, paste the output,
        // then press Done to commit.
        {
          name: 'Balance',
          state_dir: '{{maindir}}/Documents/Balance',
          cwd: '{{scriptroot}}/Balance',
          commit_dir: '{{maindir}}/Documents/Balance',
          capture: true,
          note: 'You still need to manually add Transaction Types, sort entries, and remove duplicates. Press "Done" to commit the Balance.xlsx change to git.',
          commands: [
            'npm i >/dev/null',
            "node '{{scriptroot}}/Balance/accMDToXLSX.js' \"$(cat \"$(ls '{{maindir}}/Notes/Transactions'/Acc*.md | tail -1)\")\" '{{maindir}}/Documents/Balance/Balance.xlsx'",
          ],
        },

        // Pull recent Wealthsimple transactions; paste into Balance.xlsx.
        {
          name: 'Wealthsimple Recents to Balance',
          state_dir: '{{maindir}}/Documents/Balance',
          cwd: '{{scriptroot}}/Wealthsimpleton',
          capture: true,
          note: 'Paste the results into Balance.xlsx, remembering to skip duplicates.',
          commands: [
            '[ -f \'{{scriptroot}}/Wealthsimpleton/venv/bin/activate\' ] || python3 -m venv \'{{scriptroot}}/Wealthsimpleton/venv\'',
            'source \'{{scriptroot}}/Wealthsimpleton/venv/bin/activate\' && pip install --upgrade -r \'{{scriptroot}}/Wealthsimpleton/requirements.txt\' >/dev/null',
            'source \'{{scriptroot}}/Wealthsimpleton/venv/bin/activate\' && python main.py > "$TMPDIR/out"',
            'node myResultParser.js "$TMPDIR/out"',
          ],
        },

        // Scrape recent Instacart order history and delivery images.
        {
          name: 'Instacart Orders',
          state_dir: '{{maindir}}/Backups/Instacart',
          note: 'Scrapes recent Instacart order history and delivery images.',
          commands: [
            '[ -f \'{{scriptroot}}/InstacartFlation/venv/bin/activate\' ] || python3 -m venv \'{{scriptroot}}/InstacartFlation/venv\'',
            'source \'{{scriptroot}}/InstacartFlation/venv/bin/activate\' && pip install --upgrade -r \'{{scriptroot}}/InstacartFlation/requirements.txt\'',
            'source \'{{scriptroot}}/InstacartFlation/venv/bin/activate\' && {{scriptroot}}/InstacartFlation/backup.sh {{maindir}}/Backups/Instacart {{maindir}}/Media/Camera "{{scriptroot}}/MediaDateStandardize/mediaDateStandardize.sh -n" --after "$(date -d \'4 months ago\' \'+%Y-%m-%d %H:%M\')"',
          ],
        },
      ],
    },

    {
      name: 'Media and Files',
      tasks: [
        // Import and standardize media from the synced phone folders (requires
        // phone sync to be running).
        {
          name: 'Media Import',
          summary_last_line: true,
          state_dir: '{{maindir}}/Media',
          root: '~/deviceSync',
          note: 'Imports and standardizes media from the synced phone folders. Requires phone sync to be running.',
          script: `source '{{lib}}'
SRC="$HOME/deviceSync"
STD='{{scriptroot}}/MediaDateStandardize'

bctl_import_pair "$SRC/DCIM/Camera" '{{maindir}}/Media/Camera' "$STD"
bctl_import_pair "$SRC/Screenshots" '{{maindir}}/Media/Screenshots' "$STD"
bctl_import_pair "$SRC/ScreenRecs" '{{maindir}}/Media/Screenshots' "$STD"

# Snapchat: concatenate clips first (parking the originals), then import
if [[ -d "$SRC/DCIM/Snapchat" ]]; then
  bash '{{scriptroot}}/mediaConcat/snapsPre.sh' "$SRC/DCIM/Snapchat" "$HOME/Downloads/snaps_original_deletable"
  bctl_import_pair "$SRC/DCIM/Snapchat" '{{maindir}}/Media/Camera' "$STD"
fi

# call recordings: plain move, no processing
DEST='{{maindir}}/Media/Recordings/Call Recorder'
mkdir -p "$DEST"
for f in "$SRC/Calls"/*; do mv "$f" "$DEST/$(basename "$f")"; done
log "Media import completed"
`,
        },

        // Run the backup script on bigpc over SSH and pull the results down.
        {
          name: 'Wine Game Save Files',
          state_dir: '{{maindir}}/Backups/Game Save Files',
          note: 'Runs the backup script on bigpc over SSH and pulls the results down.',
          commands: [
            'ssh -o BatchMode=yes {{hosts.bigpc.ssh}} "mkdir -p /tmp/gamehomebak"',
            'rsync -aq -e "ssh -o BatchMode=yes" "{{scriptroot}}/WineGameSaveBackup/BackupGamingWinePrefixes.sh" {{hosts.bigpc.ssh}}:/tmp/gamehomebak/',
            'ssh -o BatchMode=yes {{hosts.bigpc.ssh}} "cd /tmp/gamehomebak && bash ./BackupGamingWinePrefixes.sh ~/Games/Installs/Synced /home/{{hosts.bigpc.user}}/Downloads/gamehomebak_out"',
            'ssh -o BatchMode=yes {{hosts.bigpc.ssh}} "cd /tmp/gamehomebak && bash ./BackupGamingWinePrefixes.sh ~/Games/Installs/Unsynced /home/{{hosts.bigpc.user}}/Downloads/gamehomebak_out"',
            'rsync -aq -e "ssh -o BatchMode=yes" {{hosts.bigpc.ssh}}:/home/{{hosts.bigpc.user}}/Downloads/gamehomebak_out/ "{{maindir}}/Backups/Game Save Files"',
            'ssh -o BatchMode=yes {{hosts.bigpc.ssh}} "rm -rf /tmp/gamehomebak /home/{{hosts.bigpc.user}}/Downloads/gamehomebak_out"',
          ],
        },

        // Download YouTube Music playlists into the music folder.
        {
          name: 'Music (YouTube Music Download)',
          state_dir: '{{maindir}}/Media/Music',
          cwd: '{{scriptroot}}/YTMusicDL',
          note: 'Downloads YouTube Music playlists into the music folder.',
          commands: 'if [ ! -f ./venv/bin/activate ]; then python -m venv venv; fi\nsource ./venv/bin/activate\npip install --upgrade -r requirements.txt\npython ytmusic_dl.py --dir {{maindir}}/Media/Music\nbash validate_m3u8s.sh {{maindir}}/Media/Music\n',
        },

        // Import Quest screenshots and video clips (requires the Quest connected).
        {
          name: 'Quest Media',
          summary_last_line: true,
          state_dir: '{{maindir}}/Media/Camera',
          root: '{{quest_root}}',
          note: 'Imports Quest screenshots and video clips. Requires the Quest to be connected.',
          script: `source '{{lib}}'
SRC=$(bctl_first_glob '{{quest_root}}')
[[ -n "$SRC" ]] || { log "Source directory not found" >&2; exit 1; }
bctl_import_pair "$SRC/Oculus/Screenshots" '{{maindir}}/Media/Camera' '{{scriptroot}}/MediaDateStandardize'
bctl_import_pair "$SRC/Oculus/VideoShots" '{{maindir}}/Media/Camera' '{{scriptroot}}/MediaDateStandardize'
log "Media import completed"
`,
        },

        // Copy ModData, ModsBeforeFriday, and Android from the connected Quest.
        {
          name: 'Quest Files',
          summary_last_line: true,
          state_dir: '{{maindir}}/Backups/Meta_Quest',
          root: '{{quest_root}}',
          note: 'Copies ModData, ModsBeforeFriday, and Android from the connected Quest.',
          commands: 'bash \'{{lib}}\' copy \'{{maindir}}/Backups/Meta_Quest\' "{{quest_root}}/ModData" "{{quest_root}}/ModsBeforeFriday" "{{quest_root}}/Android"',
        },
      ],
    },

    {
      name: 'Information',
      defaults: { uploads: true, summary_last_line: true },
      tasks: [
        // Drop the contacts (VCF) and calendar (ICS) exports; rename each by pattern.
        {
          name: 'Contacts + Calendar (VCF+ICS)',
          serial_key: 'manual',
          glob: ['*.vcf', '*.ics'],
          state_dir: '{{manual_dir}}',
          export_url: 'https://nextcloud.home.example.com/apps/calendar',
          note: 'Drop the contacts (VCF) and calendar (ICS) exports here.',
          script: `source '{{lib}}'
DEST='{{manual_dir}}'
mkdir -p "$DEST"
for f in {{uploads}}; do
  case "$(basename "$f")" in
    contacts-*.vcf) mv "$f" "$DEST/My Contacts.vcf" ;;
    todo-*.ics) mv "$f" "$DEST/TODO.ics" ;;
    regular-or-long-term-*.ics) mv "$f" "$DEST/Regular.ics" ;;
    personal-*.ics) mv "$f" "$DEST/Events.ics" ;;
    *) mv "$f" "$DEST/$(basename "$f")" ;;
  esac
done
bctl_git_commit "$DEST"
log "Files → $DEST"
`,
        },

        // Browser bookmarks export -> bookmarks.html.
        {
          name: 'Bookmarks',
          serial_key: 'manual',
          glob: 'bookmarks_*.html',
          state_dir: '{{manual_dir}}',
          note: 'Drop the browser bookmarks export (HTML) here.',
          move: { rename: 'bookmarks.html' },
        },

        // AntennaPod feeds (OPML) and/or DB backup, renamed per pattern.
        {
          name: 'AntennaPod (Feeds + DB)',
          serial_key: 'manual',
          glob: ['antennapod-feeds-*.opml', 'AntennaPodBackup-*.db'],
          state_dir: '{{manual_dir}}',
          note: 'Drop the AntennaPod feeds OPML and/or DB backup here.',
          script: `source '{{lib}}'
DEST='{{manual_dir}}'
mkdir -p "$DEST"
for f in {{uploads}}; do
  case "$(basename "$f")" in
    antennapod-feeds-*.opml) mv "$f" "$DEST/Podcasts.opml" ;;
    AntennaPodBackup-*.db) mv "$f" "$DEST/AntennaPod.opml" ;;
  esac
done
bctl_git_commit "$DEST"
log "Files → $DEST"
`,
        },

        // Read You RSS feeds export -> RSS.opml.
        {
          name: 'RSS (Read You)',
          serial_key: 'manual',
          glob: 'Read-You-*.opml',
          state_dir: '{{manual_dir}}',
          note: 'Drop the Read You feeds export (OPML) here.',
          move: { rename: 'RSS.opml' },
        },

        // Presto transit usage reports, kept under their own names.
        {
          name: 'Presto Transit Usage Report',
          glob: 'transit_usage_report.csv',
          state_dir: '{{maindir}}/Backups/Archive/Presto Transit Usage Reports',
          export_url: 'https://www.prestocard.ca/en/dashboard/transit-usage-report',
          note: 'Drop the transit_usage_report.csv file(s) here.',
          move: {},
        },

        // GitHub data export; repositories, releases, and attachments stripped,
        // folder named after the account.
        {
          name: 'GitHub (no repos/releases)',
          glob: '*.tar.gz',
          state_dir: '{{maindir}}/Backups/GitHub',
          export_url: 'https://github.com/settings/admin',
          note: 'Drop the GitHub data export archive here (repositories and releases are stripped).',
          ingest: { suffix: 'rm -rf repositories releases attachments; cat users_000001.json | jq "(.[] | select(.billing_plan != null)).login" | head -c -2 | tail -c +2' },
        },

        // Google Takeout; folder named after the account email.
        {
          name: 'Google',
          glob: 'takeout-*.zip',
          state_dir: '{{maindir}}/Backups/Google',
          export_url: 'https://takeout.google.com',
          note: 'Drop the Google Takeout zip here.',
          ingest: { suffix: 'grep -Eo ": \\".*@.*\\"" Takeout/Profile/Profile.json | head -1 | tail -c +4 | head -c -2' },
        },

        // Uber data request export; folder named after the account.
        {
          name: 'Uber',
          glob: 'Uber Data Request *.zip',
          state_dir: '{{maindir}}/Backups/Uber',
          export_url: 'https://myprivacy.uber.com/exploreyourdata/download',
          note: 'Drop the Uber data request zip here.',
          ingest: { suffix: 'awk -F, \'{print $1}\' "Uber Data/Account and Profile/user_profile-0.csv" | tail -1' },
        },

        // Lyft data export; folder named after the account.
        {
          name: 'Lyft',
          glob: 'lyft_data.zip',
          state_dir: '{{maindir}}/Backups/Lyft',
          export_url: 'https://account.lyft.com/privacy/data',
          note: 'Drop the Lyft data export zip here.',
          ingest: { suffix: 'awk -F, \'{print $1}\' user_profile.csv | tail -1' },
        },

        // Qwen chat exports, kept under their own names.
        {
          name: 'Qwen Chats',
          glob: 'chat-export-*.json',
          state_dir: '{{maindir}}/Backups/Qwen Chat',
          export_url: 'https://chat.qwen.ai/settings/chats',
          note: 'Drop the chat-export-*.json file(s) here.',
          move: {},
        },
      ],
    },

    {
      name: 'Social Media',
      defaults: { uploads: true, summary_last_line: true },
      tasks: [
        // Medium data export; folder named after the account.
        {
          name: 'Medium',
          glob: 'medium-export-*.zip',
          state_dir: '{{maindir}}/Backups/Medium',
          export_url: 'https://medium.com/me/settings/security',
          note: 'Drop the Medium data export zip here.',
          ingest: { suffix: 'awk -F\\< "{ print \\$15 }" profile/profile.html | awk -F\\> "{ print \\$2 }" | awk NF | tail -c +2' },
        },

        // Instagram data export; folder named after the account.
        {
          name: 'Instagram',
          glob: 'instagram-*.zip',
          state_dir: '{{maindir}}/Backups/Instagram',
          export_url: 'https://accountscenter.instagram.com/info_and_permissions/dyi/?entry_point=deeplink_screen',
          note: 'Drop the Instagram data export zip here.',
          ingest: { suffix: 'cat personal_information/personal_information/personal_information.json | jq ".profile_user[0].string_map_data.Username.value" | head -c -2 | tail -c +2' },
        },

        // Snapchat data export; folder named after the account.
        {
          name: 'Snapchat',
          glob: 'mydata~*.zip',
          state_dir: '{{maindir}}/Backups/Snapchat',
          export_url: 'https://accounts.snapchat.com/accounts/downloadmydata',
          note: 'Drop the Snapchat data export zip here.',
          ingest: { suffix: 'grep -i username json/account.json | awk -F\\" "{print \\$4}"' },
        },

        // Twitter/X data export; folder named after the account.
        {
          name: 'Twitter',
          glob: 'twitter*.zip',
          state_dir: '{{maindir}}/Backups/Twitter',
          export_url: 'https://twitter.com/i/flow/verify_account_ownership',
          note: 'Drop the Twitter/X data export zip here.',
          ingest: { suffix: 'grep -Eo "accountId\\" : \\".*\\"" data/account.js | tail -c +15 | head -c -2' },
        },

        // Mastodon archive; folder named after the account handle.
        {
          name: 'Mastodon',
          glob: 'archive-*.zip',
          state_dir: '{{maindir}}/Backups/Mastodon',
          export_url: 'https://freeradical.zone/settings/export',
          note: 'Drop the Mastodon archive zip here.',
          ingest: { suffix: 'jq -r ".id" actor.json | sed "s|https*://||; s|/|_|g; s|:|_|g; s|[?&=]|_|g; s|[^a-zA-Z0-9._-]|_|g"' },
        },

        // TikTok data export; folder named after the account.
        {
          name: 'TikTok',
          glob: 'TikTok_Data*.zip',
          state_dir: '{{maindir}}/Backups/TikTok',
          note: 'Drop the TikTok data export zip here.',
          ingest: { suffix: 'grep -oP \'(?<="userName": ")([^"]+)\' user_data*.json | head -1' },
        },

        // Reddit data export; folder named after the account.
        {
          name: 'Reddit',
          glob: 'export_*.zip',
          state_dir: '{{maindir}}/Backups/Reddit',
          export_url: 'https://www.reddit.com/settings/data-request',
          note: 'Drop the Reddit data export zip here.',
          ingest: { suffix: 'grep "account name," statistics.csv | tail -c +14 | head -c -2' },
        },
      ],
    },

  ],
};
