# Setup a fresh install of Ubuntu on a VPS.

# curl
if [ -z $(which curl) ]; then
    sudo apt install curl -y
fi
# git
if [ -z $(which git) ]; then
    sudo apt install git -y
fi
# rsync
if [ -z $(which rsync) ]; then
    sudo apt install rsync -y
fi
# NextCloud
sudo snap install nextcloud
# Next Steps
echo 'Make sure your public SSH key is in the authorized_keys.'
echo 'Make sure the server itself has an SSH private/public key pair and can SSH into itself.'
echo 'Extract Notes backup into /root/Notes (or wherever you want) so it can be added as an external SFTP storage in NextCloud later as "Notes".'
echo 'Prepare the NextCloud backup (extract it from the .tar, move it into /var/snap/nextcloud/common, and make sure it belongs to root (sudo chown -R root:root).'
echo 'Run sudo nextcloud.import with the directory prepared above, then delete it.'
echo 'Run "sudo nextcloud.enable-https lets-encrypt" to setup https for NextCloud (assuming ports are exposed and domain is already setup).'
echo 'If the domain is not setup, you may need "sudo snap run nextcloud.occ config:system:set trusted_domains 1 --value=your.fancy.domain" during setup.'