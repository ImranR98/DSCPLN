#!/bin/bash -e

# Prepare args
WALLET_PATH="$1"
MONERO_NODE="$2"
MONERO_DAEMON_LOGIN="$3"
OUTPUT_PATH="$4"

# Ensure dependencies
for dep in curl wget rsync; do
    if [ -z "$(which $dep)" ]; then
        echo >&2 "The following dependency is missing: $dep"
        exit 2
    fi
done

# Usage function
function usage() {
    echo >&2 "Usage: $(basename $0) [path to Monero wallet file] [Monero node URL:PORT] [Monero node RPC login USERNAME:PASSWORD] [Output file path]"
    echo >&2 "Install/update the Monero CLI in ~/monero-wallet-cli, then sync a specified wallet with a specified node and export the wallet's history to a CSV file"
    exit 1
}

# =======================================

echo "STEP 1: INSTALL/UPDATE MONERO CLI."

# Prepare intermediate and final paths
HERE="$(pwd)"
TARGET_DIR=~/monero-wallet-cli
mkdir -p "$TARGET_DIR"
TEMP_DIR="$(mktemp -d)"
trap "rm -r "$TEMP_DIR"; cd "$HERE"" EXIT

# Grab latest download link
DOWNLOAD_URL="$(curl -I https://downloads.getmonero.org/linux64 | grep Location | awk '{print $2}')"
DOWNLOADED_FILE_NAME="$(echo "$DOWNLOAD_URL" | awk -F/ '{print $NF}')"

# Skip if the file was already downloaded
CURRENT_DOWNLOAD_RECORD="$(cat "$TARGET_DIR"/dlrec.txt 2>/dev/null || :)"
if [ "$CURRENT_DOWNLOAD_RECORD" = "$DOWNLOADED_FILE_NAME" ]; then
    echo "Already up to date! Found: "$DOWNLOADED_FILE_NAME""
    exit
fi

# Download to the temporary directory, then extract to the target directory
cd "$TEMP_DIR"
DOWNLOADED_FILE="$TEMP_DIR"/"$DOWNLOADED_FILE_NAME"
wget "$DOWNLOAD_URL" -O "$DOWNLOADED_FILE"
tar -xf "$DOWNLOADED_FILE"
cd ./monero-*/
echo "$DOWNLOADED_FILE_NAME" > dlrec.txt
rsync -r ./ "$TARGET_DIR"/

# Print result
NEW_VERSION="$(pwd | awk -F/ '{print $NF}')"
echo "Done! Installed: $NEW_VERSION"

# =======================================

if [ ! -f "$WALLET_PATH" ] || [ -z "$MONERO_NODE" ] || [ -z "$MONERO_DAEMON_LOGIN" ]; then
    echo "Wallet/Node info missing or incomplete! Exiting..."
    usage
fi
cd "$TEMP_DIR"

echo "STEP 2: REFRESH WALLET"

"$TARGET_DIR"/monero-wallet-cli --wallet-file="$WALLET_PATH" --daemon-address "$MONERO_NODE" --daemon-login "$MONERO_DAEMON_LOGIN" --trusted-daemon refresh

echo "STEP 3: EXPORT CSV"

"$TARGET_DIR"/monero-wallet-cli --wallet-file="$WALLET_PATH" --daemon-address "$MONERO_NODE" --daemon-login "$MONERO_DAEMON_LOGIN" --trusted-daemon export_transfers output="$OUTPUT_PATH"

# Example:
# ./monero-export.sh "/home/node/Main/Documents/Monero-wallets/imranr/imranr.keys" "nuc.example.com:18089" "$(cat ~/Main/Other/NUC-services/docker-compose.yml | grep '\--rpc-login' | awk -F '--rpc-login=' '{print $2}' | head -c -2)" ~/Downloads/monero_transactions.csv
