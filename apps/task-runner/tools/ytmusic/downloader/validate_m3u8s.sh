#!/bin/bash
set -e

if [ ! -d "$1" ]; then echo "Specify dir!">&2 && exit; fi
CURR_DIR="$(pwd)"
trap "cd \"$CURR_DIR\"" EXIT
cd "$1"

# For any song files that don't appear in at least one playlist, add it to an unsorted playlist or remove it
UNSORTED_PLAYLIST=UNSORTED_PLAYLIST.m3u8
PREV_UNSORTED_COUNT=0
if [ -f "$UNSORTED_PLAYLIST" ]; then
    PREV_UNSORTED_COUNT="$(cat "$UNSORTED_PLAYLIST" | grep -E '^#EXTINF:' | wc -l)"
fi

echo "#EXTM3U" >"$UNSORTED_PLAYLIST"
ALL_SONGS="$(cat *.m3u8 | grep --text '^\./')"
ID=1
for file in *.mp3; do
    regex_escaped_file="$(awk '{gsub(/[\[\]\\^$.|*+?(){}]/, "\\\\&"); print}' <<<"$file")"
    if [ -z "$(echo "$ALL_SONGS" | grep -E "^\./$regex_escaped_file")" ]; then
        if [ -f "$file" ]; then
            echo "Unsorted song: $file"
            echo "#EXTINF:$ID,${file%.*}" >>"$UNSORTED_PLAYLIST"
            echo "./$file" >>"$UNSORTED_PLAYLIST"
            ID=$(($ID + 1))
        fi
    fi
done
NEW_UNSORTED_COUNT="$(cat "$UNSORTED_PLAYLIST" | grep -E '^#EXTINF:' | wc -l)"
echo "Number of unsorted songs was $PREV_UNSORTED_COUNT, is now $NEW_UNSORTED_COUNT."

# Verify that there are no non-existent files referenced in any playlists
for playlist in *.m3u8; do
    cat "$playlist" | grep --text '^\./' | while read song; do
        if [ ! -f "$song" ]; then
            echo "NON-EXISTENT SONG: $song (IN PLAYLIST: $playlist)"
        fi
    done
done