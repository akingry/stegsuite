# StegSuite

StegSuite is a practical first integrated build that reuses the working StegMP3 encode/decode format and the StegSong gallery playback pattern in one local app.

## What is built
- Electron desktop shell with a real app window
- Auto-started local library service and embedded local static server, no manual background-service or web-server step
- Reused StegMP3-compatible encode/decode core in `app/scripts/steg-core.js`
- Metadata-driven gallery and filtering from `library/metadata/index.json`
- Click-to-play steg image tiles with pause, stop, previous/next, and seek slider
- Library folders under `library/` for source MP3s, source images, generated steg PNGs, metadata JSON, and playlists
- Add-new-file flow that can:
  - pick an MP3 and image
  - autofill from embedded ID3 tags
  - generate a new steg PNG
  - save MP3, image, steg PNG, and metadata JSON directly into the local project library
- Online metadata hooks:
  - MusicBrainz lookup in the UI
  - helper scripts in `tools/metadata-fetch.mjs` and `tools/import-track.mjs`
- Demo library seeded from the existing `stegsong/gallery/*.png` files

## Folder structure
```text
app/
docs/
electron/
library/
  mp3/
  images/
  stegmp3/
  metadata/
  playlists/
imports/pending/
tools/
```

## Launch the desktop app
From the StegSuite folder:

```bat
start-stegsuite.cmd
```

What that does:
- installs Electron once if `node_modules` is not present yet
- opens the StegSuite desktop window
- auto-starts the local library helper on port `43123`
- auto-starts the embedded local static server on port `18400`
- shuts down the helper/server it started when the desktop app closes

Manual launch is also available:

```bat
npm install
npm run desktop
```

## Remote helper + phone player
You can also run the helper by itself, without opening the desktop UI:

```bat
node tools/local-save-helper.mjs
```

By default it listens on `0.0.0.0:43123`, so you can:
- open `http://YOUR-HOST:43123/remote-player/` on a phone
- reverse-proxy or port-forward `43123` for Internet access
- keep using the same `library/` folder and metadata files

Useful endpoints:
- `GET /api/health`
- `GET /api/library`
- `GET /api/playlists`
- `GET /api/tracks/:id`
- `GET /api/steg/:id`
- `GET /api/artwork/:id`
- `GET /library/...` for direct library file access

Optional environment variables:
- `STEGSUITE_SAVE_PORT=43123`
- `STEGSUITE_HOST=0.0.0.0`

## How to use
### Browse and play
- The seeded library loads from `library/metadata/index.json`.
- Click any gallery tile to decode the hidden MP3 from the steg PNG and play it.
- Use the custom controls for play/pause, stop, previous, next, and seek.
- Use **Fullscreen artwork** for large-image playback mode.

### Add a new track
1. Launch `start-stegsuite.cmd`.
2. Pick an MP3 and an image.
3. Optionally click **Use MP3 metadata**.
4. Optionally use **Search MusicBrainz**.
5. Click **Generate and save**.

The app writes:
- `library/mp3/<id>.mp3`
- `library/images/<id>.png`
- `library/stegmp3/<id>.steg.png`
- `library/metadata/<id>.json`
- updated `library/metadata/index.json`

## Helper scripts
- `node tools/local-save-helper.mjs` runs the local library service used internally by the desktop app and optionally by the browser app
- `node tools/sync-library.mjs` rebuilds `library/metadata/index.json` from `library/metadata/*.json`
- `node tools/metadata-fetch.mjs "artist song"` does a quick MusicBrainz lookup
- `node tools/import-track.mjs` is the current CLI extension point placeholder

## Notes
- Steg PNG files must stay byte-exact. Do not optimize, recompress, or re-save them through image pipelines.
- The seeded demo records point at existing steg PNGs. Their sidecar metadata is editable and can be expanded later.
- The desktop app does not autoplay music on first open. Playback starts only when you click a track.
- The phone player decodes the hidden MP3 in-browser from the streamed steg PNG and does not save local copies as its main playback model.
- The browser app still works if you want to host `app/` yourself, but the intended local workflow is now the Electron desktop app plus the optional remote helper/player.
