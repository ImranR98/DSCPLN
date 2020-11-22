# Variables used in backup scripts
# variables are exported as needed (some are not exported directly but used to build other exported ones)

# Home Directory
HOMEDIR=~

# Main Directory
MAINDIR="$HOMEDIR/Main"

# Main Subdirectories
export BACKUPSDIR="$MAINDIR/Backups"
PICTURESDIR="$MAINDIR/Media"
export RYERSONDIR="$MAINDIR/Ryerson"
DOCUMENTSDIR="$MAINDIR/Documents"

# Downloads Directory
export DOWNLOADSDIR="$HOMEDIR/Downloads"

# Various Main Sub-Subdirectories used in backup scripts
export NOTIONBACKUPDIR="$BACKUPSDIR/Notion"
export DISCORDBACKUPDIR="$BACKUPSDIR/Discord"
export MEDIUMBACKUPDIR="$BACKUPSDIR/Medium"
export NUCFILESBACKUPDIR="$BACKUPSDIR/NUCFiles"
export PS4SAVESBACKUPDIR="$BACKUPSDIR/PS4Saves"
export REDDITBACKUPDIR="$BACKUPSDIR/Reddit"
export SSHBACKUPDIR="$BACKUPSDIR/ssh"
export STARTUPBACKUPDIR="$BACKUPSDIR/Startup"
export VMSBACKUPDIR="$BACKUPSDIR/Virtual Machines"
export GOOGLETAKEOOUTBACKUPDIR="$BACKUPSDIR"/'Google Takeout'
export CLOUDSYSTEMCTLSERVICEFILESBACKUPDIR="$BACKUPSDIR"/'Cloud Systemctl Service Files'
export BALANCEDIR="$DOCUMENTSDIR/Balance"
export PS4UNSORTEDMEDIADIR="$PICTURESDIR/Unsorted-PS4Media"

# Various Directories (not within Main) used in backup scripts
export SSHDIR="$HOMEDIR/.ssh"
export FIREFOXCONFIGDIR="$HOMEDIR/.mozilla/firefox"
export STARTUPDIR="$HOMEDIR/.config/autostart"
export VMSDIR="$HOMEDIR/vmware"

# NUC Related Variables
export NUCUSERNAME="user"; 
export LOCALNUCDOMAIN="192.0.2.1"; 
export LOCALNUCSSHPORT="22"; 
export NUCDOMAIN="home.example.com"; 
export NUCSSHPORT="9999"; 

# Cloud Related variables
export CLOUDSSH='root@example.com'
export CLOUDSSHPORT='22'

# Other Variables
export DISCORDCHATEXPORTERCLIDIR=~/DiscordChatExporter.CLI