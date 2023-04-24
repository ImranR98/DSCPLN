#!/bin/bash

# Ensure dependencies
for dep in compare; do
    if [ -z "$(which $dep)" ]; then
        echo >&2 "The following dependency is missing: $dep"
        exit 5
    fi
done

# Usage function
function usage() {
    echo >&2 "Usage: $(basename $0) [path to unsorted PS5 media directory] [path to final PS5 media directory]"
    exit 1
}

# Validate arguments
if [ ! "$#" -eq 2 ]; then
    usage
fi
if [ ! -d "$1" ]; then
    echo >&2 "The unsorted PS5 media directory does not exist: $1."
    exit 2
fi
if [ ! -d "$2" ]; then
    echo "The final PS5 media directory does not exist: $2."
    exit 2
fi

# Run

isTrophyScreenshot() {
    # specify the two images to compare
    image1="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"/trophy_identifier_reference.jpg
    image2="$1"

    # get the dimensions of the logo image
    logo_width=$(identify -format "%w" "$image1")
    logo_height=$(identify -format "%h" "$image1")

    # calculate the offset of the logo image in the black background
    background_width=$(identify -format "%w" "$image2")
    background_height=$(identify -format "%h" "$image2")
    width_offset=$((background_width - logo_width))
    height_offset=$((background_height - logo_height))

    # run compare to determine if the logo image appears in the specified area of the black background
    image2compare="$(mktemp)".jpg
    convert "$image2" -crop ${logo_width}x${logo_height}+${width_offset}+${height_offset} "$image2compare"
    echo "$(compare -fuzz 6% -metric AE "$image2compare" "$image1" null: 2>&1)"
    rm "$image2compare"
}

echo "Non-trophy media:"

for GAME_DIR in "$1"/"Video Clips"/*; do
    GAME="$(basename "$GAME_DIR")"
    if [ ! -d "$2"/"$GAME" ]; then
        mkdir "$2"/Archive/"$GAME"
    fi
    for FILE in "$GAME_DIR"/*.mp4; do
        FILENAME="$(basename "$FILE")"
        POTENTIAL_JPG="${FILE%.*}".jpg # Same-name JPEG implies it is a trophy video/image pair
        if [ -f "$POTENTIAL_JPG" ]; then
            rm "$POTENTIAL_JPG"
            mv "$FILE" "$2"/Archive/"$GAME"/"$FILENAME"
        else
            mv "$FILE" "$2"/"$FILENAME"
            echo "$FILENAME"
        fi
    done
    rmdir -p --ignore-fail-on-non-empty "$GAME_DIR"
done

for GAME_DIR in "$1"/"Screenshots"/*; do
    GAME="$(basename "$GAME_DIR")"
    if [ ! -d "$2"/Archive/"$GAME" ]; then
        mkdir "$2"/"$GAME"
    fi
    for FILE in "$GAME_DIR"/*; do
        FILENAME="$(basename "$FILE")"
        DIFF="$(isTrophyScreenshot "$FILE")"
        if [ $DIFF -le 10 ]; then
            mv "$FILE" "$2"/Archive/"$GAME"/"$FILENAME"
        else
            mv "$FILE" "$2"/"$FILENAME"
            echo "$FILENAME"
        fi
    done
    rmdir -p --ignore-fail-on-non-empty "$GAME_DIR"
done

temp="$(mktemp)".txt
mv "$1"/lastBackedUp.txt "$temp"
rmdir "$1" && rm "$temp" || (mv "$temp" "$1"/lastBackedUp.txt && echo 'Some files remain!')