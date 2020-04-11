# ImranR-Backup-and-Setup
Intel NUC PC acts as a Network Attached Storage device to sync my PC to, and this repo also contains scripts to automate various storage mounting, sync, and backup tasks.

## Requirements
A PC (called 'NUC' below) running a Debian based distro (Intel NUC w/ ubuntu) accessible via SSH.
A PC running a Debian based distro (Laptop w/ Pop!\_OS), that can access the first PC via passwordless SSH.

## Usage
### Setup
Use scripts in /setup to setup both PCs (assuming fresh install).
### Backup
Assuming everything (Syncthing, Duplicati, etc) is setup:
- Set backup/realTimeBackup.sh to run at startup on the PC.
- Run backup/manualBackup.sh whenever needed on the PC.

## Important
This repo is for personal use and is specific to my needs. Read the code before using.
