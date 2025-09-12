# ytmusic_dl.py
import argparse
import json
import logging
import os
import re
import time
from pathlib import Path
import traceback

import yt_dlp
from ytmusicapi import YTMusic, OAuthCredentials

from dotenv import load_dotenv

load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger(__name__)

def sanitize_filename(name):
    """Sanitize filenames by removing invalid characters."""
    return re.sub(r'[\\/*?:"<>|]', "", name)

def get_playlist_data(ytmusic):
    """Retrieve all user playlists and their tracks."""
    playlists = []
    try:
        user_playlists = ytmusic.get_library_playlists(limit=10000)
        logger.info(f"Found {len(user_playlists)} playlists")
    except Exception as e:
        logger.error(f"Error fetching playlists: {e}")
        return []

    for playlist in user_playlists:
        if playlist['playlistId'] in ['LM', 'SE', 'FEmusic_liked_albums']:  # Skip system playlists
            continue
            
        try:
            playlist_tracks = []
            playlist_info = ytmusic.get_playlist(playlist['playlistId'], limit=10000)
            
            for track in playlist_info['tracks']:
                if not track.get('videoId'):
                    continue
                    
                # Handle different track formats
                title = track.get('title', 'Unknown Title')
                if 'artists' in track:
                    artist = ", ".join([a['name'] for a in track['artists']])
                else:
                    artist = track.get('artist', [{}])[0].get('name', 'Unknown Artist')
                
                playlist_tracks.append({
                    'videoId': track['videoId'],
                    'title': title,
                    'artist': artist
                })
            
            playlists.append({
                'id': playlist['playlistId'],
                'title': sanitize_filename(playlist['title']),
                'tracks': playlist_tracks
            })
            logger.info(f"Processed playlist: {playlist['title']} ({len(playlist_tracks)} tracks)")
        except Exception as e:
            logger.error(f"Error processing playlist {playlist['title']}: {e}")
            traceback.print_exception(type(e), e, e.__traceback__)
    
    return playlists

def download_track(video_id, track_info, download_dir):
    """Download a single track with metadata and lyrics if available."""
    base_filename = f"[{video_id}] {sanitize_filename(f"{track_info['artist']} - {track_info['title']}")}"
    output_template = str(download_dir / f"{base_filename}.%(ext)s")
    
    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': output_template,
        'postprocessors': [
            {
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '0',
            },
            {'key': 'FFmpegMetadata'},
            {'key': 'EmbedThumbnail'},
        ],
        'writelyrics': True,
        'writethumbnail': True,
        'ignoreerrors': False,
        'retries': 3,
        'fragment_retries': 3,
        'extractor_args': {
            'youtube': {
                'skip': ['dash', 'hls']
            }
        },
        'logger': logger,
    }
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            url = f'https://music.youtube.com/watch?v={video_id}'
            ydl.download([url])
            
        # Verify download success
        for ext in ['mp3', 'webm', 'm4a']:
            if (download_dir / f"{base_filename}.{ext}").exists():
                return True
        return False
        return True
    except Exception as e:
        logger.error(f"Download failed for {video_id}: {e}")
        return False

def create_playlist_files(playlists, download_dir):
    """Create M3U8 playlist files for each playlist."""
    for playlist in playlists:
        playlist_file = download_dir / f"{playlist['title']}.m3u8"
        with open(playlist_file, 'w', encoding='utf-8') as f:
            f.write("#EXTM3U\n")
            
            for ti, track in enumerate(playlist['tracks']):
                video_id = track['videoId']
                base_pattern =  f"[{video_id}] {sanitize_filename(f"{track['artist']} - {track['title']}")}"
                print(base_pattern)
                # Find matching audio files
                matches = []
                for file_path in download_dir.iterdir():
                    if file_path.stem == base_pattern:
                        matches.append(file_path)
                print(matches)
                audio_files = [f for f in matches if f.suffix in ['.mp3', '.m4a', '.webm']]
                
                if audio_files:
                    audio_file = audio_files[0].name
                    f.write(f"#EXTINF:{ti+1},{track['artist']} - {track['title']}\n")
                    f.write(f"./{audio_file}\n")

def main():
    parser = argparse.ArgumentParser(description='Download YouTube Music playlists')
    parser.add_argument('--dir', type=str, default='./downloads', help='Output directory')
    args = parser.parse_args()

    # Create output directory
    download_dir = Path(args.dir)
    download_dir.mkdir(parents=True, exist_ok=True)
    
    try:
        # Initialize YTMusic API
        print(os.environ.get('CLIENT_SECRET'))
        # ytmusic = YTMusic('oauth.json', oauth_credentials=OAuthCredentials(client_id=os.environ.get('CLIENT_ID'), client_secret=os.environ.get('CLIENT_SECRET')))
        ytmusic = YTMusic('browser.json') # OAuth fails: https://github.com/sigma67/ytmusicapi/issues/813
        logger.info("YouTube Music API initialized successfully")
        
        # Get playlist data
        playlists = get_playlist_data(ytmusic)
        if not playlists:
            logger.warning("No playlists found or an error occurred")
            return
            
        # Collect all unique tracks
        all_tracks = {}
        for playlist in playlists:
            for track in playlist['tracks']:
                video_id = track['videoId']
                if video_id not in all_tracks:
                    all_tracks[video_id] = track
        
        # Download missing tracks
        existing_files = {f.stem.split(']')[0][1:] for f in download_dir.iterdir() if ']' in f.stem}
        new_downloads = 0
        
        for video_id, track in all_tracks.items():
            if video_id in existing_files:
                logger.info(f"Skipping existing track: {track['title']} ({video_id})")
                continue
                
            logger.info(f"Downloading: {track['artist']} - {track['title']} ({video_id})")
            if download_track(video_id, track, download_dir):
                new_downloads += 1
            
        logger.info(f"Downloaded {new_downloads} new tracks")
        
        # Create playlist files
        create_playlist_files(playlists, download_dir)
        logger.info(f"Created {len(playlists)} playlist files")
        
    except json.JSONDecodeError:
        logger.error("Invalid OAuth file format. Please provide a valid JSON file.")
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        traceback.print_exception(type(e), e, e.__traceback__)

if __name__ == "__main__":
    main()