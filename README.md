# ImranR-Backup-and-Setup
Setup my PC, NUC, and an Ubuntu VPS.
- PC Syncs to NUC with Syncthing, and NUC backs up to Backblaze via Duplicati.
- VPS runs NextCloud to Sync Calendar, Contacts, Notes, Deck, and Files (via SSH to NUC).

## Requirements
A PC (called 'NUC' below) running a Debian based distro (Intel NUC w/ ubuntu) accessible via SSH.
A PC running a Debian based distro (Laptop w/ Pop!\_OS), that can access the first PC via passwordless SSH.
A PC (called 'VPS' below) running a Debian based distro (Google Cloud Compute VPS w/ ubuntu) accessible via SSH.

## Usage
### Setup
Use scripts in /setup to setup everything PCs (assuming fresh installs).
### Backup
Assuming everything (Syncthing, Duplicati, etc) is setup:
- Set backup/realTimeBackup.sh to run at startup on the PC.
- Run backup/manualBackup.sh whenever needed on the PC.

## Important
This repo is for personal use and is specific to my needs. Read the code before using.
