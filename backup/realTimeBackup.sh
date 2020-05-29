#!/bin/bash
# Uses realTimeSync scripts to continuously backup certain user directories.
# Needs to run on startup - add to startup scripts (~/.config/autostart).

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source "$HERE"/../variables.sh
if [ -z "$RELATIVEREALTIMESYNCDIR" ] || [ -z "$PCBACKUPS" ]; then
    echo "Some environment variables are missing!"
    exit
fi
if [ ! -d "$RELATIVEREALTIMESYNCDIR" ] || [ ! -d "$PCBACKUPS" ]; then
    echo "Some directories from ../variables.sh are missing!"
    exit
fi

# Creating any non-existent backup directories
if [ ! -d "$PCBACKUPS"/VariousHomeFiles ]; then
	mkdir "$PCBACKUPS"/VariousHomeFiles
fi
if [ ! -d "$PCBACKUPS"/.ssh ]; then
	mkdir "$PCBACKUPS"/.ssh
fi
if [ ! -d "$PCBACKUPS"/VariousHomeFiles/Templates ]; then
	mkdir "$PCBACKUPS"/VariousHomeFiles/Templates
fi
if [ ! -d "$PCBACKUPS"/VariousHomeFiles/themes ]; then
	mkdir "$PCBACKUPS"/VariousHomeFiles/themes
fi
if [ ! -d "$PCBACKUPS"/VariousHomeFiles/autostart ]; then
	mkdir "$PCBACKUPS"/VariousHomeFiles/autostart
fi
if [ ! -d "$PCBACKUPS"/VariousHomeFiles/gnome-shell-extensions ]; then
	mkdir "$PCBACKUPS"/VariousHomeFiles/gnome-shell-extensions
fi
if [ ! -d "$PCBACKUPS"/VariousHomeFiles/DesktopFiles ]; then
	mkdir "$PCBACKUPS"/VariousHomeFiles/DesktopFiles
fi

# Create logs directory
if [ ! -d ~/IRRTSLogs ]; then
	mkdir ~/IRRTSLogs
fi

"$RELATIVEREALTIMESYNCDIR"/realTimeSyncDirs.sh ~/.ssh/ "$PCBACKUPS"/.ssh > ~/IRRTSLogs/ssh.log &
"$RELATIVEREALTIMESYNCDIR"/realTimeSyncDirs.sh ~/Templates/ "$PCBACKUPS"/VariousHomeFiles/Templates > ~/IRRTSLogs/Templates.log &
"$RELATIVEREALTIMESYNCDIR"/realTimeSyncDirs.sh ~/.themes/ "$PCBACKUPS"/VariousHomeFiles/themes > ~/IRRTSLogs/themes.log &
"$RELATIVEREALTIMESYNCDIR"/realTimeSyncDirs.sh ~/.config/autostart/ "$PCBACKUPS"/VariousHomeFiles/autostart > ~/IRRTSLogs/autostart.log &
"$RELATIVEREALTIMESYNCDIR"/realTimeSyncDirs.sh ~/.local/share/applications/ "$PCBACKUPS"/VariousHomeFiles/DesktopFiles > ~/IRRTSLogs/DesktopFiles.log &
"$RELATIVEREALTIMESYNCDIR"/realTimeSyncFile.sh ~/.bashrc "$PCBACKUPS"/VariousHomeFiles > ~/IRRTSLogs/bashrc.log &
"$RELATIVEREALTIMESYNCDIR"/realTimeSyncFile.sh "$(comfortable-swipe config path)" "$PCBACKUPS"/VariousHomeFiles > ~/IRRTSLogs/comfortable-swipe.log &
"$RELATIVEREALTIMESYNCDIR"/realTimeSyncDirToZip.sh ~/.local/share/icons/ "$PCBACKUPS"/VariousHomeFiles > ~/IRRTSLogs/icons.log &