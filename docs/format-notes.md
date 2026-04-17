# StegSuite format notes

StegSuite keeps the existing StegMP3 format unchanged for compatibility while adding a richer local library layer around it.

## Format summary

Hidden MP3 data is stored as:
1. a header plus the first chunk of MP3 bytes in 4-bit RGB LSB payload space inside a 1920x1080 PNG
2. the remaining MP3 bytes appended after the PNG `IEND` chunk

## Metadata model

Metadata for the current implementation lives in:
- `library/metadata/*.json`
- `library/metadata/index.json`

This sidecar approach keeps existing StegMP3 files backward-compatible while still enabling richer search, filtering, and playlist behavior in the app.

## Compatibility note

The steg PNG files should be treated as byte-sensitive assets. Do not optimize, recompress, resize, or resave them through image-processing pipelines if you want the hidden payload to remain valid.

## Future extension point

A future format revision could add an optional manifest segment referenced from the header, but only if decoding remains backward-compatible with the current StegMP3 rules.

## License

MIT License

Copyright (c) Adam Kingry
