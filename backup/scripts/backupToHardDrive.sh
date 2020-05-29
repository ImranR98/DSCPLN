#!/bin/bash
# Prompts for mount point unless it is provided as an argument

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../../variables.sh
if [ -z "$PCMAIN" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$PCMAIN" ]; then
    echo "Some directories from ../variables.sh are missing!"
    exit
fi

HELPER="$HERE"'/get-password-helper.sh'
SUDO_ASKPASS="$HELPER" sudo -A veracrypt -d
if [ -z "$1" ]; then
	LIST="$(ls -R /dev/ | grep sd)"
	if [ ! -z "$LIST" ]; then
		DEVICE=$(zenity --entry --title="Pick Device Drive" --text="$LIST")
		if [ ! -z "$DEVICE" ]; then
			SUDO_ASKPASS="$HELPER" sudo -A veracrypt --mount "/dev/$DEVICE"
		else
			exit
		fi
	else
		zenity --warning --title="Failed" --text="No external drives found."
		exit
	fi
else
	SUDO_ASKPASS="$HELPER" sudo -A veracrypt --mount "/dev/$1"
fi
rsync -av --exclude '.stversions' --exclude '.stfolder' --exclude 'node_modules' "$PCMAIN"/ /media/veracrypt1/Main --delete
echo "$(date)" >/media/veracrypt1/Main/lastBackedUp.txt
rm -rf /media/veracrypt1/.Trash-1000
SUDO_ASKPASS="$HELPER" sudo -A veracrypt -d
echo "==============================="