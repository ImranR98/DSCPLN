#!/bin/bash
# Prompts for confirmation unless --nowait is provided as an argument

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../variables.sh
if [ -z "$PCBACKUPS" ] || [ -z "$PCDOCUMENTS" ]; then
    echo "Some environment variables are missing!"
    exit
fi
PCACCMDPATH="$(echo "$PCBACKUPS"/Notion/Personal*/Acc*)"

if [ ! -f "${PCACCMDPATH}" ] || [ ! -d "$PCDOCUMENTS" ]; then
    echo "Some paths from ../variables.sh are missing!"
    exit
fi

echo "New entries for Balance.xlsx will now be generated from $PCACCMDPATH"
node "$HERE"/accMDToXLSX/accMDToXLSX.js "$PCACCMDPATH" "$PCDOCUMENTS"/Balance.xlsx
echo "Results are shown above."

if [ ! "$1" = '--nowait' ]; then
    echo "Copy these results into a text editor and replace every '\t' with a tab character. This is needed because shitty OSes like Windows ignore tab characters in the terminal, even in WSL."
	echo "Paste the results into Balance.xlsx, then press enter. Waiting..."
	read choice
	echo "$(date)" > "$PCDOCUMENTS"/balanceLastUpdated.txt
fi
