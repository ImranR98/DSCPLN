# YTMusicDL

Downloads all your YouTube Music playlists.

## Setup
1. `if [ ! -f ./venv/bin/activate ]; then python -m venv venv; fi`
2. `source ./venv/bin/activate`
3. `pip install -r requirements.txt`
4. Create a `.env` file with `CLIENT_ID` and `CLIENT_SECRET` for the YouTube Music API.
5. `python ytmusic_dl.py --dir ./music`
6. `bash validate_m3u8s.sh # Look for songs not in playlists and playlists with missing songs`