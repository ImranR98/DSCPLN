# Variables used in other scripts

HERE1="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

export WINDOWSHOME='/mnt/c/Users/ImranR'
export WINDOWSMANUALAPPS='/mnt/c/ManualApps'

export PCMAIN="$WINDOWSHOME/Main"
export PCBACKUPS="$PCMAIN/Backups"
export PCPICTURES="$PCMAIN/Media"
export PCVMS="$PCMAIN/VMs"
export PCRYERSON="$PCMAIN/Ryerson"
export PCOTHER="$PCMAIN/Other"
export PCDOCUMENTS="$PCMAIN/Documents"

export NUCUSERNAME="user"; 
export LOCALNUCDOMAIN="192.0.2.1"; 
export LOCALNUCSSHPORT="22"; 
export NUCDOMAIN="home.example.com"; 
export NUCSSHPORT="9999"; 
export NUCHDDUUID="b0b66b38-9a46-437b-8ecd-20f999eff2c4"
export NUCHDDMOUNT="/media/hdd" # If this is changed, change the Syncthing and Duplicati configs, and .bashrc too.
export NUCBACKUPS="$NUCHDDMOUNT/Main/Backups"
export NUCPICTURES="$NUCHDDMOUNT/Main/Media"

export CLOUDSSH='root@example.com'
export CLOUDSSHPORT='22'

export DISCORDCHATEXPORTERCLI='/mnt/c/ManualApps/DiscordChatExporter.CLI'