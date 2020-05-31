# Change Nautilus bookmarks to point to Main

# Background
if [ ! -d ~/.local/share/backgrounds ]; then
    mkdir ~/.local/share/backgrounds
fi
curl 'https://images.unsplash.com/photo-1488554378835-f7acf46e6c98?ixlib=rb-1.2.1&amp;q=80&amp;fm=jpg&amp;crop=entropy&amp;cs=tinysrgb&amp;dl=hao-wang-pVq6YhmDPtk-unsplash.jpg' -o ~/.local/share/backgrounds/BG.jpg
gsettings set org.gnome.desktop.background picture-uri "file:///home/$(whoami)/.local/share/backgrounds/BG.jpg"
gsettings set org.gnome.desktop.screensaver picture-uri "file:///home/$(whoami)/.local/share/backgrounds/BG.jpg"
# Start Nautilus so config files are created (modified later)
nautilus &
sleep 5
pkill -9 nautilus
# Change nautilus bookmarks
sed -i "s|HOME/Documents|HOME/Main|g" ~/.config/user-dirs.dirs
sed -i "s|HOME/Pictures|HOME/Main/Pictures|g" ~/.config/user-dirs.dirs
sed -i "s|XDG_MUSIC_DIR|# XDG_MUSIC_DIR|g" ~/.config/user-dirs.dirs
sed -i "s|XDG_VIDEOS_DIR|# XDG_VIDEOS_DIR|g" ~/.config/user-dirs.dirs
sudo sed -i "s|PCDOCUMENTS=Documents|PCDOCUMENTS=Main|g" /etc/xdg/user-dirs.defaults
sudo sed -i "s|PICTURES=Pictures|PICTURES=Main/Pictures|g" /etc/xdg/user-dirs.defaults
sudo sed -i "s|MUSIC=Music|# MUSIC=Music|g" /etc/xdg/user-dirs.defaults
sudo sed -i "s|VIDEOS=Videos|# VIDEOS=Videos|g" /etc/xdg/user-dirs.defaults