#!/bin/bash
# Prompts for confirmation unless --nowait is provided as an argument

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../variables.sh
if [ -z "$NOTIONBACKUPDIR" ] || [ -z "$BALANCEDIR" ]; then
    echo "Some environment variables are missing!"
    exit
fi
ACCMDPATH="$(echo "$NOTIONBACKUPDIR"/Acc*)"

if [ ! -f "$ACCMDPATH" ] || [ ! -d "$BALANCEDIR" ]; then
    echo "Some paths from ../variables.sh are missing!"
    exit
fi

echo "New entries for Balance.xlsx will now be generated from $ACCMDPATH"
node "$HERE"/accMDToXLSX/accMDToXLSX.js "$ACCMDPATH" "$BALANCEDIR"/Balance.xlsx
echo "Results are shown above."

if [ ! "$1" = '--nowait' ]; then
    echo "Copy these results into a text editor and replace every '\t' with a tab character. This is needed because shitty OSes like Windows ignore tab characters in the terminal, even in WSL."
	echo "Paste the results into Balance.xlsx, then press enter. Waiting..."
	read choice
    cd "$BALANCEDIR"
    git add .
    git commit . -m "$(date)"
    cd "$HERE"
fi
