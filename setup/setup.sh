#!/bin/bash
# Run various scripts to setup PC/NUC
INSTRUCTIONS="Options:
Common:
    1) Apps - Apps to install on both PC and NUC
    2) Tweaks - Settings to change on both PC and NUC
    3) Common Next Steps - Manual steps to complete setup on both PC and NUC
PC:
    4) PC Apps - Apps to install on PC
    5) Restore PC Files - Restore backed up home files - make sure Main has been copied to ~ first!
    6) PC Tweaks - Change Nautilus bookmarks to point to main (run 4 first) and change the background
    7) PC Next Steps - Manual steps to complete setup on PC
NUC:
    8) NUC Apps - Apps to install on NUC
    9) Prepare NUC Scripts - Add custom aliases to .bashrc and generate start.sh.
    10) NUC Next Steps - Manual steps to complete setup on MUC

Enter an option number now:
"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

while [ true ]; do

echo "$INSTRUCTIONS"
read choice

case $choice in

1)
  "$HERE"/scripts/commonApps.sh
  ;;
2)
  "$HERE"/scripts/commonTweaks.sh
  ;;
3)
  "$HERE"/scripts/commonNextSteps.sh
  ;;
4)
  "$HERE"/scripts/PCApps.sh
  ;;
5)
  "$HERE"/scripts/PCRestoreFiles.sh
  ;;
6)
  "$HERE"/scripts/PCTweaks.sh
  ;;
7)
  "$HERE"/scripts/PCNextSteps.sh
  ;;
8)
  "$HERE"/scripts/NUCApps.sh
  ;;
9)
  "$HERE"/scripts/NUCPrepScripts.sh
  ;;
10)
  "$HERE"/scripts/NUCNextSteps.sh
  ;;
*)
  exit
  ;;
esac
echo ""
done