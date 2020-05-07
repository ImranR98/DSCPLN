#!/bin/bash
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../../variables.sh
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

if [ ! -d "$BACKUPS"/Notes ]; then
	mkdir "$BACKUPS"/Notes
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
firstSSHCommand="$firstSSHCommand "'mkdir ~/NCDeckBackups; sudo nextcloud.occ deck:export imranr > ~/NCDeckBackups/NextCloud-Deck-$(date +"%Y-%m-%d").json;'
ssh -t "$NEXTCLOUDSSH" -p "$NEXTCLOUDSSHPORT" "$firstSSHCommand"

rsync -av --rsh='ssh -p '"$NEXTCLOUDSSHPORT" "$NEXTCLOUDSSH":./NCBackups/ "$BACKUPS"/NextCloud --delete
echo "$(date)" > "$BACKUPS"/NextCloud/lastBackedUp.txt
rsync -av --rsh='ssh -p '"$NEXTCLOUDSSHPORT" "$NEXTCLOUDSSH":/var/snap/nextcloud/common/nextcloud/data/imranr/files/Notes/ "$BACKUPS"/Notes --delete
echo "$(date)" > "$BACKUPS"/Notes/lastBackedUp.txt
rsync -av --rsh='ssh -p '"$NEXTCLOUDSSHPORT" "$NEXTCLOUDSSH":./NCDeckBackups/ ~/.temp-NextCloudDeckBackup --delete
deckJSONFile="$(ls ~/.temp-NextCloudDeckBackup)"
if [ ! -z "$deckJSONFile" ]; then
    validDeckJSON="$(node $HERE/isJSON.js ~/.temp-NextCloudDeckBackup/$deckJSONFile)"
    if [ "$validDeckJSON" == 'true' ]; then
        rsync -av ~/.temp-NextCloudDeckBackup/ "$BACKUPS"/NextCloud-Deck --delete
        echo "$(date)" > "$BACKUPS"/NextCloud-Deck/lastBackedUp.txt
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
secondSSHCommand="$secondSSHCommand "'sudo rm -rf ~/NCDeckBackups;'
ssh -t "$NEXTCLOUDSSH" -p "$NEXTCLOUDSSHPORT" "$secondSSHCommand"