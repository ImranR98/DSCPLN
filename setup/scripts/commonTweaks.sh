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
# Disable middle click paste
gsettings set org.gnome.desktop.interface gtk-enable-primary-paste false
# Enable hot corner
gsettings set org.gnome.desktop.interface enable-hot-corners true
# Sleep after 30 min on battery
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-battery-timeout 1800
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-battery-type "'suspend'"
# Power button does nothing
gsettings set gsettings get org.gnome.settings-daemon.plugins.power power-button-action "'nothing'"
# Set the battery low warning to show up at 35%
gsettings set org.gnome.settings-daemon.plugins.power percentage-low "35"
# Set screen to dim after 15 minutes
gsettings set org.gnome.desktop.session idle-delay "uint32 900"
# Disable auto brightness
gsettings set gsettings get org.gnome.settings-daemon.plugins.power ambient-enabled "false"
# Keyboard Shortcuts
gsettings set org.gnome.settings-daemon.plugins.media-keys home "['<Super>h']"
gsettings set org.gnome.settings-daemon.plugins.media-keys www "['<Super>f']"
gsettings set org.gnome.settings-daemon.plugins.media-keys terminal "['<Super>t']"
gsettings set org.gnome.Terminal.Legacy.Keybindings:/org/gnome/terminal/legacy/keybindings/ copy '<Primary>c'
gsettings set org.gnome.Terminal.Legacy.Keybindings:/org/gnome/terminal/legacy/keybindings/ paste '<Primary>v'
gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-left "['<Ctrl><Super>Left']"
gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-right "['<Ctrl><Super>Right']"
gsettings set org.gnome.mutter.keybindings toggle-tiled-left "['<Alt><Super>Left']"
gsettings set org.gnome.mutter.keybindings toggle-tiled-right "['<Alt><Super>Right']"
gsettings set org.gnome.desktop.wm.keybindings move-to-workspace-left "['<Ctrl><Shift><Alt>Left']"
gsettings set org.gnome.desktop.wm.keybindings move-to-workspace-right "['<Ctrl><Shift><Alt>Right']"
gsettings set org.gnome.shell.keybindings toggle-overview "['<Super>Tab']"
gsettings set org.gnome.desktop.wm.keybindings close "['<Super>w']"
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