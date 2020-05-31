# Restore backed up home files

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

source "$HERE"/../../variables.sh
if [ -z "$PCMAIN" ] || [ -z "$PCBACKUPS" ] || [ -z "$PCVMS" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$PCMAIN" ] || [ ! -d "$PCBACKUPS" ] || [ ! -d "$PCVMS" ]; then
    echo "Some directories from variables.sh are missing!"
    exit
fi

# File copying
rsync -av "$PCBACKUPS"/.ssh/ ~/.ssh
rsync -av "$PCVMS"/ ~/vmware
rsync -av "$PCBACKUPS"/VariousHomeFiles/Templates/ ~/Templates
rsync -av "$PCBACKUPS"/VariousHomeFiles/themes/ ~/.themes
unzip "$PCBACKUPS"/VariousHomeFiles/icons.zip -d ~/.local/share/icons
rsync -av "$PCBACKUPS"/VariousHomeFiles/autostart/ ~/.config/autostart
rsync -av "$PCBACKUPS"/VariousHomeFiles/DesktopFiles/ ~/.local/share/applications
rsync -av "$PCBACKUPS"/VariousHomeFiles/gnome-shell-extensions/ ~/.local/share/gnome-shell/extensions
cp "$PCBACKUPS"/VariousHomeFiles/.bashrc ~/
cp "$PCBACKUPS"/VariousHomeFiles/comfortable-swipe.conf "$(comfortable-swipe config path)"