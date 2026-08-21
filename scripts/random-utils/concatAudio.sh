# concatAudio
# For all audio files in a given directory, concat all those that share a YYYYMMDD string in their file names (separated by a 0.1s 1000Hz tone)
# Very little validation done - files are assumed to be audio and required tools (ffmpeg) are assumed to be installed - errors not handled gracefully


TARGET_DIR="$1"
DEST_DIR="$2"
# Convert arguments to absolute paths and ensure they exist
TARGET_DIR="$(realpath "$TARGET_DIR")"
DEST_DIR="$(realpath "$DEST_DIR")"
if [ ! -d "$TARGET_DIR" ] || [ ! -d "$DEST_DIR" ]; then
    echo "Arguments Invalid - Provide source dir. as first argument, followed by destination dir."
    exit 1
fi
# Get the list of date strings for each date for which there are multiple files with that date string in their filename
DATES="$(ls "$TARGET_DIR" | grep -e "-20[1-2][0-9][0-1][0-9][0-3][0-9]-" -o | awk -F '-' '{print $2}' | uniq)"
# Record the current directory location so you can return to it later
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
# For each date string in the list...
DATE_COUNT=1
NUM_DATES="$(echo "$DATES" | wc -l)"
for DATE in ${DATES[@]}; do
    echo "Date "$DATE_COUNT" of "$NUM_DATES": "$DATE"..."
    # Create a temporary directory and cd into it
    TEMP_DIR="$(mktemp -d)"
    cd "$TEMP_DIR"
    # Copy all files that correspond to the date in question from the target directory into this temporary directory
    cp "$TARGET_DIR"/*-"$DATE"-* .
    # Generate a 0.1 second 1000Hz tone file and convert it to PCM
    ffmpeg -y -loglevel panic -f lavfi -i "sine=frequency=1000:duration=0.1" -af "volume=0dB" tone.wav
    ffmpeg -y -loglevel panic -i tone.wav -c:a pcm_s16le -ac 2 -ar 48000 -f s16le tone.pcm
    # For each target file in this temporary directory, convert into PCM format and append the result to a final result PCM file, followed by the tone PCM file (except the last file)
    COUNT=1
    TOTAL="$(ls *-"$DATE"-* | wc -l)"
    for FILE in *-"$DATE"-*; do
        ffmpeg -y -loglevel panic -i "$FILE" -c:a pcm_s16le -ac 2 -ar 48000 -f s16le "${FILE%.*}".pcm
        cat "${FILE%.*}".pcm >>result.pcm
        if [ ! "$COUNT" -eq "$TOTAL" ]; then
            cat tone.pcm >>result.pcm
        fi
        COUNT=$(( $COUNT + 1 ))
    done
    # Convert the result file into mp4 format, saving the result in the destination directory and using the date in the file name
    ffmpeg -y -loglevel panic -f s16le -ac 2 -ar 48000 -i result.pcm -c:a aac -b:a 192K -ac 2 "$DEST_DIR"/"$DATE"-merged.mp4
    # cd back into the directory you started from and delete the temporary directory
    cd "$HERE"
    rm -r "$TEMP_DIR"
    DATE_COUNT=$(( $DATE_COUNT + 1 ))
done
