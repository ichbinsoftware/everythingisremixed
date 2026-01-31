# CLAUDE.md

Quick reference for Claude Code working with this repository. See `docs/` for detailed documentation.

## Project Overview

Interactive stem mixer for the "Everything is Free" album by Software-Entwicklungskit. Released under CC0 1.0 (public domain).

**Related**: Main content repo at [github.com/ichbinsoftware/everythingisfree](https://github.com/ichbinsoftware/everythingisfree) hosts audio stems (WAV), artwork, and project docs.

## The Seven Tracks

| # | Track | BPM | Key | Stems | Color |
|---|-------|-----|-----|-------|-------|
| 1 | Hydrogen | 132 | D Major | 12 | `#25daf0` |
| 2 | Lithium | 124 | G minor | 38 | `#cf2739` |
| 3 | Sodium | 140 | G minor | 28 | `#f7ca47` |
| 4 | Potassium | 90 | C Major | 19 | `#8f01ff` |
| 5 | Rubidium | 132 | G Major | 9 | `#c71585` |
| 6 | Caesium | 130 | C Major | 16 | `#afa0ef` |
| 7 | Francium | 128 | B♭ Major | 26 | `#c1c1c1` |

## Key Files

### Worker & Client
```
src/workers/
├── everything-is-remixed-worker.js  # Cloudflare Worker entry point
├── stems.json                       # Stem configuration (all tracks)
├── {trackId}_peaks.json             # Pre-generated waveform peaks
└── app/                             # Frontend/UI (served as assets)
    ├── mixer-app.js                 # Client orchestrator (ES6 module)
    ├── mix-style.css                # Application styles
    └── modules/                     # ES6 modules (13 total)
        ├── mixer-constants.js       # Configuration, defaults
        ├── mixer-audio.js           # AudioEngine class (Web Audio API)
        ├── mixer-state.js           # MixerState class (stem state)
        ├── mixer-transport.js       # TransportController (playback sync)
        ├── mixer-ui.js              # UIBuilder (channel rendering)
        ├── mixer-fx.js              # FXController (effects modal)
        ├── mixer-help.js            # HelpController (help modal/bottom sheet)
        ├── mixer-loader.js          # StemLoader (batch loading)
        ├── mixer-loop.js            # AnimationManager (throttled tasks)
        ├── mixer-waveform.js        # WaveformRenderer (canvas drawing)
        ├── mixer-templates.js       # HTML template generation
        ├── mixer-visualizer.js      # Holograph class (main thread bridge)
        └── mixer-holographic-worker.js  # 3D visualizer (Web Worker)
```

### Tools & Scripts
```
src/
├── scripts/
│   ├── generate_stem_palettes.py    # Generate color palettes
│   └── extract_colors.py            # Extract artwork colors
├── standalone-mixer/
│   └── index.html                   # Standalone mixer (drag-and-drop any audio files)
├── peak-generator.html              # Generate waveform peaks (browser)
├── stem-palettes.html               # Preview color palettes
└── track-colors.html                # Preview track colors
```

**standalone-mixer/index.html**: Fully self-contained stem mixer with no external dependencies. Users can drag-and-drop their own audio files (M4A, MP3, MP4, WAV, FLAC, OGG). Includes FX modal (with filter rolloff), holograph visualizer, and help system - all inline. No share URL (not applicable for user-provided files).

## Common Commands

```bash
# Generate color palettes
python3 src/scripts/generate_stem_palettes.py

# Extract artwork colors (update base_path first!)
python3 src/scripts/extract_colors.py
```

### Generate Waveform Peaks
1. Start local server: `cd src && python3 -m http.server 8000`
2. Open `http://localhost:8000/peak-generator.html`
3. Click "Generate JSON" for each track
4. Move files: `mv ~/Downloads/*_peaks.json workers/`

## Architecture

**Signal Chain:**
```
MediaElementSource → EQ → Filter (-12/-24 dB/oct) → Delay → Panner → Gain → Master Gain → Destination
                                                              ↓
                                                         Reverb Send → Master Reverb (ConvolverNode)
```

**Filter Rolloff:** Supports -12 dB/oct (single BiquadFilter) or -24 dB/oct (2 cascaded BiquadFilters). Hot-swappable at runtime via FX modal "Slope" dropdown.

**Reverb:** Simplified for performance - just a send gain per stem to shared ConvolverNode. IR duration: 1s desktop, 0.5s mobile.

**Holograph Visualizer:** 3D "City Landscape" using OffscreenCanvas + Web Worker. Renders at 30fps with fake glow effects (2-pass drawing instead of shadowBlur).

**Signal LED:** Each channel has a small LED indicator that lights up when audio is detected (>5% level). Channel name also glows when active.

**FX Modal:** Tabbed interface with EQ/FILTER and REVERB/DELAY tabs. Opens as centered modal overlay.

**Help System:** Desktop shows centered modal, mobile shows swipeable bottom sheet. Three tabs: Controls, Shortcuts (desktop only), Tips. Press `?` to toggle. Uses cyan accent color (matches FX modal).

**Progress Bar:** Display-only (no seeking). Use skip buttons for navigation.

**Theme System:** Light/dark mode via `data-theme` attribute on document root. Stored in localStorage. Early loading script in `<head>` prevents flash. Theme-aware: listing grid, start overlay, waveforms, holograph visualizer.

**Route Order (worker):**
1. Audio files: `/{trackId}/{filename}.m4a`
2. Peaks JSON: `/*_peaks.json`
3. Assets: `/assets/*`
4. App: `/` or `/{trackId}`

## Conventions

- **Colors**: Lowercase hex (`#25daf0`), VOX LEAD gets primary track color
- **CSS**: Static styles in `mix-style.css`, `--track-color` injected dynamically
- **Theme**: `data-theme` attribute (`dark`/`light`) on `<html>`, stored in localStorage
- **Listing**: Swiss Lab periodic table design (4-column grid with element symbols)
- **Share URL**: `?mix=idx:vol:mute:solo:pan:...&master=80`
- **Mobile**: Batch size 3, FFT 64; Desktop: Batch 10, FFT 128

## Deployment

**Cloudflare Configuration:**
- Workers Assets: `env.ASSETS` binding for JS/CSS/JSON
- R2 Buckets: One per track (HYDROGEN, LITHIUM, etc.)

```toml
[assets]
directory = "./src/workers"
binding = "ASSETS"

[[r2_buckets]]
binding = "HYDROGEN"
bucket_name = "hydrogen-stems"
```

## Documentation

Detailed docs in `docs/`:
- `ARCHITECTURE.md` - Modular architecture, signal chain, classes
- `CLIENT_APP.md` - Audio engine, state, transport, UI, FX
- `SERVER_WORKER.md` - Routing, R2, caching, CORS
- `GUIDES.md` - Adding tracks, FX, deployment
- `MIXER_SYSTEM.md` - Effects reference, state encoding, UI components
- `PERFORMANCE.md` - Animation loop, memory, and rendering optimizations
- `STEM_COLOR_PALETTES.md` - Color palette generation system
- `TRACK_COLORS.md` - Track primary colors
- `PEAK_GENERATOR.md` - Waveform peak generation tool

## Credits

- **Music**: Software-Entwicklungskit
- **Artwork**: Maubere
- **License**: CC0 1.0 Universal (public domain)
