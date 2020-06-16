# Setup .bashrc and start script for NUC

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

source "$HERE"/../../variables.sh
if [ -z "$NUCHDDMOUNT" ] || [ -z "$NUCHDDUUID" ] || [ -z "$NUCBACKUPS" ] || [ -z "$NUCPICTURES" ]; then
    echo "Some environment variables are missing!"
    exit
fi

# .bashrc
BASHRCAPPEND="# Warn if /Main doesn't exist
RED=\"\033[0;31m\"
NC=\"\033[0m\"
if [ ! -d \"$NUCHDDMOUNT\"/Main ]; then
echo -e \"\n\${RED}WARNING: \${NC}Main not found. Was start.sh run?\"
fi
# Alias
alias start=~/start.sh
alias showssh=\"sudo netstat -tnpa | grep \\\"ESTABLISHED.*sshd\\\"\""
echo "$BASHRCAPPEND" >> ~/.bashrc

# start.sh
STARTSH="HERE=\"\$(cd \"\$(dirname \"\${BASH_SOURCE[0]}\")\" >/dev/null 2>&1 && pwd)\"

if [ ! -d \"$NUCHDDMOUNT\" ]; then
	sudo mkdir \"$NUCHDDMOUNT\"
fi

sudo cryptsetup luksOpen UUID=\"$NUCHDDUUID\" hdd
sudo mount /dev/mapper/hdd \"$NUCHDDMOUNT\"

if [ ! -d \"$NUCBACKUPS\" ] || [ ! -d \"$NUCPICTURES\" ]; then
    echo \"Some directories from ../variables.sh are missing!\"
    exit
fi

syncthing &
duplicati-server &"
echo "$STARTSH" > ~/start.sh
chmod u+x ~/start.showssh

echo "Done"