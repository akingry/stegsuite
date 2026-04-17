# StegSuite format notes

- StegSuite keeps the existing StegMP3 format unchanged for compatibility.
- Hidden MP3 data is stored as:
  1. a header plus the first chunk of MP3 bytes in 4-bit RGB LSB payload space inside a 1920x1080 PNG
  2. remaining MP3 bytes appended after the PNG IEND chunk
- Metadata for the first working version lives in `library/metadata/*.json` and `library/metadata/index.json`.
- That sidecar approach keeps existing StegMP3 files backward-compatible while still giving the gallery richer searchable metadata.
- Future format extension point: add an optional manifest segment referenced from the header only if backward-compatible decoding rules are preserved.
