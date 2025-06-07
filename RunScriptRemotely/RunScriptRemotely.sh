#!/bin/bash

# Ensure dependencies
for dep in rsync ssh; do
    if ! command -v "$dep" &>/dev/null; then
        echo >&2 "Error: Missing required dependency: $dep"
        exit 2
    fi
done

# Store script location
HERE=$(pwd)
SCRIPTDIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)

# Usage function
function usage() {
    echo >&2 "Usage: $(basename "$0") [-p [user@]proxy[:port]] [-i file] [-s] [-d dir] [user@]hostname port local_script [remote_args...]"
    echo >&2 "Run a local script on a remote server through an optional jump host"
    echo >&2 ""
    echo >&2 "Options:"
    echo >&2 "  -p proxy   Jump host to proxy through (format: [user@]hostname[:port])"
    echo >&2 "  -i file    Additional file to copy (can be specified multiple times)"
    echo >&2 "  -s         Run remote script with sudo"
    echo >&2 "  -d dir     Remote destination directory (default: temporary directory)"
    echo >&2 ""
    echo >&2 "Positional arguments:"
    echo >&2 "  [user@]hostname   SSH target host"
    echo >&2 "  port              SSH port number"
    echo >&2 "  local_script      Path to local script to run remotely"
    echo >&2 "  remote_args...    Arguments to pass to remote script (optional)"
    exit 1
}

# Parse options
INCLUDES=()
USE_SUDO=false
DEST_DIR=""  # Initialize destination directory variable
while getopts "p:i:sd:" opt; do  # Added d: option
    case $opt in
        p) PROXY=$OPTARG ;;
        i) INCLUDES+=("$OPTARG") ;;
        s) USE_SUDO=true ;;
        d) DEST_DIR=$OPTARG ;;  # Capture destination directory
        *) usage ;;
    esac
done
shift $((OPTIND - 1))

# Validate arguments
if [ $# -lt 3 ]; then
    echo >&2 "Error: Insufficient arguments"
    usage
fi

TARGET=$1
PORT=$2
SCRIPT=$3
shift 3
REMOTE_SCRIPT_ARGS=("$@")

# Validate port number
if [[ ! "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
    echo >&2 "Error: Invalid SSH port: $PORT (must be 1-65535)"
    exit 3
fi

# Validate script exists
if [ ! -f "$SCRIPT" ]; then
    echo >&2 "Error: Script file not found: $SCRIPT"
    exit 4
fi

# Validate included files
for file in "${INCLUDES[@]}"; do
    if [ ! -f "$file" ]; then
        echo >&2 "Error: Included file not found: $file"
        exit 5
    fi
done

# Build base SSH options
SSH_OPTS=(-p "$PORT" -o "StrictHostKeyChecking=no" -o "BatchMode=yes")

# Process proxy with optional port
if [ -n "$PROXY" ]; then
    # Handle different proxy formats
    if [[ "$PROXY" =~ ^(.+):([0-9]+)$ ]]; then
        PROXY_HOST="${BASH_REMATCH[1]}"
        PROXY_PORT="${BASH_REMATCH[2]}"
    elif [[ "$PROXY" =~ ^\[(.+)\]:([0-9]+)$ ]]; then
        PROXY_HOST="[${BASH_REMATCH[1]}]"
        PROXY_PORT="${BASH_REMATCH[2]}"
    else
        PROXY_HOST="$PROXY"
        PROXY_PORT=22
    fi
    
    # Validate proxy port
    if [[ ! "$PROXY_PORT" =~ ^[0-9]+$ ]] || [ "$PROXY_PORT" -lt 1 ] || [ "$PROXY_PORT" -gt 65535 ]; then
        echo >&2 "Error: Invalid proxy port: $PROXY_PORT (must be 1-65535)"
        exit 6
    fi

    # Build ProxyCommand safely
    SSH_OPTS+=(-o "ProxyCommand=ssh -p $PROXY_PORT -W %h:%p $PROXY_HOST")
fi

# Cleanup function for temporary directory
cleanup() {
    ssh "${SSH_OPTS[@]}" "$TARGET" "rm -rf '$remote_dir'" &>/dev/null
}

# Handle destination directory
if [ -n "$DEST_DIR" ]; then
    # Use user-specified directory
    remote_dir="$DEST_DIR"
    
    # Ensure directory exists on remote host
    if ! ssh "${SSH_OPTS[@]}" "$TARGET" "mkdir -p '$remote_dir'"; then
        echo >&2 "Error: Failed to create remote directory: $remote_dir"
        exit 7
    fi
else
    # Create temporary directory on remote host
    if ! remote_dir=$(ssh "${SSH_OPTS[@]}" "$TARGET" "mktemp -d 2>/dev/null"); then
        echo >&2 "Error: Failed to create temporary directory on remote host"
        exit 7
    fi
    # Set up cleanup for temporary directory
    trap cleanup EXIT
fi

# Copy files to remote host using rsync with SSH options
files_to_copy=("$SCRIPT")
files_to_copy+=("${INCLUDES[@]}")

# Build rsync command safely
rsync_cmd=(
    rsync
    -aqz
    -e "ssh -p $PORT -o StrictHostKeyChecking=no -o BatchMode=yes"
)

# Add proxy to rsync if specified
if [ -n "$PROXY" ]; then
    rsync_cmd+=(-e "ssh -p $PORT -o StrictHostKeyChecking=no -o BatchMode=yes -o ProxyCommand='ssh -p $PROXY_PORT -W %h:%p $PROXY_HOST'")
fi

# Execute rsync command
if ! "${rsync_cmd[@]}" "${files_to_copy[@]}" "$TARGET:$remote_dir/"; then
    echo >&2 "Error: Failed to copy files to remote host"
    exit 8
fi

# Make script executable remotely
script_name=$(basename "$SCRIPT")
if ! ssh "${SSH_OPTS[@]}" "$TARGET" "chmod +x '$remote_dir/$script_name'"; then
    echo >&2 "Error: Failed to make script executable on remote host"
    exit 9
fi

# Build remote command
sudo_cmd=""
if $USE_SUDO; then
    sudo_cmd="sudo"
fi

# Execute remote script and capture exit status
remote_command="cd '$remote_dir' && $sudo_cmd './$script_name'"
if [ ${#REMOTE_SCRIPT_ARGS[@]} -gt 0 ]; then
    printf -v args_str "%q " "${REMOTE_SCRIPT_ARGS[@]}"
    remote_command+=" ${args_str% }"  # Remove trailing space
fi

ssh "${SSH_OPTS[@]}" "$TARGET" "$remote_command"
exit_status=$?

exit $exit_status