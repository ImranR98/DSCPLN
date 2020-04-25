#!/bin/bash
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../../variables.sh
echo "$BACKUPS"
echo "$NEXTCLOUDSSH"
echo "$NEXTCLOUDSSHPORT"
if [ -z "$BACKUPS" ] || [ -z "$NEXTCLOUDSSH" ] || [ -z "$NEXTCLOUDSSHPORT" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$BACKUPS" ]; then
    echo "Some directories from variables.sh are missing!"
    exit
fi

if [ ! -d "$BACKUPS"/NextCloud ]; then
	mkdir "$BACKUPS"/NextCloud
fi

if [ ! -d "$BACKUPS"/NextCloud-Calendar-Contacts ]; then
	mkdir "$BACKUPS"/NextCloud-Calendar-Contacts
fi

if [ ! -d "$BACKUPS"/NextCloud-Deck ]; then
	mkdir "$BACKUPS"/NextCloud-Deck
fi

if [ ! -d ~/.temp-NextCloudDeckBackup ]; then
	mkdir ~/.temp-NextCloudDeckBackup
fi

firstSSHCommand=''
firstSSHCommand="$firstSSHCommand "'sudo nextcloud.export;'
firstSSHCommand="$firstSSHCommand "'target="$(ls /var/snap/nextcloud/common/backups/)"; mkdir ~/NCBackups; sudo tar -cvf ~/NCBackups/$target.tar /var/snap/nextcloud/common/backups/$target;'
#firstSSHCommand="$firstSSHCommand "'if [ ! -f ~/calcardbackup/calcardbackup ]; then git clone https://codeberg.org/BernieO/calcardbackup.git; fi;'
#firstSSHCommand="$firstSSHCommand "'sudo ~/calcardbackup/calcardbackup /var/snap/nextcloud/current/nextcloud -p -z;'
firstSSHCommand="$firstSSHCommand "'mkdir ~/NCDeckBackups; sudo nextcloud.occ deck:export imranr > ~/NCDeckBackups/NextCloud-Deck-$(date +"%Y-%m-%d").json;'
ssh -t "$NEXTCLOUDSSH" -p "$NEXTCLOUDSSHPORT" "$firstSSHCommand"

rsync -av --rsh='ssh -p '"$NEXTCLOUDSSHPORT" "$NEXTCLOUDSSH":./NCBackups/ "$BACKUPS"/NextCloud --delete
#rsync -av --rsh='ssh -p '"$NEXTCLOUDSSHPORT" "$NEXTCLOUDSSH":./calcardbackup/backups/ "$BACKUPS"/NextCloud-Calendar-Contacts --delete
rsync -av --rsh='ssh -p '"$NEXTCLOUDSSHPORT" "$NEXTCLOUDSSH":./NCDeckBackups/ ~/.temp-NextCloudDeckBackup --delete
deckJSONFile="$(ls ~/.temp-NextCloudDeckBackup)"
if [ ! -z "$deckJSONFile" ]; then
    validDeckJSON="$(node $HERE/isJSON.js ~/.temp-NextCloudDeckBackup/$deckJSONFile)"
    if [ "$validDeckJSON" == 'true' ]; then
        rsync -av ~/.temp-NextCloudDeckBackup/ "$BACKUPS"/NextCloud-Deck --delete
    else
        echo "$validDeckJSON"
    fi
else
    echo "Could not get NextCloud Deck backup."
fi
rm -rf ~/.temp-NextCloudDeckBackup

secondSSHCommand=''
secondSSHCommand="$secondSSHCommand "'sudo rm -rf ~/NCBackups;'
secondSSHCommand="$secondSSHCommand "'sudo rm -rf /var/snap/nextcloud/common/backups/*;'
#secondSSHCommand="$secondSSHCommand "'sudo rm -rf ~/calcardbackup/backups;'
secondSSHCommand="$secondSSHCommand "'sudo rm -rf ~/NCDeckBackups;'
ssh -t "$NEXTCLOUDSSH" -p "$NEXTCLOUDSSHPORT" "$secondSSHCommand"