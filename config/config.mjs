// backupctl config — personal backup workflows (committed; this repo is personal).
// Machine values up top, the task list below; ARCHITECTURE.md documents the schema.
//
// Every task is a bash command. Simple tasks call backupctl/lib.sh (the
// built-in {{lib}} token) as a subcommand; anything with logic sources it
// inside a `bash <<'BASH_SCRIPT'` heredoc. Runner fields: uploads + glob
// (drop zone), prompts, require, capture + commit_dir (paste dialog),
// tool/fresh_dir/prune, root (availability badge), summary_last_line,
// timeout, cwd, note, export_url.
// Per-run tokens: {{uploads}}, {{tmp}}, {{node}}, plus one per prompt key.

export default {
  // ---- machine values --------------------------------------------------------

  maindir: '~/Main',                              // root of all backup data
  scriptroot: '{{repo_dir}}/scripts',             // git submodules with personal scripts
  quest_root: '/run/user/1000/gvfs/mtp:host=Oculus_Quest_*/Internal shared storage',

  hosts: {
    bigpc: {              // gaming PC (wine game saves)
      user: 'user',
      host: '192.0.2.226',
      port: 22,
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

  // ===========================================================================
  // tasks
  // ===========================================================================

  tasks: [
    // ========================================================== Apps & Accounts =

    // Drop the Bitwarden JSON export; encrypt it with a prompted passphrase
    // (AGE_PASSPHRASE env, piped through the generic pty runner) and commit.
    {
      name: "Bitwarden (encrypted with 'age')",
      group: 'Apps & Accounts',
      uploads: true,
      glob: 'bitwarden_export_*.json',
      require: ['password'],
      state_dir: '{{maindir}}/Backups/Bitwarden',
      export_url: 'https://vault.bitwarden.com/#/tools/export',
      note: 'Export Bitwarden as JSON, then drop the file here. You will be asked for an encryption passphrase.',
      summary_last_line: true,
      prompts: [
        { key: 'password', label: 'Passphrase', type: 'secret' },
      ],
      command: "AGE_PASSPHRASE='{{password}}' bash '{{lib}}' encrypt '{{node}}' '{{maindir}}/Backups/Bitwarden' bitwarden.json {{uploads}}",
    },

    // Drop the contacts (VCF) and calendar (ICS) exports; rename each by pattern.
    {
      name: 'Contacts + Calendar (VCF+ICS)',
      group: 'Apps & Accounts',
      uploads: true,
      glob: ['contacts-*.vcf', 'todo-*.ics', 'regular-or-long-term-*.ics', 'personal-*.ics'],
      state_dir: '{{maindir}}/Backups/Manual',
      note: 'Drop the contacts (VCF) and calendar (ICS) exports here.',
      summary_last_line: true,
      command: `bash <<'BASH_SCRIPT'
source '{{lib}}'
DEST='{{maindir}}/Backups/Manual'
mkdir -p "$DEST"
for f in {{uploads}}; do
  case "$(basename "$f")" in
    contacts-*.vcf) mv "$f" "$DEST/My Contacts.vcf" ;;
    todo-*.ics) mv "$f" "$DEST/TODO.ics" ;;
    regular-or-long-term-*.ics) mv "$f" "$DEST/Regular.ics" ;;
    personal-*.ics) mv "$f" "$DEST/Events.ics" ;;
  esac
done
bctl_git_commit "$DEST"
log "Files → $DEST"
BASH_SCRIPT
`,
    },

    // Browser bookmarks export -> bookmarks.html.
    {
      name: 'Bookmarks',
      group: 'Apps & Accounts',
      uploads: true,
      glob: 'bookmarks_*.html',
      state_dir: '{{maindir}}/Backups/Manual',
      note: 'Drop the browser bookmarks export (HTML) here.',
      summary_last_line: true,
      command: "bash '{{lib}}' move --git --rename bookmarks.html '{{maindir}}/Backups/Manual' {{uploads}}",
    },

    // Obtainium app list export -> Obtainium.json.
    {
      name: 'Obtainium Apps',
      group: 'Apps & Accounts',
      uploads: true,
      glob: 'obtainium-export-*.json',
      state_dir: '{{maindir}}/Backups/Manual',
      note: 'Drop the Obtainium app list export (JSON) here.',
      summary_last_line: true,
      command: "bash '{{lib}}' move --git --rename Obtainium.json '{{maindir}}/Backups/Manual' {{uploads}}",
    },

    // AntennaPod feeds (OPML) and/or DB backup, renamed per pattern.
    {
      name: 'AntennaPod (Feeds + DB)',
      group: 'Apps & Accounts',
      uploads: true,
      glob: ['antennapod-feeds-*.opml', 'AntennaPodBackup-*.db'],
      state_dir: '{{maindir}}/Backups/Manual',
      note: 'Drop the AntennaPod feeds OPML and/or DB backup here.',
      summary_last_line: true,
      command: `bash <<'BASH_SCRIPT'
source '{{lib}}'
DEST='{{maindir}}/Backups/Manual'
mkdir -p "$DEST"
for f in {{uploads}}; do
  case "$(basename "$f")" in
    antennapod-feeds-*.opml) mv "$f" "$DEST/Podcasts.opml" ;;
    AntennaPodBackup-*.db) mv "$f" "$DEST/AntennaPod.opml" ;;
  esac
done
bctl_git_commit "$DEST"
log "Files → $DEST"
BASH_SCRIPT
`,
    },

    // Read You RSS feeds export -> RSS.opml.
    {
      name: 'RSS (Read You)',
      group: 'Apps & Accounts',
      uploads: true,
      glob: 'Read-You-*.opml',
      state_dir: '{{maindir}}/Backups/Manual',
      note: 'Drop the Read You feeds export (OPML) here.',
      summary_last_line: true,
      command: "bash '{{lib}}' move --git --rename RSS.opml '{{maindir}}/Backups/Manual' {{uploads}}",
    },

    // Aegis 2FA vault export -> aegis-export.json.
    {
      name: 'Aegis 2FA',
      group: 'Apps & Accounts',
      uploads: true,
      glob: 'aegis-*.json',
      state_dir: '{{maindir}}/Backups/Manual',
      note: 'Drop the Aegis 2FA backup export (JSON) here.',
      summary_last_line: true,
      command: "bash '{{lib}}' move --git --rename aegis-export.json '{{maindir}}/Backups/Manual' {{uploads}}",
    },

    // ntfy subscriptions export -> ntfy-subscriptions.json.
    {
      name: 'NTFY Subscriptions',
      group: 'Apps & Accounts',
      uploads: true,
      glob: 'ntfy-*.json',
      state_dir: '{{maindir}}/Backups/Manual',
      note: 'Drop the ntfy subscriptions export (JSON) here.',
      summary_last_line: true,
      command: "bash '{{lib}}' move --git --rename ntfy-subscriptions.json '{{maindir}}/Backups/Manual' {{uploads}}",
    },

    // DNS zone file (example.com.txt), kept under its own name.
    {
      name: 'DNS Entries',
      group: 'Apps & Accounts',
      uploads: true,
      glob: 'example.com.txt',
      state_dir: '{{maindir}}/Backups/Manual',
      note: 'Drop the DNS entries export here.',
      summary_last_line: true,
      command: "bash '{{lib}}' move --git --rename 'example.com.txt' '{{maindir}}/Backups/Manual' {{uploads}}",
    },

    // Presto transit usage reports, kept under their own names.
    {
      name: 'Presto Transit Usage Report',
      group: 'Apps & Accounts',
      uploads: true,
      glob: 'transit_usage_report.csv',
      state_dir: '{{maindir}}/Backups/Archive/Presto Transit Usage Reports',
      export_url: 'https://www.prestocard.ca/en/dashboard/transit-usage-report',
      note: 'Drop the transit_usage_report.csv file(s) here.',
      summary_last_line: true,
      command: "bash '{{lib}}' move --git '{{maindir}}/Backups/Archive/Presto Transit Usage Reports' {{uploads}}",
    },

    // ============================================================ Social Media =

    // GitHub data export; repositories/releases stripped, folder named after
    // the account.
    {
      name: 'GitHub (no repos/releases)',
      group: 'Social Media',
      uploads: true,
      glob: '*.tar.gz',
      state_dir: '{{maindir}}/Backups/GitHub',
      export_url: 'https://github.com/settings/admin',
      note: 'Drop the GitHub data export archive here (repositories and releases are stripped).',
      summary_last_line: true,
      command: `bash <<'BASH_SCRIPT'
source '{{lib}}'
FILES=({{uploads}})
tmp=$(mktemp -d -t bctl_ingest.XXXXXX)
for f in "\${FILES[@]}"; do
  log "Extracting $(basename "$f")..."
  bctl_extract "$f" "$tmp"
done

suffix=$(cd "$tmp" && rm -rf repositories && rm -rf releases && cat users_000001.json | jq "(.[] | select(.billing_plan != null)).login" | head -c -2 | tail -c +2 2>/dev/null) || true
DEST='{{maindir}}/Backups/GitHub'
[[ -n "$suffix" ]] && DEST="$DEST - $suffix"
mkdir -p "$DEST"
bctl_rsync_delete --exclude .git/ "$tmp/" "$DEST"
rm -rf "$tmp"
bctl_git_commit "$DEST"
log "Imported into $DEST"
BASH_SCRIPT
`,
    },

    // Medium data export; folder named after the account.
    {
      name: 'Medium',
      group: 'Social Media',
      uploads: true,
      glob: 'medium-export-*.zip',
      state_dir: '{{maindir}}/Backups/Medium',
      export_url: 'https://medium.com/me/settings/security',
      note: 'Drop the Medium data export zip here.',
      summary_last_line: true,
      command: `bash <<'BASH_SCRIPT'
source '{{lib}}'
FILES=({{uploads}})
tmp=$(mktemp -d -t bctl_ingest.XXXXXX)
for f in "\${FILES[@]}"; do
  log "Extracting $(basename "$f")..."
  bctl_extract "$f" "$tmp"
done

suffix=$(cd "$tmp" && awk -F"<" '{ print $15 }' profile/profile.html | awk -F">" '{ print $2 }' | awk NF | tail -c +2 2>/dev/null) || true
DEST='{{maindir}}/Backups/Medium'
[[ -n "$suffix" ]] && DEST="$DEST - $suffix"
mkdir -p "$DEST"
bctl_rsync_delete --exclude .git/ "$tmp/" "$DEST"
rm -rf "$tmp"
bctl_git_commit "$DEST"
log "Imported into $DEST"
BASH_SCRIPT
`,
    },

    // Instagram data export; folder named after the account.
    {
      name: 'Instagram',
      group: 'Social Media',
      uploads: true,
      glob: 'instagram-*.zip',
      state_dir: '{{maindir}}/Backups/Instagram',
      export_url: 'https://accountscenter.instagram.com/info_and_permissions/dyi/?entry_point=deeplink_screen',
      note: 'Drop the Instagram data export zip here.',
      summary_last_line: true,
      command: `bash <<'BASH_SCRIPT'
source '{{lib}}'
FILES=({{uploads}})
tmp=$(mktemp -d -t bctl_ingest.XXXXXX)
for f in "\${FILES[@]}"; do
  log "Extracting $(basename "$f")..."
  bctl_extract "$f" "$tmp"
done

suffix=$(cd "$tmp" && cat personal_information/personal_information/personal_information.json | jq ".profile_user[0].string_map_data.Username.value" | head -c -2 | tail -c +2 2>/dev/null) || true
DEST='{{maindir}}/Backups/Instagram'
[[ -n "$suffix" ]] && DEST="$DEST - $suffix"
mkdir -p "$DEST"
bctl_rsync_delete --exclude .git/ "$tmp/" "$DEST"
rm -rf "$tmp"
bctl_git_commit "$DEST"
log "Imported into $DEST"
BASH_SCRIPT
`,
    },

    // Snapchat data export; folder named after the account.
    {
      name: 'Snapchat',
      group: 'Social Media',
      uploads: true,
      glob: 'mydata~*.zip',
      state_dir: '{{maindir}}/Backups/Snapchat',
      export_url: 'https://accounts.snapchat.com/accounts/downloadmydata',
      note: 'Drop the Snapchat data export zip here.',
      summary_last_line: true,
      command: `bash <<'BASH_SCRIPT'
source '{{lib}}'
FILES=({{uploads}})
tmp=$(mktemp -d -t bctl_ingest.XXXXXX)
for f in "\${FILES[@]}"; do
  log "Extracting $(basename "$f")..."
  bctl_extract "$f" "$tmp"
done

suffix=$(cd "$tmp" && grep -i username json/account.json | awk -F'"' '{print $4}' 2>/dev/null) || true
DEST='{{maindir}}/Backups/Snapchat'
[[ -n "$suffix" ]] && DEST="$DEST - $suffix"
mkdir -p "$DEST"
bctl_rsync_delete --exclude .git/ "$tmp/" "$DEST"
rm -rf "$tmp"
bctl_git_commit "$DEST"
log "Imported into $DEST"
BASH_SCRIPT
`,
    },

    // Google Takeout; folder named after the account email.
    {
      name: 'Google',
      group: 'Social Media',
      uploads: true,
      glob: 'takeout-*.zip',
      state_dir: '{{maindir}}/Backups/Google',
      export_url: 'https://takeout.google.com',
      note: 'Drop the Google Takeout zip here.',
      summary_last_line: true,
      command: `bash <<'BASH_SCRIPT'
source '{{lib}}'
FILES=({{uploads}})
tmp=$(mktemp -d -t bctl_ingest.XXXXXX)
for f in "\${FILES[@]}"; do
  log "Extracting $(basename "$f")..."
  bctl_extract "$f" "$tmp"
done

suffix=$(cd "$tmp" && grep -Eo ': ".*@.*"' Takeout/Profile/Profile.json | head -1 | tail -c +4 | head -c -2 2>/dev/null) || true
DEST='{{maindir}}/Backups/Google'
[[ -n "$suffix" ]] && DEST="$DEST - $suffix"
mkdir -p "$DEST"
bctl_rsync_delete --exclude .git/ "$tmp/" "$DEST"
rm -rf "$tmp"
bctl_git_commit "$DEST"
log "Imported into $DEST"
BASH_SCRIPT
`,
    },

    // Twitter/X data export; folder named after the account.
    {
      name: 'Twitter',
      group: 'Social Media',
      uploads: true,
      glob: 'twitter*.zip',
      state_dir: '{{maindir}}/Backups/Twitter',
      export_url: 'https://twitter.com/i/flow/verify_account_ownership',
      note: 'Drop the Twitter/X data export zip here.',
      summary_last_line: true,
      command: `bash <<'BASH_SCRIPT'
source '{{lib}}'
FILES=({{uploads}})
tmp=$(mktemp -d -t bctl_ingest.XXXXXX)
for f in "\${FILES[@]}"; do
  log "Extracting $(basename "$f")..."
  bctl_extract "$f" "$tmp"
done

suffix=$(cd "$tmp" && grep -Eo "accountId\\\" : \\\".*\\\"" data/account.js | tail -c +15 | head -c -2 2>/dev/null) || true
DEST='{{maindir}}/Backups/Twitter'
[[ -n "$suffix" ]] && DEST="$DEST - $suffix"
mkdir -p "$DEST"
bctl_rsync_delete --exclude .git/ "$tmp/" "$DEST"
rm -rf "$tmp"
bctl_git_commit "$DEST"
log "Imported into $DEST"
BASH_SCRIPT
`,
    },

    // Mastodon archive; folder named after the account handle.
    {
      name: 'Mastodon',
      group: 'Social Media',
      uploads: true,
      glob: 'archive-*.zip',
      state_dir: '{{maindir}}/Backups/Mastodon',
      export_url: 'https://freeradical.zone/settings/export',
      note: 'Drop the Mastodon archive zip here.',
      summary_last_line: true,
      command: `bash <<'BASH_SCRIPT'
source '{{lib}}'
FILES=({{uploads}})
tmp=$(mktemp -d -t bctl_ingest.XXXXXX)
for f in "\${FILES[@]}"; do
  log "Extracting $(basename "$f")..."
  bctl_extract "$f" "$tmp"
done

suffix=$(cd "$tmp" && jq -r '.id' actor.json | sed 's|https\\?://||; s|/|_|g; s|:|_|g; s|[?&=]|_|g; s|[^a-zA-Z0-9._-]|_|g' 2>/dev/null) || true
DEST='{{maindir}}/Backups/Mastodon'
[[ -n "$suffix" ]] && DEST="$DEST - $suffix"
mkdir -p "$DEST"
bctl_rsync_delete --exclude .git/ "$tmp/" "$DEST"
rm -rf "$tmp"
bctl_git_commit "$DEST"
log "Imported into $DEST"
BASH_SCRIPT
`,
    },

    // TikTok data export; folder named after the account.
    {
      name: 'TikTok',
      group: 'Social Media',
      uploads: true,
      glob: 'TikTok_Data*.zip',
      state_dir: '{{maindir}}/Backups/TikTok',
      note: 'Drop the TikTok data export zip here.',
      summary_last_line: true,
      command: `bash <<'BASH_SCRIPT'
source '{{lib}}'
FILES=({{uploads}})
tmp=$(mktemp -d -t bctl_ingest.XXXXXX)
for f in "\${FILES[@]}"; do
  log "Extracting $(basename "$f")..."
  bctl_extract "$f" "$tmp"
done

suffix=$(cd "$tmp" && grep -Eo "userName\\\": \\\".*\\\"" user_data*.json | tail -c +13 | head -c -2 2>/dev/null) || true
DEST='{{maindir}}/Backups/TikTok'
[[ -n "$suffix" ]] && DEST="$DEST - $suffix"
mkdir -p "$DEST"
bctl_rsync_delete --exclude .git/ "$tmp/" "$DEST"
rm -rf "$tmp"
bctl_git_commit "$DEST"
log "Imported into $DEST"
BASH_SCRIPT
`,
    },

    // Reddit data export; folder named after the account.
    {
      name: 'Reddit',
      group: 'Social Media',
      uploads: true,
      glob: 'export_*.zip',
      state_dir: '{{maindir}}/Backups/Reddit',
      export_url: 'https://www.reddit.com/settings/data-request',
      note: 'Drop the Reddit data export zip here.',
      summary_last_line: true,
      command: `bash <<'BASH_SCRIPT'
source '{{lib}}'
FILES=({{uploads}})
tmp=$(mktemp -d -t bctl_ingest.XXXXXX)
for f in "\${FILES[@]}"; do
  log "Extracting $(basename "$f")..."
  bctl_extract "$f" "$tmp"
done

suffix=$(cd "$tmp" && grep "account name," statistics.csv | tail -c +14 | head -c -2 2>/dev/null) || true
DEST='{{maindir}}/Backups/Reddit'
[[ -n "$suffix" ]] && DEST="$DEST - $suffix"
mkdir -p "$DEST"
bctl_rsync_delete --exclude .git/ "$tmp/" "$DEST"
rm -rf "$tmp"
bctl_git_commit "$DEST"
log "Imported into $DEST"
BASH_SCRIPT
`,
    },

    // =================================================================== Chats =

    // Cheogram (XMPP) backup.
    {
      name: 'Cheogram (CEB)',
      group: 'Chats',
      uploads: true,
      glob: '*.ceb',
      state_dir: '{{maindir}}/Backups/Manual',
      note: 'Drop the Cheogram export (CEB) here. Do NOT FORGET to re-enable your Cheogram account: the backup process disables all active accounts.',
      summary_last_line: true,
      command: "bash '{{lib}}' move --git --rename Cheogram.ceb '{{maindir}}/Backups/Manual' {{uploads}}",
    },

    // Molly (Signal) backup.
    {
      name: 'Molly (Signal)',
      group: 'Chats',
      uploads: true,
      glob: 'signal-backup-*',
      state_dir: '{{maindir}}/Backups/Manual',
      note: 'Drop the Molly (Signal) backup here.',
      summary_last_line: true,
      command: "bash '{{lib}}' move --git --rename signal.backup '{{maindir}}/Backups/Manual' {{uploads}}",
    },

    // Drop WhatsApp chat zips; they are merged into the cumulative TXT backup.
    {
      name: 'WhatsApp TXT',
      group: 'Chats',
      uploads: true,
      glob: '*.zip',
      note: 'Drop archive.zip or WhatsApp chat zips here; they will be merged into the cumulative backup.',
      state_dir: '{{maindir}}/Backups/WhatsApp TXT',
      command: 'mkdir -p "{{maindir}}/Backups/WhatsApp TXT" && rm -rf "{{tmp}}" && mkdir -p "{{tmp}}" && unzip -oq {{uploads}} -d "{{tmp}}" && for z in "{{tmp}}"/*.zip; do [ -f "$z" ] || continue; unzip -oq "$z" -d "{{tmp}}"; rm -f "$z"; done && rm -f "{{tmp}}"/*.vcf && node \'{{scriptroot}}/WhatsAppTXT/WhatsAppTXT.js\' "{{maindir}}/Backups/WhatsApp TXT" "{{tmp}}"',
    },

    // Qwen chat exports, kept under their own names.
    {
      name: 'Qwen Chats',
      group: 'Chats',
      uploads: true,
      glob: 'chat-export-*.json',
      state_dir: '{{maindir}}/Backups/Qwen Chat',
      note: 'Drop the chat-export-*.json file(s) here.',
      summary_last_line: true,
      command: "bash '{{lib}}' move --git '{{maindir}}/Backups/Qwen Chat' {{uploads}}",
    },

    // Archive the live WhatsApp folder: snapshot it, standardize the media
    // into the staging dir (concatenating voice notes per chat), then delete
    // the originals. set -e means originals are only deleted when every step
    // succeeded; the confirm prompt is required before anything is deleted.
    {
      name: 'WhatsApp',
      group: 'Chats',
      state_dir: '{{maindir}}/Backups/Archive/WhatsApp-AllMedia',
      root: '{{maindir}}/WhatsApp/Media',
      require: ['confirmed'],
      note: 'Archives the live WhatsApp folder, then standardizes media into a staging dir and deletes the originals on success.',
      summary_last_line: true,
      prompts: [
        { key: 'confirmed', label: 'Manually copy anything in WA gifs to the video folder, then press OK.', type: 'confirm' },
      ],
      command: `bash <<'BASH_SCRIPT'
source '{{lib}}'
SRC='{{maindir}}/WhatsApp'
MEDIA="$SRC/Media"
OUT='~/Downloads/WAMedia'
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
BASH_SCRIPT
`,
    },

    // ================================================================= Finance =

    // Drop bank statement PDFs; they are renamed and filed by the parser script.
    {
      name: 'Bank Statements + Balance Extras',
      state_dir: '{{maindir}}/Documents/Banking/eStatements',
      group: 'Finance',
      uploads: true,
      glob: '*.pdf',
      command: '{{scriptroot}}/BrokeETL/resultHelpers/filterDirect.sh {{maindir}}/Documents/Banking/eStatements {{uploads}}',
      note: 'Drop the downloaded statement PDFs here.',
    },

    // Parse the newest transaction notes into Balance.xlsx, paste the output,
    // then press Done to commit.
    {
      name: 'Balance',
      state_dir: '{{maindir}}/Documents/Balance',
      group: 'Finance',
      commit_dir: '{{maindir}}/Documents/Balance',
      cwd: '{{scriptroot}}/Balance',
      commands: [
        'npm i',
        "node '{{scriptroot}}/Balance/accMDToXLSX.js' \"$(cat $(ls '{{maindir}}/Notes/Transactions'/Acc*.md | tail -1))\" '{{maindir}}/Documents/Balance/Balance.xlsx'",
      ],
      note: 'You still need to manually add Transaction Types, sort entries, and remove duplicates. Press "Done" to commit the Balance.xlsx change to git.',
      capture: true,
    },

    // Pull recent Wealthsimple transactions; paste into Balance.xlsx.
    {
      name: 'Wealthsimple Recents to Balance',
      state_dir: '{{maindir}}/Documents/Balance',
      group: 'Finance',
      cwd: '{{scriptroot}}/Wealthsimpleton',
      commands: [
        'python main.py > {{tmp}}',
        'node myResultParser.js {{tmp}}',
      ],
      note: 'Paste the results into Balance.xlsx, remembering to skip duplicates.',
      capture: true,
    },

    // Scrape recent Instacart order history and delivery images.
    {
      name: 'Instacart Orders',
      state_dir: '{{maindir}}/Backups/Instacart',
      group: 'Finance',
      timeout: 900,
      note: 'Scrapes recent Instacart order history and delivery images.',
      command: `{{scriptroot}}/InstacartFlation/backup.sh {{maindir}}/Backups/Instacart {{maindir}}/Media/Camera "{{scriptroot}}/MediaDateStandardize/mediaDateStandardize.sh -n" --after "$(date -d '4 months ago' '+%Y-%m-%d %H:%M')"`,
    },

    // ================================================================= Devices =

    // Import and standardize media from the synced phone folders (requires
    // phone sync to be running).
    {
      name: 'Media Import',
      state_dir: '{{maindir}}/Media',
      group: 'Devices',
      root: '~/deviceSync',
      note: 'Imports and standardizes media from the synced phone folders. Requires phone sync to be running.',
      summary_last_line: true,
      command: `bash <<'BASH_SCRIPT'
source '{{lib}}'
SRC='~/deviceSync'
import_pair() {
  local src="$1" dest="$2"
  if [[ ! -d "$src" ]]; then
    log "Missing source dir: $src"
    return 0
  fi
  bash '{{scriptroot}}/MediaDateStandardize/deleteSynced.sh' "$src" "$dest"
  log "Importing $(basename "$src") → $dest..."
  bctl_process_and_move "$src" "$dest" '{{scriptroot}}/MediaDateStandardize/mediaDateStandardize.sh'
}

import_pair "$SRC/DCIM/Camera" '{{maindir}}/Media/Camera'
import_pair "$SRC/Screenshots" '{{maindir}}/Media/Screenshots'
import_pair "$SRC/ScreenRecs" '{{maindir}}/Media/Screenshots'

# Snapchat: concatenate clips first (parking the originals), then import
if [[ -d "$SRC/DCIM/Snapchat" ]]; then
  bash '{{scriptroot}}/mediaConcat/snapsPre.sh' "$SRC/DCIM/Snapchat" '~/Downloads/snaps_original_deletable'
  import_pair "$SRC/DCIM/Snapchat" '{{maindir}}/Media/Camera'
fi

# call recordings: plain move, no processing
DEST='{{maindir}}/Media/Recordings/Call Recorder'
mkdir -p "$DEST"
for f in "$SRC/Calls"/*; do mv "$f" "$DEST/$(basename "$f")"; done
log "Media import completed"
BASH_SCRIPT
`,
    },

    // Import PC screenshots into the media library. Everything in
    // ~/Pictures/Screenshots is standardized and moved — confirmation required.
    {
      name: 'PC Screenshots',
      state_dir: '{{maindir}}/Media/Screenshots',
      group: 'Devices',
      require: ['confirmed'],
      note: 'Moves and standardizes everything in ~/Pictures/Screenshots.',
      summary_last_line: true,
      prompts: [
        { key: 'confirmed', label: 'Move and standardize everything in ~/Pictures/Screenshots into the media library?', type: 'confirm' },
      ],
      command: `bash <<'BASH_SCRIPT'
source '{{lib}}'
SRC=~/Pictures/Screenshots
if [[ ! -d "$SRC" ]]; then
  log "Missing source dir: $SRC"
  exit 0
fi
log "Importing $(basename "$SRC") → {{maindir}}/Media/Screenshots..."
bctl_process_and_move "$SRC" '{{maindir}}/Media/Screenshots' '{{scriptroot}}/MediaDateStandardize/mediaDateStandardize.sh'
log "PC screenshots imported"
BASH_SCRIPT
`,
    },

    // Import Quest screenshots and video clips (requires the Quest connected).
    {
      name: 'Quest Media',
      state_dir: '{{maindir}}/Media/Camera',
      group: 'Devices',
      root: '{{quest_root}}',
      note: 'Imports Quest screenshots and video clips. Requires the Quest to be connected.',
      summary_last_line: true,
      command: `bash <<'BASH_SCRIPT'
source '{{lib}}'
SRC=$(bctl_first_glob '{{quest_root}}')
[[ -n "$SRC" ]] || { log "Source directory not found" >&2; exit 1; }
import_pair() {
  local src="$1" dest="$2"
  if [[ ! -d "$src" ]]; then
    log "Missing source dir: $src"
    return 0
  fi
  bash '{{scriptroot}}/MediaDateStandardize/deleteSynced.sh' "$src" "$dest"
  log "Importing $(basename "$src") → $dest..."
  bctl_process_and_move "$src" "$dest" '{{scriptroot}}/MediaDateStandardize/mediaDateStandardize.sh'
}
import_pair "$SRC/Oculus/Screenshots" '{{maindir}}/Media/Camera'
import_pair "$SRC/Oculus/VideoShots" '{{maindir}}/Media/Camera'
log "Media import completed"
BASH_SCRIPT
`,
    },

    // Copy ModData, ModsBeforeFriday, and Android from the connected Quest.
    {
      name: 'Quest Files',
      group: 'Devices',
      root: '{{quest_root}}',
      state_dir: '{{maindir}}/Backups/Meta_Quest',
      note: 'Copies ModData, ModsBeforeFriday, and Android from the connected Quest.',
      summary_last_line: true,
      command: 'bash \'{{lib}}\' copy \'{{maindir}}/Backups/Meta_Quest\' "{{quest_root}}/ModData" "{{quest_root}}/ModsBeforeFriday" "{{quest_root}}/Android"',
    },

    // ======================================================= System Backups =

    // Back up config files, SSH keys, and shell history from this PC into git
    // (dconf dump first, cleanup after).
    {
      name: 'PC Files',
      group: 'System Backups',
      state_dir: '{{maindir}}/Backups/PC Files',
      note: 'Backs up config files, SSH keys, and shell history from this PC into git.',
      summary_last_line: true,
      command: "bash '{{lib}}' copy --git --pre 'dconf dump /org/gnome/shell/extensions/ > ~/.local/share/gnome-shell/extensions/gnome-extension-settings.conf' --post 'rm ~/.local/share/gnome-shell/extensions/gnome-extension-settings.conf' '{{maindir}}/Backups/PC Files' ~/.bashrc.d ~/.bash_history ~/.config/mimeapps.list ~/.ssh ~/.gnupg ~/.config/autostart ~/.local/share/applications ~/.config/gtk-3.0/bookmarks ~/.local/share/gnome-shell/extensions/gnome-extension-settings.conf",
    },

    // Pull compose state from the infra hosts via infra.sh.
    {
      name: 'Infra Compose State',
      state_dir: '{{maindir}}/Infra',
      group: 'System Backups',
      note: 'Pulls compose state from the infra hosts via infra.sh.',
      commands: [
        '{{maindir}}/Infra/infra.sh pc compose backup-state root@{{hosts.vps0.host}}:/root/Infra vps0',
        '{{maindir}}/Infra/infra.sh pc compose backup-state {{hosts.srv0.user}}@{{hosts.srv0.host}}:{{hosts.srv0.infra_path}} srv0',
      ],
    },

    // Run the backup script on bigpc over SSH and pull the results down.
    {
      name: 'Wine Game Save Files',
      group: 'System Backups',
      state_dir: '{{maindir}}/Backups/Game Save Files',
      note: 'Runs the backup script on bigpc over SSH and pulls the results down.',
      commands: [
        'ssh -o BatchMode=yes {{hosts.bigpc.user}}@{{hosts.bigpc.host}} "mkdir -p /tmp/gamehomebak"',
        'rsync -aq -e "ssh -o BatchMode=yes" "{{scriptroot}}/WineGameSaveBackup/BackupGamingWinePrefixes.sh" {{hosts.bigpc.user}}@{{hosts.bigpc.host}}:/tmp/gamehomebak/',
        'ssh -o BatchMode=yes {{hosts.bigpc.user}}@{{hosts.bigpc.host}} "cd /tmp/gamehomebak && bash ./BackupGamingWinePrefixes.sh ~/Games/Installs/Synced /home/{{hosts.bigpc.user}}/Downloads/gamehomebak_out"',
        'ssh -o BatchMode=yes {{hosts.bigpc.user}}@{{hosts.bigpc.host}} "cd /tmp/gamehomebak && bash ./BackupGamingWinePrefixes.sh ~/Games/Installs/Unsynced /home/{{hosts.bigpc.user}}/Downloads/gamehomebak_out"',
        'rsync -aq -e "ssh -o BatchMode=yes" {{hosts.bigpc.user}}@{{hosts.bigpc.host}}:/home/{{hosts.bigpc.user}}/Downloads/gamehomebak_out/ "{{maindir}}/Backups/Game Save Files"',
        'ssh -o BatchMode=yes {{hosts.bigpc.user}}@{{hosts.bigpc.host}} "rm -rf /tmp/gamehomebak /home/{{hosts.bigpc.user}}/Downloads/gamehomebak_out"',
      ],
    },

    // ==================================================================== Tools =

    // Download YouTube Music playlists into the music folder.
    {
      name: 'Music (YouTube Music Download)',
      state_dir: '{{maindir}}/Media/Music',
      group: 'Tools',
      timeout: 1800,
      note: 'Downloads YouTube Music playlists into the music folder.',
      cwd: '{{scriptroot}}/YTMusicDL',
      command: 'if [ ! -f ./venv/bin/activate ]; then python -m venv venv; fi\nsource ./venv/bin/activate\npip install --upgrade -r requirements.txt\npython ytmusic_dl.py --dir {{maindir}}/Media/Music\nbash validate_m3u8s.sh {{maindir}}/Media/Music\n',
    },

    // Export the ProtonMail mailbox. Password + TOTP prompted; the export is
    // validated (fresh_dir) before being reported successful, and old exports
    // are pruned afterwards.
    {
      name: 'ProtonMail',
      group: 'Tools',
      timeout: 1800,
      state_dir: '{{maindir}}/Backups/Email',
      require: ['password'],
      tool: {
        url: 'https://proton.me/download/export-tool/proton-mail-export-cli-linux_x86_64.tar.gz',
        dir: '~/proton-mail-export-cli-linux_x86_64',
        binary: '~/proton-mail-export-cli-linux_x86_64/proton-mail-export-cli',
        extract: true,
        chmod: true,
      },
      args: [
        '{{tool_binary}}',
        '-k',
        '-o',
        'backup',
        '-d',
        '{{maindir}}/Backups/Email',
        '-u',
        '{{protonmail_email}}',
        '-p',
        '{{password}}',
        '-t',
        '{{totp}}',
      ],
      fresh_dir: '{{maindir}}/Backups/Email/{{protonmail_email}}',
      prune: {
        dir: '{{maindir}}/Backups/Email/{{protonmail_email}}',
        keep_newer: true,
      },
      note: 'Exports your ProtonMail mailbox. You will be asked for your password and TOTP code (if 2FA is enabled). The export is validated before being reported as successful.',
      prompts: [
        { key: 'password', label: 'Password', type: 'secret' },
        { key: 'totp', label: 'TOTP code (if 2FA is enabled)', type: 'secret' },
      ],
    },
  ],
};
