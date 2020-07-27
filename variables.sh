# Variables used in other scripts

HERE1="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

export PCMAIN=/mnt/c/Users/Imran\ Remtulla/Main
export PCBACKUPS="$PCMAIN/Backups"
export PCPICTURES="$PCMAIN/Pictures"
export PCVMS="$PCMAIN/VMs"
export PCSCHOOL="$PCMAIN/School"
export PCOTHER="$PCMAIN/Other"
export PCDOCUMENTS="$PCMAIN/Documents"
export PCACCMDPATH="$PCBACKUPS/MarkD/Notes/Primary/Acc.md"
export NUCHDDUUID="b0b66b38-9a46-437b-8ecd-20f999eff2c4"
export NUCHDDMOUNT="/media/hdd" # If this is changed, change the Syncthing and Duplicati configs, and .bashrc too.
export NUCBACKUPS="$NUCHDDMOUNT/Main/Backups"
export NUCPICTURES="$NUCHDDMOUNT/Main/Pictures"
export CLOUDSSH='root@example.com'
export CLOUDSSHPORT='22'
