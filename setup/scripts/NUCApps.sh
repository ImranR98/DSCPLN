# Apps to install specifically on NUC

# SSH and fail2ban
sudo apt install openssh-server -y
sudo apt install fail2ban -y
sudo apt install ufw -y
sudo ufw allow OpenSSH
sudo ufw enable
# Duplicati
wget https://updates.duplicati.com/beta/duplicati_2.0.5.1-1_all.deb -O duplicati.deb ? /dev/null 2>&1
sudo dpkg -i duplicati.deb
rm duplicati.deb
sudo apt --fix-broken install
# TigerVNC
sudo apt install tigervnc-standalone-server tigervnc-xorg-extension tigervnc-viewer -y