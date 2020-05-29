# Change Nautilus bookmarks to point to Main

# Start Nautilus so config files are created (modified later)
nautilus &
sleep 5
pkill -9 nautilus
# Change nautilus bookmarks
sed -i "s|HOME/Documents|HOME/Main|g" .config/user-dirs.dirs
sed -i "s|HOME/Pictures|HOME/Main/Pictures|g" .config/user-dirs.dirs
sed -i "s|XDG_MUSIC_DIR|# XDG_MUSIC_DIR|g" .config/user-dirs.dirs
sed -i "s|XDG_VIDEOS_DIR|# XDG_VIDEOS_DIR|g" .config/user-dirs.dirs
sudo sed -i "s|PCDOCUMENTS=Documents|PCDOCUMENTS=Main|g" /etc/xdg/user-dirs.defaults
sudo sed -i "s|PICTURES=Pictures|PICTURES=Main/Pictures|g" /etc/xdg/user-dirs.defaults
sudo sed -i "s|MUSIC=Music|# MUSIC=Music|g" /etc/xdg/user-dirs.defaults
sudo sed -i "s|VIDEOS=Videos|# VIDEOS=Videos|g" /etc/xdg/user-dirs.defaults