# Common settings tweaks

# Add Close and Minimize buttons
gsettings set org.gnome.desktop.wm.preferences button-layout ":minimize,maximize,close"
# Show date and weekday in clock
gsettings set org.gnome.desktop.interface clock-show-weekday true
gsettings set org.gnome.desktop.interface clock-show-date true
# Show battery percentage in taskbar
gsettings set org.gnome.desktop.interface show-battery-percentage true
# Enable Firefox touch scrolling
sudo sed -i "s|Exec=|Exec=env MOZ_USE_XINPUT2=1 |g" /usr/share/applications/firefox.desktop
echo "MOZ_USE_XINPUT2 DEFAULT=1" | sudo tee -a /etc/security/pam_env.conf
# Keyboard Shortcuts
gsettings set org.gnome.settings-daemon.plugins.media-keys home "['<Super>h']"
gsettings set org.gnome.settings-daemon.plugins.media-keys www "['<Super>f']"
gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-left "['<Ctrl><Super>Left']"
gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-right "['<Ctrl><Super>Right']"
gsettings set org.gnome.mutter.keybindings toggle-tiled-left "['<Alt><Super>Left']"
gsettings set org.gnome.mutter.keybindings toggle-tiled-right "['<Alt><Super>Right']"
gsettings set org.gnome.shell.keybindings toggle-overview "['<Super>Tab']"
gsettings set org.gnome.desktop.wm.keybindings close "['<Super>q']"
gsettings set org.gnome.desktop.wm.keybindings switch-applications "[]"
gsettings set org.gnome.desktop.wm.keybindings switch-applications-backward "[]"
gsettings set org.gnome.settings-daemon.plugins.media-keys custom-keybindings "['/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/']"
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/ name 'Sublime'
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/ command '/opt/sublime_text/sublime_text'
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/ binding '<Super>s'
gsettings set org.gnome.settings-daemon.plugins.media-keys custom-keybindings "['/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom1/']"
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom1/ name 'VSCode'
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom1/ command '/usr/bin/code'
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom1/ binding '<Super>c'
gsettings set org.gnome.settings-daemon.plugins.media-keys custom-keybindings "['/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/', '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom1/']"
# Background
if [ ! -d ~/.local/share/backgrounds ]; then
    mkdir ~/.local/share/backgrounds
fi
curl 'https://images.unsplash.com/photo-1488554378835-f7acf46e6c98?ixlib=rb-1.2.1&amp;q=80&amp;fm=jpg&amp;crop=entropy&amp;cs=tinysrgb&amp;dl=hao-wang-pVq6YhmDPtk-unsplash.jpg' -o ~/.local/share/backgrounds/BG.jpg
gsettings set org.gnome.desktop.background picture-uri "file:///home/$(whoami)/.local/share/backgrounds/BG.jpg"
gsettings set org.gnome.desktop.screensaver picture-uri "file:///home/$(whoami)/.local/share/backgrounds/BG.jpg"
# Firefox preferences
FFFOLDER=$(ls ~/.mozilla/firefox/ | grep ".default-release$")
if [ ! -z "$FFFOLDER" ]; then
    touch ~/.mozilla/firefox/"$FFFOLDER"/user.js
    echo 'user_pref("extensions.formautofill.available", "on");' >> ~/.mozilla/firefox/"$FFFOLDER"/user.js
    echo 'user_pref("extensions.formautofill.creditCards.available", true);' >> ~/.mozilla/firefox/"$FFFOLDER"/user.js
    echo 'user_pref("extensions.formautofill.supportedCountries", "US,CA");' >> ~/.mozilla/firefox/"$FFFOLDER"/user.js
    echo 'user_pref("browser.bookmarks.autoExportHTML", true);' >> ~/.mozilla/firefox/"$FFFOLDER"/user.js
else
    echo 'Firefox default folder was not found. You will have to make these changes to about:config manually:'
    echo 'Add payment/address autofill by 
    extensions.formautofill.available to on, extensions.formautofill.creditCards.available to true, 
    and adding the right country code to extensions.formautofill.supportedCountries.'
    echo 'Change browser.bookmarks.autoExportHTML to true.'
fi
# Natural scrolling
gsettings set org.gnome.desktop.peripherals.touchpad natural-scroll true
# Enable mouse movements while typing
gsettings set org.gnome.desktop.peripherals.touchpad disable-while-typing false