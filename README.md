# Everything is Remixed

Interactive stem mixer for the [Everything is Free](https://github.com/ichbinsoftware/everythingisfree) album by Software-Entwicklungskit.

## About

A browser-based mixing console for the 7 tracks and 148 stems of "Everything is Free." Built with Web Audio API.

**Features:**
- Real-time mixing with volume, pan, mute, and solo
- Per-stem effects: 3-band EQ, filter, reverb, delay
- Shareable mix URLs
- 3D holographic visualizer
- Light/dark theme
- Mobile support

## The Tracks

| # | Track | BPM | Key | Stems |
|---|-------|-----|-----|-------|
| 1 | Hydrogen | 132 | D Major | 12 |
| 2 | Lithium | 124 | G minor | 38 |
| 3 | Sodium | 140 | G minor | 28 |
| 4 | Potassium | 90 | C Major | 19 |
| 5 | Rubidium | 132 | G Major | 9 |
| 6 | Caesium | 130 | C Major | 16 |
| 7 | Francium | 128 | B♭ Major | 26 |

## Related

- [ichbinsoftware/everythingisfree](https://github.com/ichbinsoftware/everythingisfree) — Album stems, artwork, and npm package
- [MANIFESTO.md](MANIFESTO.md) — Why stems are released as public domain

## Documentation

See `docs/` for technical documentation:

- `ARCHITECTURE.md` — Modular architecture, signal chain, classes
- `CLIENT_APP.md` — Audio engine, state, transport, UI, FX
- `SERVER_WORKER.md` — Routing, R2, caching, CORS
- `MIXER_SYSTEM.md` — Effects reference, state encoding, UI components
- `PERFORMANCE.md` — Animation loop, memory, and rendering optimizations

## Credits

- **Music:** Software-Entwicklungskit
- **Artwork:** Maubere

## License

CC0 1.0 Universal (public domain)
