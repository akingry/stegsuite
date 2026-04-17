# StegSuite

StegSuite is a desktop and browser-friendly toolkit for creating, organizing, and playing image-based MP3 steganography files.

It combines three connected pieces into one project:
- a **desktop app** for building and managing a local steg library
- a **StegMP3-compatible encoder/decoder** for hiding MP3 data inside PNG files
- a **remote player** that can stream and decode those steg PNGs on another device

## What StegSuite does

StegSuite lets you:
- generate new steg PNG files from an MP3 plus an image
- keep a searchable local library with metadata and playlists
- decode and play hidden MP3s directly from steg images
- browse and control playback from the desktop app
- optionally expose a lightweight remote player for phones or other devices on your network

## Project components

### Desktop app
The Electron app provides the main local workflow:
- browse a metadata-driven gallery
- play hidden MP3 audio from steg PNG files
- manage favorites, playlists, and track metadata
- import a new MP3 and cover image to generate a new steg PNG

### StegMP3 core
The shared encode/decode logic lives in:
- `app/scripts/steg-core.js`

This keeps the project compatible with the existing StegMP3 format.

### Remote player
The `remote-player/` app provides a browser playback surface that works with the same local library and helper service.

## Repository structure

```text
app/                Main app UI
  scripts/          Client-side app logic and steg core
  styles/           App styling
docs/               Project notes and format documentation
electron/           Electron shell entry points
library/            Local library data
  images/           Source images used to create steg files (local use)
  mp3/              Source MP3 files used to create steg files (local use)
  metadata/         Track metadata JSON files
  playlists/        Playlist indexes
  stegmp3/          Generated steg PNG files
tools/              Helper and utility scripts
remote-player/      Lightweight browser-based remote player
```

## Included in this public repository

This public repo includes:
- application code
- remote player code
- Electron shell code
- helper scripts
- metadata and generated steg PNG examples

This public repo does **not** include:
- source MP3 files from `library/mp3/`
- source image files from `library/images/`

## Quick start

### Desktop app
From the `stegsuite` folder:

```bat
start-stegsuite.cmd
```

What that does:
- installs Electron if needed
- opens the desktop app
- starts the local library helper on port `43123`
- starts the embedded local static server on port `18400`
- shuts down helper processes it started when the app closes

Manual launch:

```bat
npm install
npm run desktop
```

## Remote helper and phone player

You can run the helper without opening the desktop UI:

```bat
node tools/local-save-helper.mjs
```

By default it listens on `0.0.0.0:43123`, which allows you to:
- open `http://YOUR-HOST:43123/remote-player/` on another device
- reverse-proxy or port-forward `43123` if you want external access
- reuse the same local `library/` folder and metadata files

Useful endpoints:
- `GET /api/health`
- `GET /api/library`
- `GET /api/playlists`
- `GET /api/tracks/:id`
- `GET /api/steg/:id`
- `GET /api/artwork/:id`
- `GET /library/...`

Optional environment variables:
- `STEGSUITE_SAVE_PORT=43123`
- `STEGSUITE_HOST=0.0.0.0`

## Typical workflow

### Browse and play
- launch the app
- load the seeded or local library from `library/metadata/index.json`
- click a gallery tile to decode and play the hidden MP3
- use the built-in controls for play, pause, stop, previous, next, and seek
- use **Fullscreen artwork** for large-image playback mode

### Create a new steg track
1. launch `start-stegsuite.cmd`
2. choose an MP3 and an image
3. optionally use **Use MP3 metadata**
4. optionally use **Search MusicBrainz**
5. click **Generate and save**

The app writes:
- `library/mp3/<id>.mp3`
- `library/images/<id>.png`
- `library/stegmp3/<id>.steg.png`
- `library/metadata/<id>.json`
- `library/metadata/index.json`

## Helper scripts

- `node tools/local-save-helper.mjs` runs the local helper service used by the desktop app and optional remote player
- `node tools/sync-library.mjs` rebuilds `library/metadata/index.json` from `library/metadata/*.json`
- `node tools/metadata-fetch.mjs "artist song"` performs a quick MusicBrainz lookup
- `node tools/import-track.mjs` is the current CLI extension point placeholder

## Format and implementation notes

- Steg PNG files must remain byte-exact. Do not optimize, recompress, or resave them through normal image pipelines.
- The desktop app does not autoplay on first open. Playback begins only after track selection.
- The remote player decodes hidden MP3 audio in the browser from the served steg PNG.
- The project is designed around a practical local workflow: desktop app first, optional remote playback second.

See also:
- `docs/format-notes.md`

## License

MIT License

Copyright (c) Adam Kingry
