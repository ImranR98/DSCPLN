# Setup a fresh install of Ubuntu on a VPS.

# curl
sudo apt install curl -y
# git
sudo apt install git -y
# rsync
sudo apt install rsync -y
# NextCloud
sudo snap install nextcloud
# Next Steps
echo 'Prepare the NextCloud backup (extract it from the .tar, move it into /var/snap/nextcloud/common, and make sure it belongs to root (sudo chown -R root:root).'
echo 'Run sudo nextcloud.import with the directory prepared above, then delete it.'
echo 'Run "sudo nextcloud.enable-https lets-encrypt" to setup https for NextCloud (assuming ports are exposed and domain is already setup).'
echo 'If the domain is not setup, you may need "sudo snap run nextcloud.occ config:system:set trusted_domains 1 --value=your.fancy.domain" during setup.'