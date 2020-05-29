#!/bin/bash
# Run various scripts to setup PC/NUC
INSTRUCTIONS="Options:
Common:
    1) Apps - Apps to install on both PC and NUC
    2) Tweaks - Settings to change on both PC and NUC
PC:
    3) Apps - Apps to install on PC
    4) Restore Files - Restore backed up home files - make sure Main has been copied to ~ first!
    5) Nautilus Tweak - Change Nautilus bookmarks to point to main (run 4 first)
    6) Next Steps - Manual steps to complete setup on PC
NUC:
    7) Apps - Apps to install on NUC
    8) Prepare Scripts - Add custom aliases to .bashrc and generate start.sh.
    9) Next Steps - Manual steps to complete setup on MUC

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
  "$HERE"/scripts/PCApps.sh
  ;;
4)
  "$HERE"/scripts/PCRestoreFiles.sh
  ;;
5)
  "$HERE"/scripts/PCNautilusTweak.sh
  ;;
6)
  "$HERE"/scripts/PCNextSteps.sh
  ;;
7)
  "$HERE"/scripts/NUCApps.sh
  ;;
8)
  "$HERE"/scripts/NUCPrepScripts.sh
  ;;
9)
  "$HERE"/scripts/NUCNextSteps.sh
  ;;
*)
  exit
  ;;
esac
echo ""
done