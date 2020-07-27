#!/bin/bash
# Prompts for confirmation unless --nowait is provided as an argument

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../../variables.sh
if [ -z "$PCACCMDPATH" ] || [ -z "$PCDOCUMENTS" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -f "$PCACCMDPATH" ] || [ ! -d "$PCDOCUMENTS" ]; then
    echo "Some directories from ../variables.sh are missing!"
    exit
fi

echo "New entries for Balance.xlsx will now be generated from $PCACCMDPATH"
node "$HERE"/accMDToXLSX/accMDToXLSX.js "$PCACCMDPATH" "$PCDOCUMENTS"/Balance.xlsx
echo "Results are shown above."

if [ ! "$1" = '--nowait' ]; then
	echo "After pasting into Balance.xlsx, press enter. Waiting..."
	read choice
	echo "$(date)" > "$PCDOCUMENTS"/balanceLastUpdated.txt
fi
