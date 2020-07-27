# ImranR-Backup-and-Setup
Setup my PC and NUC.
- PC Syncs to NUC with Syncthing, and NUC backs up to Backblaze via Duplicati.

## Requirements
A PC (called 'NUC' below) running Linux (in this case, an Intel NUC w/ Ubuntu) accessible via SSH.
A PC running Linux (in this case, a laptop w/ Windows 10 + WSL2), that can access the first PC via SSH.

## Usage
### Setup
Use NUCSetup.sh in /setup to setup NUC.
Follow the instructions in PCSetup.txt in /setup to setup PC.

### Backup
Assuming everything (Syncthing, Duplicati, etc) is setup:
- Run backup/manualBackup.sh whenever needed on a Linux terminal on the PC.

## Important
This repo is for personal use and is specific to my needs. Read the code before using.
