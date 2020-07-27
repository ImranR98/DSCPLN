#!/bin/bash
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../../variables.sh
if [ -z "$PCBACKUPS" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$PCBACKUPS" ]; then
    echo "Some directories from ../variables.sh are missing!"
    exit
fi

SSHFOLDER=$(ls -a ~ | grep ".ssh$")
if [ ! -z "$SSHFOLDER" ]; then
    rsync -av ~/.ssh/ "$PCBACKUPS/.ssh"
else
    echo "SSH folder not found!"
fi