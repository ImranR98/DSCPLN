#!/bin/bash
# Generic bash helpers for backupctl tasks. Tasks call this either as a
# subcommand (`lib.sh move --rename X DEST FILE...`) or by sourcing
# it inside their own script (`source .../lib.sh`).
# Everything is rc-checked: failures abort with set -e.

set -euo pipefail
shopt -s nullglob

# Directory containing this file (pty_runner.py lives next to it, for the
# encrypt subcommand)
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { echo "$@"; }

bctl_extract() {  # FILE DEST
  local f="$1" d="$2"
  mkdir -p "$d"
  case "$f" in
    *.zip) unzip -oq "$f" -d "$d" ;;
    *) tar -xf "$f" -C "$d" ;;
  esac
}

bctl_rsync() { rsync -aq "$@"; }
bctl_rsync_delete() { rsync -aq --delete "$@"; }

bctl_git_commit() {  # DIR — state files excluded; empty commits tolerated
  local d="$1" out
  git -C "$d" init -q
  git -C "$d" add -A . ':(exclude).backup-state-*'
  out=$(git -C "$d" commit -q -m "backupctl · $(date)" 2>&1) && return 0
  case "$out" in
    *"nothing to commit"*|*"nothing added to commit"*) return 0 ;;
  esac
  echo "$out" >&2
  return 1
}

bctl_first_glob() {  # PATTERN — print first match (e.g. MTP mounts)
  local m
  m=$(ls -d "$1" 2>/dev/null | head -1)
  [[ -n "$m" ]] && echo "$m"
}

bctl_process_and_move() {  # SRC DEST PROCESS_SCRIPT [keep_originals]
  # Copy SRC's files to a temp dir, run the process script once on it,
  # move the results into DEST, delete the originals (unless kept).
  local src="$1" dest="$2" proc="$3" keep="${4:-0}"
  local tmp f found=0
  tmp=$(mktemp -d -t bctl_pam.XXXXXX)
  for f in "$src"/*; do
    [[ -f "$f" ]] || continue
    cp -p "$f" "$tmp/$(basename "$f")"
    found=1
  done
  if [[ $found -eq 0 ]]; then
    log "No files in directory, skipped: $src"
    rm -rf "$tmp"
    return 0
  fi
  mkdir -p "$dest"
  if ! bash "$proc" "$tmp"; then
    log "Processing script failed for $src" >&2
    rm -rf "$tmp"
    return 1
  fi
  for f in "$tmp"/*; do
    mv "$f" "$dest/$(basename "$f")"
  done
  rm -rf "$tmp"
  if [[ $keep -eq 0 ]]; then
    rm -f "$src"/*
  fi
}

if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  return 0  # sourced: functions only
fi

case "${1:-}" in
  move)
    # lib.sh move [--rename NAME] [--git] DEST FILE...
    shift
    rename="" git=0 dest="" name="" count=0
    while [[ $# -gt 1 && "$1" == --* ]]; do
      case "$1" in
        --rename) rename="$2"; shift 2 ;;
        --git) git=1; shift ;;
        *) log "unknown flag: $1" >&2; exit 2 ;;
      esac
    done
    dest="$1"; shift
    if [[ -n "$rename" && $# -gt 1 ]]; then
      log "Multiple files queued but a fixed name is set — drop one file at a time" >&2
      exit 1
    fi
    mkdir -p "$dest"
    for f in "$@"; do
      name="$rename"
      [[ -z "$name" ]] && name="$(basename "$f")"
      log "Moving $(basename "$f") → $dest/$name"
      mv "$f" "$dest/$name"
      count=$((count + 1))
    done
    if [[ $git -eq 1 ]]; then
      bctl_git_commit "$dest"
    fi
    log "Moved $count file(s) → $dest"
    ;;

  copy)
    # lib.sh copy [--git] [--pre CMD] [--post CMD] DEST SRC...
    shift
    git=0 pre="" post="" dest="" src="" target="" failed=0
    while [[ $# -gt 1 && "$1" == --* ]]; do
      case "$1" in
        --git) git=1; shift ;;
        --pre) pre="$2"; shift 2 ;;
        --post) post="$2"; shift 2 ;;
        *) log "unknown flag: $1" >&2; exit 2 ;;
      esac
    done
    dest="$1"; shift
    if [[ -n "$pre" ]]; then log "\$ $pre"; eval "$pre"; fi
    mkdir -p "$dest"
    for s in "$@"; do
      if [[ ! -e "$s" ]]; then
        log "DOES NOT EXIST: $s"
        continue
      fi
      target="$dest/$(basename "$s")"
      src="$s"
      [[ -d "$s" ]] && src="$s/"
      args=()
      [[ $git -eq 1 ]] && args+=(--exclude .git/)
      if ! bctl_rsync_delete "${args[@]}" "$src" "$target"; then
        log "rsync failed for $s"
        failed=1
      elif [[ $git -eq 1 ]]; then
        bctl_git_commit "$target"
      fi
    done
    if [[ -n "$post" ]]; then log "\$ $post"; eval "$post"; fi
    if [[ $failed -eq 1 ]]; then
      log "Some sources failed to sync" >&2
      exit 1
    fi
    log "Synced sources → $dest"
    ;;

  encrypt)
    # lib.sh encrypt DEST OUTNAME FILE (passphrase in
    # AGE_PASSPHRASE, set by the task; never on the command line)
    shift
    dest="$1" outname="$2"; shift 2
    if [[ $# -ne 1 ]]; then
      log "Multiple files queued — encrypt one file at a time" >&2
      exit 1
    fi
    mkdir -p "$dest"
    AGE_PASSPHRASE="${AGE_PASSPHRASE:-}" sh -c '
      printf "%s\n%s\n" "$AGE_PASSPHRASE" "$AGE_PASSPHRASE" |
        python3 "$0" age --encrypt --passphrase -o "$1" "$2"
    ' "$LIB_DIR/pty_runner.py" "$dest/$outname" "$1"
    bctl_git_commit "$dest"
    log "Encrypted export → $dest/$outname"
    ;;

  ingest)
    # lib.sh ingest DEST SUFFIX_CMD FILE... — extract every archive into a
    # temp dir, derive an account suffix (SUFFIX_CMD runs inside the temp
    # dir), sync everything into DEST/<suffix> (or DEST when no suffix),
    # git commit.
    shift
    dest="$1" suffix_cmd="$2"; shift 2
    [[ $# -ge 1 ]] || { log "ingest: no files queued" >&2; exit 1; }
    tmp=$(mktemp -d -t bctl_ingest.XXXXXX)
    for f in "$@"; do
      log "Extracting $(basename "$f")..."
      bctl_extract "$f" "$tmp"
    done
    suffix=""
    if [[ -n "$suffix_cmd" ]]; then
      suffix=$(cd "$tmp" && eval "$suffix_cmd" 2>/dev/null) || true
      if [[ -z "$suffix" ]]; then
        log "Suffix command produced no account name — the export format may have changed" >&2
        rm -rf "$tmp"
        exit 1
      fi
    fi
    [[ -n "$suffix" ]] && dest="$dest/$suffix"
    mkdir -p "$dest"
    bctl_rsync_delete --exclude .git/ "$tmp/" "$dest"
    rm -rf "$tmp"
    bctl_git_commit "$dest"
    log "Imported into $dest"
    ;;

  validate-fresh)
    # lib.sh validate-fresh DIR [MAX_AGE_SECONDS] — fail unless the newest
    # subdir (by name) is non-empty and modified within MAX_AGE_SECONDS
    shift
    root="$1" max_age="${2:-86400}"
    [[ -d "$root" ]] || { log "No export directory found at $root" >&2; exit 1; }
    newest=$(find "$root" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -V | tail -1)
    [[ -n "$newest" ]] || { log "Export produced no backup directory" >&2; exit 1; }
    items=$(find "$root/$newest" -mindepth 1 -maxdepth 1 | wc -l)
    age=$(( $(date +%s) - $(stat -c %Y "$root/$newest") ))
    if [[ "$items" -eq 0 || "$age" -gt "$max_age" ]]; then
      log "Export directory $newest is empty or stale — the export did not complete" >&2
      exit 1
    fi
    log "Validated export: $newest ($items items)"
    ;;

  prune-exports)
    # lib.sh prune-exports DIR [--keep-newer] — delete all but the newest
    # export dir; --keep-newer keeps any dir with more files than the newest
    shift
    root="${1:-}"; shift
    keep_newer=0
    if [[ "${1:-}" == --keep-newer ]]; then keep_newer=1; fi
    [[ -d "$root" ]] || exit 0
    mapfile -t dirs < <(find "$root" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -V)
    [[ ${#dirs[@]} -ge 2 ]] || exit 0
    newest="${dirs[-1]}"
    newest_count=$(find "$root/$newest" -mindepth 1 -maxdepth 1 | wc -l)
    for d in "${dirs[@]:0:${#dirs[@]}-1}"; do
      count=$(find "$root/$d" -mindepth 1 -maxdepth 1 | wc -l)
      if [[ $keep_newer -eq 1 && $count -gt $newest_count ]]; then
        log "WARNING: previous backup '$d' has MORE files ($count) than the newest ($newest_count). NOT deleted."
      else
        rm -rf "$root/$d"
        log "Deleted old export $d"
      fi
    done
    ;;

  *)
    log "unknown subcommand: ${1:-}" >&2
    exit 2
    ;;
esac
