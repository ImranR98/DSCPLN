#!/bin/bash
# Prompts for confirmation unless --nowait is provided as an argument

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../../variables.sh
if [ -z "$ACCMDPATH" ] || [ -z "$DOCUMENTS" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -f "$ACCMDPATH" ] || [ ! -d "$DOCUMENTS" ]; then
    echo "Some directories from variables.sh are missing!"
    exit
fi

echo "New entries for Balance.xlsx will now be generated from $ACCMDPATH"
node "$HERE"/accMDToXLSX/accMDToXLSX.js "$ACCMDPATH" "$DOCUMENTS"/Balance.xlsx
echo "Results are shown above."

if [ ! "$1" = '--nowait' ]; then
	echo "After pasting into Balance.xlsx, press enter. Waiting..."
	read choice
	echo "$(date)" > "$DOCUMENTS"/balanceLastUpdated.txt
fi
