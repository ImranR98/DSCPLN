#!/bin/bash
# Backup files from various sources manually
# Run from within WSL

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

while [ true ]; do

echo "============="
echo "ImranR Backup"
echo "============="
echo "Pick an option:"
echo ""
echo "1 - MarkD"
echo "2 - Balance.xlsx"
echo "3 - Seneca Matrix"
echo "4 - Firefox Bookmarks"
echo "5 - SSH Directory"
echo "6 - WSL .bashrc"
echo "7 - Reddit"
echo "8 - MySeneca Email"
echo "9 - WhatsApp"
echo "10 - Google Takeout"
echo "11 - Copy VMs"
echo "12 - PS4 Saves & Media"
echo ""
echo "Anything else - exit"
echo ""
echo "Enter an option number now:"
read choice

case $choice in

1)
  echo "==============================="
  echo "MarkD"
  "$HERE"/scripts/markd.sh
  ;;

2)
  echo "==============================="
  echo "Balance.xlsx"
  "$HERE"/scripts/balanceXLSX.sh
  ;;

3)
  echo "==============================="
  echo "Seneca Matrix"
  "$HERE"/scripts/SenecaMatrix.sh --nowait
  ;;

4)
  echo "==============================="
  echo "Firefox Bookmarks"
  "$HERE"/scripts/firefoxBookmarks.sh
  ;;

5)
  echo "==============================="
  echo "SSH Directory"
  "$HERE"/scripts/SSH.sh
  ;;

6)
  echo "==============================="
  echo "WSL .bashrc"
  "$HERE"/scripts/WSLbashrc.sh
  ;;

7) 
  echo "==============================="
  echo "Reddit"
  "$HERE"/scripts/redditBackup.sh
  ;;

8)
  echo "==============================="
  echo "MySeneca Email"
  echo "==============================="
  echo "No automation available."
  echo "Open email in outlook (in a Windows VM), then export to the Backup folder in .pst."
  echo "==============================="
  ;;

9)
  echo "==============================="
  echo "WhatsApp"
  "$HERE"/scripts/WhatsApp.sh
  ;;

10)
  echo "==============================="
  echo "Google Takeout"
  "$HERE"/scripts/googleTakeout.sh
  ;;

11)
  echo "==============================="
  echo "Copy VMs"
  "$HERE"/scripts/copyVMs.sh
  ;;

12)
  echo "==============================="
  echo "PS4 Saves & Media"
  "$HERE"/scripts/PS4.sh
  ;;

*)
  exit
  ;;
esac
echo ""
done