# Variables used in other scripts

HERE1="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

export MAIN=~/Main
export BACKUPS="$MAIN/Backups"
export VMS="$MAIN/VMs"
export SCHOOL="$MAIN/School"
export JUNK="$MAIN/Junk"
export DOCUMENTS="$MAIN/Documents"
export ACCMDPATH="$DOCUMENTS/Notes/Primary/Acc.md"
export HDDUUID="b0b66b38-9a46-437b-8ecd-20f999eff2c4"
export HDDMOUNT="/media/hdd" # If this is changed, change the Syncthing and Duplicati configs, and .bashrc too.
export HDDMOUNTBACKUPS="$HDDMOUNT/Backups"
export HDDMOUNTPICTURES="$HDDMOUNT/Pictures"
export REALTIMESYNCDIR="$HERE1"/../realTimeSync
export NUCSSH='user@irhome.ddns.net'