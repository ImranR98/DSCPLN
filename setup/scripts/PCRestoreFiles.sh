# Restore backed up home files

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
unzip "$PCBACKUPS"/VariousHomeFiles/syncthing.zip -d ~/.config/syncthing
rsync -av "$PCBACKUPS"/VariousHomeFiles/rclone/ ~/.config/rclone
rsync -av "$PCBACKUPS"/VariousHomeFiles/DesktopFiles/ ~/.local/share/applications
cp "$PCBACKUPS"/VariousHomeFiles/.bashrc ~/
cp "$PCBACKUPS"/VariousHomeFiles/comfortable-swipe.conf "$(comfortable-swipe config path)"