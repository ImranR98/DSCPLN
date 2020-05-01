#!/bin/bash
# Uses realTimeSync scripts to continuously backup certain user directories.
# Needs to run on startup - add to startup scripts (~/.config/autostart).

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../variables.sh
if [ -z "$REALTIMESYNCDIR" ] || [ -z "$BACKUPS" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$REALTIMESYNCDIR" ] || [ ! -d "$BACKUPS" ]; then
    echo "Some directories from variables.sh are missing!"
    exit
fi

# Creating any non-existent backup directories
if [ ! -d "$BACKUPS"/VariousHomeFiles ]; then
	mkdir "$BACKUPS"/VariousHomeFiles
fi
if [ ! -d "$BACKUPS"/.ssh ]; then
	mkdir "$BACKUPS"/.ssh
fi
if [ ! -d "$BACKUPS"/VariousHomeFiles/Templates ]; then
	mkdir "$BACKUPS"/VariousHomeFiles/Templates
fi
if [ ! -d "$BACKUPS"/VariousHomeFiles/themes ]; then
	mkdir "$BACKUPS"/VariousHomeFiles/themes
fi
if [ ! -d "$BACKUPS"/VariousHomeFiles/autostart ]; then
	mkdir "$BACKUPS"/VariousHomeFiles/autostart
fi
if [ ! -d "$BACKUPS"/VariousHomeFiles/gnome-shell-extensions ]; then
	mkdir "$BACKUPS"/VariousHomeFiles/gnome-shell-extensions
fi
if [ ! -d "$BACKUPS"/VariousHomeFiles/DesktopFiles ]; then
	mkdir "$BACKUPS"/VariousHomeFiles/DesktopFiles
fi

# Create logs directory
if [ ! -d ~/IRRTSLogs ]; then
	mkdir ~/IRRTSLogs
fi

"$REALTIMESYNCDIR"/realTimeSyncDirs.sh ~/.ssh/ "$BACKUPS"/.ssh > ~/IRRTSLogs/ssh.log &
"$REALTIMESYNCDIR"/realTimeSyncDirs.sh ~/Templates/ "$BACKUPS"/VariousHomeFiles/Templates > ~/IRRTSLogs/Templates.log &
"$REALTIMESYNCDIR"/realTimeSyncDirs.sh ~/.themes/ "$BACKUPS"/VariousHomeFiles/themes > ~/IRRTSLogs/themes.log &
"$REALTIMESYNCDIR"/realTimeSyncDirs.sh ~/.config/autostart/ "$BACKUPS"/VariousHomeFiles/autostart > ~/IRRTSLogs/autostart.log &
"$REALTIMESYNCDIR"/realTimeSyncDirs.sh ~/.local/share/applications/ "$BACKUPS"/VariousHomeFiles/DesktopFiles > ~/IRRTSLogs/DesktopFiles.log &
"$REALTIMESYNCDIR"/realTimeSyncFile.sh ~/.bashrc "$BACKUPS"/VariousHomeFiles > ~/IRRTSLogs/bashrc.log &
"$REALTIMESYNCDIR"/realTimeSyncFile.sh "$(comfortable-swipe config)" "$BACKUPS"/VariousHomeFiles > ~/IRRTSLogs/comfortable-swipe.log &
"$REALTIMESYNCDIR"/realTimeSyncDirToZip.sh ~/.local/share/icons/ "$BACKUPS"/VariousHomeFiles > ~/IRRTSLogs/icons.log &