# ytmusic_fromdl.py
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

def extract_youtube_id(filename):
    """
    Extract YouTube Music ID from filename.
    Expected format: [VIDEO_ID] Rest of filename.ext
    """
    match = re.match(r'\[([a-zA-Z0-9_-]{11})\]', filename)
    if match:
        return match.group(1)
    return None

def parse_m3u_file(m3u_path):
    """
    Parse M3U file and extract YouTube Music IDs and track names.
    Returns list of tuples (video_id, track_name)
    """
    video_ids = []
    
    try:
        with open(m3u_path, 'r', encoding='utf-8') as file:
            lines = file.readlines()
    except UnicodeDecodeError:
        with open(m3u_path, 'r', encoding='latin-1') as file:
            lines = file.readlines()
    except Exception as e:
        logger.error(f"Error reading file {m3u_path}: {e}")
        return []
    
    current_track = None
    
    for line in lines:
        line = line.strip()
        
        # Skip empty lines and M3U headers
        if not line or line.startswith('#EXTM3U'):
            continue
            
        # Parse track info line
        if line.startswith('#EXTINF'):
            # Extract track name from #EXTINF:duration,track_name
            match = re.search(r'#EXTINF:\d+,(.+)', line)
            if match:
                current_track = match.group(1)
            continue
            
        # Parse file path line
        if line and not line.startswith('#'):
            filename = os.path.basename(line)
            video_id = extract_youtube_id(filename)
            
            if video_id:
                video_ids.append((video_id, current_track or filename))
            else:
                logger.warning(f"Could not extract YouTube ID from: {filename}")
                
            current_track = None
    
    return video_ids

def create_playlist(ytmusic, playlist_name, video_ids, description=None):
    """
    Create a new playlist on YouTube Music and add tracks.
    """
    if not video_ids:
        logger.warning(f"No valid video IDs found for playlist '{playlist_name}'")
        return None
    
    # Extract just the video IDs for playlist creation
    video_id_list = [vid for vid, _ in video_ids]
    
    try:
        # Create playlist
        playlist_id = ytmusic.create_playlist(
            title=playlist_name,
            description=description or f"Imported from M3U playlist: {playlist_name}",
            privacy_status="PRIVATE"  # Options: "PRIVATE", "PUBLIC", "UNLISTED"
        )
        
        if playlist_id:
            # Add tracks to playlist
            result = ytmusic.add_playlist_items(
                playlistId=playlist_id,
                videoIds=video_id_list
            )
            
            logger.info(f"Created playlist '{playlist_name}' with {len(video_id_list)} tracks")
            return playlist_id
        else:
            logger.error(f"Failed to create playlist '{playlist_name}'")
            return None
            
    except Exception as e:
        logger.error(f"Error creating playlist '{playlist_name}': {e}")
        return None

def process_m3u_files(ytmusic, directory_path):
    """
    Process all M3U/M3U8 files in the given directory.
    """
    
    directory = Path(directory_path)
    
    # Find all M3U and M3U8 files
    m3u_files = list(directory.glob("*.m3u")) + list(directory.glob("*.m3u8"))
    
    if not m3u_files:
        logger.warning(f"No M3U or M3U8 files found in {directory_path}")
        return
    
    logger.info(f"Found {len(m3u_files)} M3U/M3U8 files to process")
    
    for m3u_file in m3u_files:
        logger.info(f"Processing: {m3u_file.name}")
        
        # Extract playlist name from filename
        playlist_name = m3u_file.stem  # Remove extension
        
        # Parse M3U file
        video_data = parse_m3u_file(m3u_file)
        
        if video_data:
            logger.info(f"Found {len(video_data)} tracks in {m3u_file.name}")
            
            # Create playlist on YouTube Music
            playlist_id = create_playlist(ytmusic, playlist_name, video_data)
            
            if playlist_id:
                logger.info(f"Successfully created playlist: {playlist_name}")
                # Log track details
                for i, (video_id, track_name) in enumerate(video_data, 1):
                    logger.debug(f"  {i:2d}. {track_name} (ID: {video_id})")
            else:
                logger.error(f"Failed to create playlist: {playlist_name}")
        else:
            logger.warning(f"No valid tracks found in {m3u_file.name}")

def main():
    parser = argparse.ArgumentParser(description='Create YouTube Music playlists from files generated by ytmusic_dl.py')
    parser.add_argument('--dir', type=str, default='./downloads', help='Input directory')
    args = parser.parse_args()

    # Output directory
    download_dir = Path(args.dir)
    
    try:
        # Initialize YTMusic API
        print(os.environ.get('CLIENT_SECRET'))
        # ytmusic = YTMusic('oauth.json', oauth_credentials=OAuthCredentials(client_id=os.environ.get('CLIENT_ID'), client_secret=os.environ.get('CLIENT_SECRET')))
        ytmusic = YTMusic('browser.json') # OAuth fails: https://github.com/sigma67/ytmusicapi/issues/813
        logger.info("YouTube Music API initialized successfully")
        
        if not os.path.exists(download_dir):
            logger.error(f"Directory does not exist: {download_dir}")
            return
    
        logger.info(f"Processing M3U files in: {os.path.abspath(download_dir)}")
        process_m3u_files(ytmusic, download_dir)
        
    except json.JSONDecodeError:
        logger.error("Invalid OAuth file format. Please provide a valid JSON file.")
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        traceback.print_exception(type(e), e, e.__traceback__)

if __name__ == "__main__":
    main()