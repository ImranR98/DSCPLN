# YTMusic Downloads

Scheduled downloads of your YouTube Music library. Each run reads your
playlists, downloads missing tracks as tagged MP3s, and rebuilds one `.m3u8`
playlist file per playlist in the music folder. Existing video IDs are skipped,
so re-runs only fetch new tracks.

Auth is a pasted `browser.json` (the headers from a logged-in
`music.youtube.com` session): paste it in Settings and use **Test auth** to
confirm. It is stored on the app's volume, masked in API responses, and
rewritten before every run.

## Configuration

| Field | Meaning |
|---|---|
| `musicDir` | where downloads and the playlist `.m3u8` files land (default `~/Music`) |
| `browserJson` | ytmusicapi `browser.json` contents (write-only secret) |
| `schedule` / `notifySuccess` | `{enabled, days, at, catchUp}` (default daily 05:00) and whether successful runs notify (off by default — daily runs would be noisy) |

The image bundles Python (ytmusicapi + yt-dlp), ffmpeg and Node; yt-dlp uses
Node as its JavaScript runtime and fetches the challenge-solver script on first
use (cached under `/data/cache`).

## Running

```sh
npm start --workspace dscpln-ytmusic       # http://localhost:8080
```

Container: mount a writable volume for config/state/cache (the image uses
`/data`) and mount your music folder.

## Development

UI is React under `ui/` (built into `static/`):

```sh
npm run build:ui --workspace dscpln-ytmusic
npm test --workspace dscpln-ytmusic        # builds, then unit + browser tests
```
