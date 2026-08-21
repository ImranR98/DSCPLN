#!/bin/bash

CURRENT_DIR="$(pwd)"
TARGET_DIR="$1"
if [ -z "$TARGET_DIR" ]; then
    TARGET_DIR="$CURRENT_DIR"
fi
TARGET_DIR="$(realpath "$TARGET_DIR")"

TEMP_DIR=$(mktemp -d)
trap "cd \"$CURRENT_DIR\"; rm -r \"$TEMP_DIR\"" EXIT
cd "$TARGET_DIR"

# Configuration
TIME_WINDOW=15  # Seconds between files to consider as part of the same group
TOLERANCE_PER_FILE=0.1   # Tolerance in seconds per file for duration comparisons

# Function to get duration of a media file in seconds (with decimal)
get_duration() {
    local file="$1"
    # Try to get duration using ffprobe
    local duration
    if duration=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$file" 2>/dev/null); then
        echo "$duration"
    else
        # Fallback: try exiftool for duration
        if duration=$(exiftool -Duration "$file" 2>/dev/null | grep -oP ':\s*\K.*' | head -1); then
            # Convert from format like "0:00:15" or "15.67 s" to seconds
            if [[ "$duration" =~ ([0-9]+):([0-9]+):([0-9.]+) ]]; then
                local hours=${BASH_REMATCH[1]}
                local minutes=${BASH_REMATCH[2]}
                local seconds=${BASH_REMATCH[3]}
                echo "$(echo "$hours * 3600 + $minutes * 60 + $seconds" | bc)" 2>/dev/null || echo "0"
            elif [[ "$duration" =~ ([0-9.]+)[[:space:]]*s ]]; then
                echo "${BASH_REMATCH[1]}"
            else
                echo "0"
            fi
        else
            echo "0"
        fi
    fi
}

# Function to extract creation timestamp from video files
get_creation_timestamp() {
    local file="$1"
    
    # Try multiple date fields in order of preference
    local create_date_fields=(
        "-CreateDate"
        "-MediaCreateDate" 
        "-TrackCreateDate"
        "-DateTimeOriginal"
    )
    
    local create_date=""
    for field in "${create_date_fields[@]}"; do
        create_date=$(exiftool $field "$file" 2>/dev/null | grep -oP ':\s*\K.*' | head -1)
        [ -n "$create_date" ] && break
    done
    
    if [ -n "$create_date" ]; then
        # Clean up the date string and convert to standard format
        local cleaned_date=$(echo "$create_date" | sed 's/^ *//;s/ *$//')
        
        # Try to parse various date formats
        local epoch
        if epoch=$(date -d "$cleaned_date" +%s 2>/dev/null); then
            echo "$epoch"
            return 0
        fi
        
        # Try parsing Snapchat format specifically (YYYY:MM:DD HH:MM:SS)
        if [[ "$cleaned_date" =~ ^([0-9]{4}):([0-9]{2}):([0-9]{2})[[:space:]]+([0-9]{2}):([0-9]{2}):([0-9]{2}) ]]; then
            local formatted_date="${BASH_REMATCH[1]}-${BASH_REMATCH[2]}-${BASH_REMATCH[3]} ${BASH_REMATCH[4]}:${BASH_REMATCH[5]}:${BASH_REMATCH[6]}"
            if epoch=$(date -d "$formatted_date" +%s 2>/dev/null); then
                echo "$epoch"
                return 0
            fi
        fi
    fi
    
    # Final fallback: file modification time
    stat -c '%Y' "$file" 2>/dev/null || echo 0
}

# Function to re-encode a single file to ensure consistent parameters
reencode_file() {
    local input_file="$1"
    local output_file="$2"
    
    echo "    Re-encoding: $(basename "$input_file")"
    
    # Use a more comprehensive re-encoding approach
    ffmpeg -nostdin -i "$input_file" \
        -c:v libx264 \
        -preset medium \
        -crf 18 \
        -pix_fmt yuv420p \
        -movflags +faststart \
        -c:a aac \
        -b:a 192k \
        -ar 48000 \
        -strict experimental \
        -y \
        "$output_file" 2>/dev/null
    
    # Verify the output file
    if [ ! -s "$output_file" ]; then
        echo "    Warning: Re-encoding failed for $input_file, using original"
        cp "$input_file" "$output_file"
    fi
}

# Function to concatenate files using filter_complex (more reliable)
concatenate_files() {
    local input_files=("$@")
    local output_file="$TEMP_DIR/concatenated.mp4"
    
    if [ ${#input_files[@]} -eq 1 ]; then
        # Single file, just copy it
        cp "${input_files[0]}" "$output_file"
        return 0
    fi
    
    # Build filter complex string
    local filter=""
    local inputs=""
    
    for i in "${!input_files[@]}"; do
        inputs+=" -i ${input_files[$i]}"
        filter+="[$i:v:0][$i:a:0]"
    done
    
    filter+="concat=n=${#input_files[@]}:v=1:a=1[outv][outa]"
    
    # Concatenate with re-encoding to ensure compatibility
    ffmpeg -nostdin $inputs \
        -filter_complex "$filter" \
        -map "[outv]" -map "[outa]" \
        -c:v libx264 \
        -preset medium \
        -crf 18 \
        -pix_fmt yuv420p \
        -movflags +faststart \
        -c:a aac \
        -b:a 192k \
        -ar 48000 \
        -strict experimental \
        -y \
        "$output_file" 2>/dev/null
    
    if [ ! -s "$output_file" ]; then
        echo "    Warning: Concatenation failed, trying alternative method..."
        
        # Alternative method: create intermediate files and use concat demuxer
        local concat_list="$TEMP_DIR/concat_list.txt"
        > "$concat_list"
        
        for input_file in "${input_files[@]}"; do
            # Ensure all files have the same parameters
            local temp_file="$TEMP_DIR/temp_$(basename "$input_file")"
            ffmpeg -nostdin -i "$input_file" \
                -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p \
                -c:a aac -b:a 128k \
                -y "$temp_file" 2>/dev/null
            echo "file '$temp_file'" >> "$concat_list"
        done
        
        ffmpeg -nostdin -f concat -safe 0 -i "$concat_list" \
            -c:v libx264 -preset medium -crf 18 \
            -c:a aac -b:a 192k \
            -movflags +faststart \
            -y "$output_file" 2>/dev/null
    fi
}

# Initialize total duration tracking
TOTAL_INPUT_DURATION=0
TOTAL_OUTPUT_DURATION=0
declare -a OUTPUT_FILES=()
declare -A GROUP_INPUT_DURATIONS  # Map output files to their total input duration
declare -A GROUP_INPUT_FILES      # Map output files to their input files
declare -A GROUP_INPUT_COUNT      # Map output files to number of input files

# Get files with their creation timestamps and durations
FILE_LIST="$TEMP_DIR/file_list.txt"
> "$FILE_LIST"

echo "Processing Snapchat files..."
for file in Snapchat-*.mp4; do
    # Skip if no files match the pattern
    [ -e "$file" ] || continue
    
    echo "  Analyzing: $file"
    
    # Get creation timestamp
    CREATED_EPOCH=$(get_creation_timestamp "$file")
    
    # If we got 0 or empty, use modification time
    if [ -z "$CREATED_EPOCH" ] || [ "$CREATED_EPOCH" = "0" ]; then
        CREATED_EPOCH=$(stat -c '%Y' "$file")
        echo "    Using modification time"
    fi
    
    # Get file duration
    FILE_DURATION=$(get_duration "$file")
    if [ -z "$FILE_DURATION" ] || [ "$FILE_DURATION" = "0" ]; then
        echo "    Warning: Could not get duration for $file, assuming 0"
        FILE_DURATION=0
    fi
    
    # Add to total using bc for floating point arithmetic
    if command -v bc >/dev/null 2>&1; then
        TOTAL_INPUT_DURATION=$(echo "$TOTAL_INPUT_DURATION + $FILE_DURATION" | bc)
    else
        # Fallback for systems without bc
        TOTAL_INPUT_DURATION=$(echo "$TOTAL_INPUT_DURATION + $FILE_DURATION" | awk '{print $1 + $2}')
    fi
    
    echo "    Duration: $FILE_DURATION seconds"
    
    # Convert epoch to readable date for debugging
    READABLE_DATE=$(date -d @"$CREATED_EPOCH" +"%Y-%m-%d %H:%M:%S" 2>/dev/null || echo "Invalid date")
    echo "    Timestamp: $CREATED_EPOCH ($READABLE_DATE)"
    
    # Store with delimiter that won't appear in filenames
    echo "${CREATED_EPOCH}|${FILE_DURATION}|$file" >> "$FILE_LIST"
done

# Check if we have any files
if [ ! -s "$FILE_LIST" ]; then
    echo "No Snapchat-*.mp4 files found."
    exit 0
fi

# Sort files by creation timestamp (numeric sort on first field)
sort -t'|' -k1,1n -o "$FILE_LIST" "$FILE_LIST"

# Debug: show sorted list
echo ""
echo "Sorted file list:"
while IFS='|' read -r epoch duration file; do
    date_str=$(date -d @"$epoch" +"%Y-%m-%d %H:%M:%S" 2>/dev/null || echo "Invalid")
    echo "  $date_str (${duration}s) - $file"
done < "$FILE_LIST"
echo ""

echo "Total input duration: $TOTAL_INPUT_DURATION seconds"
echo ""

# Process files in groups based on time proximity
CURRENT_GROUP=()
LAST_TIME=""
GROUP_NUMBER=0

process_group() {
    local files=("$@")
    local group_size=${#files[@]}
    
    if [ $group_size -eq 0 ]; then
        return
    fi
    
    GROUP_NUMBER=$((GROUP_NUMBER + 1))
    
    # Parse the first file to get timestamp for output filename
    IFS='|' read -r FIRST_FILE_EPOCH FIRST_FILE_DURATION FIRST_FILE <<< "${files[0]}"
    
    echo "Processing group $GROUP_NUMBER with $group_size file(s), starting at $(date -d @"$FIRST_FILE_EPOCH" +"%Y-%m-%d %H:%M:%S")"
    
    # Calculate total input duration for this group
    local group_input_duration=0
    local input_files_list=()
    local file_paths=()
    
    for file_info in "${files[@]}"; do
        IFS='|' read -r epoch duration file <<< "$file_info"
        
        # Add to group duration
        if command -v bc >/dev/null 2>&1; then
            group_input_duration=$(echo "$group_input_duration + $duration" | bc)
        else
            # Fallback for systems without bc
            group_input_duration=$(echo "$group_input_duration + $duration" | awk '{print $1 + $2}')
        fi
        
        file_paths+=("$file")
        input_files_list+=("$file")
        echo "    Including: $file (${duration}s)"
    done
    
    echo "    Group input duration: $group_input_duration seconds"
    
    # Determine output filename based on group size
    local OUTPUT_FN
    local output_path
    
    if [ $group_size -gt 1 ]; then
        OUTPUT_FN="Snap_$(date -d @"$FIRST_FILE_EPOCH" +%Y-%m-%d-%H%M%S)_group${GROUP_NUMBER}.mp4"
        output_path="$TARGET_DIR/$OUTPUT_FN"
        echo "    Concatenating ${#file_paths[@]} files to: $OUTPUT_FN"
        
        # Concatenate files using the reliable method
        concatenate_files "${file_paths[@]}"
        
        # Move the concatenated file to target directory
        if [ -s "$TEMP_DIR/concatenated.mp4" ]; then
            mv "$TEMP_DIR/concatenated.mp4" "$output_path"
            echo "Created: $output_path"
            OUTPUT_FILES+=("$output_path")
            GROUP_INPUT_DURATIONS["$output_path"]="$group_input_duration"
            GROUP_INPUT_FILES["$output_path"]="${input_files_list[*]}"  # Join array with spaces
            GROUP_INPUT_COUNT["$output_path"]="$group_size"
        else
            echo "    Error: Failed to create concatenated file"
            return 1
        fi
    else
        # Single file: just re-encode it
        OUTPUT_FN="Snap_$(date -d @"$FIRST_FILE_EPOCH" +%Y-%m-%d-%H%M%S)_group${GROUP_NUMBER}.mp4"
        output_path="$TARGET_DIR/$OUTPUT_FN"
        echo "    Processing single file as: $OUTPUT_FN"
        
        reencode_file "$FIRST_FILE" "$output_path"
        echo "Created: $output_path"
        OUTPUT_FILES+=("$output_path")
        GROUP_INPUT_DURATIONS["$output_path"]="$group_input_duration"
        GROUP_INPUT_FILES["$output_path"]="${input_files_list[*]}"  # Join array with spaces
        GROUP_INPUT_COUNT["$output_path"]="$group_size"
    fi
    echo ""
}

echo "Grouping files with time window of ${TIME_WINDOW}s..."
# Read the sorted file list and group files by time proximity
while IFS='' read -r line; do
    IFS='|' read -r CURRENT_TIME CURRENT_DURATION CURRENT_FILE_PATH <<< "$line"
    
    if [ -z "$LAST_TIME" ]; then
        # First file
        CURRENT_GROUP+=("$line")
    else
        # Check if current file is within TIME_WINDOW seconds of the last file
        TIME_DIFF=$((CURRENT_TIME - LAST_TIME))
        
        if [ $TIME_DIFF -le $TIME_WINDOW ]; then
            # Add to current group
            CURRENT_GROUP+=("$line")
        else
            # Process the current group and start a new one
            process_group "${CURRENT_GROUP[@]}"
            CURRENT_GROUP=("$line")
        fi
    fi
    
    LAST_TIME="$CURRENT_TIME"
done < "$FILE_LIST"

# Process the last group
if [ ${#CURRENT_GROUP[@]} -gt 0 ]; then
    process_group "${CURRENT_GROUP[@]}"
fi

# Enhanced verification step: Compare each output file with its inputs
echo "========================================="
echo "VERIFICATION STEP"
echo "========================================="
echo ""

# Calculate total output duration and verify each output file
declare -a MISMATCHED_FILES=()
local verification_failed=0

for output_file in "${OUTPUT_FILES[@]}"; do
    if [ ! -f "$output_file" ]; then
        echo "ERROR: Output file not found: $output_file"
        MISMATCHED_FILES+=("$output_file")
        verification_failed=1
        continue
    fi
    
    output_duration=$(get_duration "$output_file")
    if [ -z "$output_duration" ] || [ "$output_duration" = "0" ]; then
        echo "WARNING: Could not get duration for output file: $output_file"
        output_duration=0
    fi
    
    # Add to total output duration
    if command -v bc >/dev/null 2>&1; then
        TOTAL_OUTPUT_DURATION=$(echo "$TOTAL_OUTPUT_DURATION + $output_duration" | bc)
    else
        TOTAL_OUTPUT_DURATION=$(echo "$TOTAL_OUTPUT_DURATION + $output_duration" | awk '{print $1 + $2}')
    fi
    
    # Get expected duration from inputs
    expected_duration="${GROUP_INPUT_DURATIONS[$output_file]}"
    input_files_string="${GROUP_INPUT_FILES[$output_file]}"
    input_file_count="${GROUP_INPUT_COUNT[$output_file]}"
    
    # Calculate dynamic tolerance based on number of input files
    dynamic_tolerance=$(echo "$TOLERANCE_PER_FILE * $input_file_count" | bc 2>/dev/null)
    if [ -z "$dynamic_tolerance" ] || ! [[ "$dynamic_tolerance" =~ ^[0-9.]+$ ]]; then
        # Fallback if bc fails
        dynamic_tolerance=$(echo "$TOLERANCE_PER_FILE $input_file_count" | awk '{print $1 * $2}')
    fi
    
    echo "Checking: $(basename "$output_file")"
    echo "  Output duration: $output_duration seconds"
    echo "  Expected duration: $expected_duration seconds"
    echo "  Input files: $input_file_count"
    echo "  Dynamic tolerance: $dynamic_tolerance seconds (${TOLERANCE_PER_FILE}s per file × $input_file_count files)"
    
    # Compare durations
    if [ -n "$expected_duration" ] && [ "$expected_duration" != "0" ] && [ -n "$output_duration" ] && [ "$output_duration" != "0" ]; then
        if command -v bc >/dev/null 2>&1; then
            # Use bc for precise comparison
            DIFF=$(echo "scale=3; $expected_duration - $output_duration" | bc)
            ABS_DIFF=$(echo "scale=3; if ($DIFF < 0) -($DIFF) else $DIFF" | bc)
            
            echo "  Difference: $DIFF seconds"
            
            if (( $(echo "$ABS_DIFF <= $dynamic_tolerance" | bc -l) )); then
                echo "  ✓ PASS: Within dynamic tolerance ($dynamic_tolerance seconds)"
            else
                echo "  ✗ FAIL: Outside dynamic tolerance ($dynamic_tolerance seconds)"
                MISMATCHED_FILES+=("$output_file")
                verification_failed=1
                
                # Show input files for this output
                echo "  Input files for this output:"
                IFS=' ' read -ra input_files <<< "$input_files_string"
                for input_file in "${input_files[@]}"; do
                    input_duration=$(get_duration "$input_file")
                    echo "    - $input_file (${input_duration}s)"
                done
            fi
        else
            # Fallback comparison without bc
            INPUT_ROUNDED=$(printf "%.1f" "$expected_duration" 2>/dev/null || echo "$expected_duration")
            OUTPUT_ROUNDED=$(printf "%.1f" "$output_duration" 2>/dev/null || echo "$output_duration")
            
            echo "  Rounded expected: $INPUT_ROUNDED seconds"
            echo "  Rounded output: $OUTPUT_ROUNDED seconds"
            
            # Calculate tolerance for rounded comparison
            ROUNDED_TOLERANCE=$(echo "$dynamic_tolerance" | awk '{printf "%.1f", $1}')
            
            if (( $(echo "($INPUT_ROUNDED - $OUTPUT_ROUNDED)^2 < ($ROUNDED_TOLERANCE + 0.05)^2" | bc -l 2>/dev/null || echo "0") )); then
                echo "  ✓ PASS: Rounded values within dynamic tolerance ($ROUNDED_TOLERANCE seconds)"
            else
                echo "  ✗ FAIL: Rounded values differ by more than dynamic tolerance ($ROUNDED_TOLERANCE seconds)"
                MISMATCHED_FILES+=("$output_file")
                verification_failed=1
            fi
        fi
    else
        echo "  ⚠ WARNING: Could not get valid durations for comparison"
        echo "    Expected: '$expected_duration', Output: '$output_duration'"
        if [ -z "$expected_duration" ] || [ "$expected_duration" = "0" ]; then
            echo "    Note: Expected duration is missing or zero"
        fi
        if [ -z "$output_duration" ] || [ "$output_duration" = "0" ]; then
            echo "    Note: Output duration is missing or zero"
        fi
    fi
    echo ""
done

# Summary
echo "========================================="
echo "SUMMARY"
echo "========================================="
echo "Total input duration:  $TOTAL_INPUT_DURATION seconds"
echo "Total output duration: $TOTAL_OUTPUT_DURATION seconds"
echo "Number of output files: ${#OUTPUT_FILES[@]}"
echo "Tolerance per file: $TOLERANCE_PER_FILE seconds"
echo ""

if [ ${#MISMATCHED_FILES[@]} -eq 0 ]; then
    echo "✓ All output files passed verification!"
else
    echo "✗ Verification failed for ${#MISMATCHED_FILES[@]} file(s):"
    for file in "${MISMATCHED_FILES[@]}"; do
        echo "  - $(basename "$file")"
    done
    echo ""
    echo "Possible causes for mismatches:"
    echo "  1. Encoding/decoding issues altering durations"
    echo "  2. Corrupted or unreadable input files"
    echo "  3. FFmpeg concatenation errors"
    echo "  4. Missing metadata in input files"
    exit 1
fi

echo ""
echo "Done! Created ${#OUTPUT_FILES[@]} output file(s)."