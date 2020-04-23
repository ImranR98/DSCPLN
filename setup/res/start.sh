#!/bin/bash
# Mount the encrypted HDD and start syncthing and duplicati
# To be copied into NUC:~ as part of setupNUC.sh

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

source "$HERE"/variables.sh
if [ -z "$HDDMOUNT" ] || [ -z "$HDDUUID" ] || [ -z "$HDDMOUNTBACKUPS" ] || [ -z "$HDDMOUNTPICTURES" ]; then
    echo "Some environment variables are missing!"
    exit
fi

if [ ! -d "$HDDMOUNT" ]; then
	sudo mkdir "$HDDMOUNT"
fi

sudo cryptsetup luksOpen UUID="$HDDUUID" hdd
sudo mount /dev/mapper/hdd "$HDDMOUNT"

if [ ! -d "$HDDMOUNTBACKUPS" ] || [ ! -d "$HDDMOUNTPICTURES" ]; then
    echo "Some directories from variables.sh are missing!"
    exit
fi

syncthing &
duplicati-server &