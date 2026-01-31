# AGENTS.md

## Project Overview

"Everything Is Free" (EVR) is a web-based interactive music album and stem mixer. Users can remix tracks by manipulating individual audio stems (drums, vocals, synths, etc.) directly in the browser using the Web Audio API. Released under CC0 1.0 (public domain).

## Architecture

- **Platform**: Cloudflare Workers
- **Storage**: Cloudflare R2 (buckets named by element: `HYDROGEN`, `LITHIUM`, etc.)
- **Frontend**: Modular ES6 JavaScript served via Workers Assets
- **Audio Engine**: Web Audio API (client-side)

## File Structure

```
src/
├── standalone-mixer/
│   └── index.html                   # Standalone mixer (drag-and-drop, no dependencies)
└── workers/
    ├── everything-is-remixed-worker.js  # Worker entry point (~309 lines)
    ├── stems.json                       # Stem metadata for all tracks
    ├── {trackId}_peaks.json             # Pre-generated waveform peaks
    └── app/                             # Frontend/UI (served as assets)
        ├── mixer-app.js                 # Client orchestrator (~565 lines)
        ├── mix-style.css                # Application styles
        └── modules/                     # ES6 modules (13 total)
            ├── mixer-constants.js       # Config, defaults
            ├── mixer-audio.js           # AudioEngine class
            ├── mixer-state.js           # MixerState class
            ├── mixer-transport.js       # TransportController class
            ├── mixer-ui.js              # UIBuilder class
            ├── mixer-fx.js              # FXController class
            ├── mixer-help.js            # HelpController class
            ├── mixer-loader.js          # StemLoader class
            ├── mixer-loop.js            # AnimationManager class
            ├── mixer-waveform.js        # WaveformRenderer class
            ├── mixer-templates.js       # HTML generation functions
            ├── mixer-visualizer.js      # Holograph class (main thread)
            └── mixer-holographic-worker.js  # 3D visualizer (Web Worker)
```

## Standalone Mixer (standalone-mixer/index.html)

Self-contained stem mixer for user-provided audio files. No external dependencies, no share URL functionality (not applicable for local files).

**Features:**
- Drag-and-drop audio files (M4A, MP3, WAV, FLAC, OGG)
- Full FX chain with filter rolloff (-12/-24 dB/oct)
- Holograph visualizer
- Help system
- Performance optimizations (visibility tracking, time slicing, dirty checks)

## Key Concepts

- **Tracks**: Named after alkali metals (Hydrogen, Lithium, Sodium, Potassium, Rubidium, Caesium, Francium)
- **Stems**: Individual audio tracks that make up a song (9-38 per track)
- **FX Chain**: EQ → Filter (-12/-24 dB/oct) → Delay → Panner → Gain → Master (+ Reverb Send)
- **FX Modal**: Tabbed modal interface (EQ/FILTER tab with Slope dropdown, REVERB/DELAY tab)
- **Progress Bar**: Display-only, no seeking (use skip buttons ±10s)
- **Share URLs**: Mix state encoded in URL parameters for sharing
- **Holograph**: 3D "City Landscape" visualizer using OffscreenCanvas + Web Worker
- **Signal LED**: Per-channel LED that lights up when audio detected (>5% level)
- **Sync**: Leader-based playback with rate nudging (desktop only, ~1Hz)
- **Theme**: Light/dark mode via `data-theme` attribute, persisted in localStorage
- **Listing**: Swiss Lab periodic table design (4-column grid, element symbols)

## Module Responsibilities

| Module | Class | Purpose |
|--------|-------|---------|
| `mixer-constants.js` | - | Configuration, defaults |
| `mixer-audio.js` | `AudioEngine` | Web Audio API setup, effects chain, filter rolloff, master output |
| `mixer-state.js` | `MixerState` | Stem volume, mute/solo, FX state, URL encoding |
| `mixer-transport.js` | `TransportController` | Play, pause, seek, skip, sync, leader election |
| `mixer-ui.js` | `UIBuilder` | Channel strips, faders, meters, visibility tracking |
| `mixer-fx.js` | `FXController` | FX modal, tabbed UI, parameter control, rolloff |
| `mixer-help.js` | `HelpController` | Help modal/bottom sheet, keyboard shortcuts |
| `mixer-loader.js` | `StemLoader` | Batch loading, audio graph construction |
| `mixer-loop.js` | `AnimationManager` | Throttled loop tasks, drift correction |
| `mixer-waveform.js` | `WaveformRenderer` | Canvas waveform drawing & caching |
| `mixer-templates.js` | - | Pure HTML string generation functions |
| `mixer-visualizer.js` | `Holograph` | Main thread bridge to visualizer worker |
| `mixer-holographic-worker.js` | - | 3D "City Landscape" rendering (Web Worker) |

## Development Guidelines

- **Worker**: Serves HTML shell, routes audio/asset requests, handles R2 proxying
- **Client**: ES6 modules loaded via `type="module"` script tag
- **Audio**: Processing done in browser (gain, EQ, filter, reverb, delay, pan)
- **State**: Mix state shareable via URL parameters (`?mix=...&master=80`)
- **Style**: Light/dark theme via `data-theme` attribute, track-specific accent colors (`--track-color`)

## Performance Considerations

- **Pre-allocate buffers**: Reuse `Float32Array` for meters/waveforms (avoid GC)
- **Cache DOM refs**: Store meter/channel element references after building UI
- **GPU animation**: Use `transform: scaleY()` not `height` for meters
- **Throttle updates**: Progress bar at 10fps, meters at 30fps, holograph at 30fps
- **Time slicing**: Update half the meters per frame (30fps → 15fps effective per channel)
- **Dirty check**: Only update meter DOM if value changed by >1%
- **Cache computations**: Pass `hasSolo` result to `isStemActive()` calls
- **Visibility tracking**: Skip meter updates for off-screen channels (IntersectionObserver)
- **Memory cleanup**: Release blob objects early, URLs on page unload
- **Event delegation**: Single container listener instead of per-channel listeners
- **Event cleanup**: Call `uiBuilder.dispose()` to remove global listeners
- **Visualizer**: OffscreenCanvas + Web Worker, fake glow (2-pass), pre-allocated arrays

## Route Order (Critical)

1. Audio files: `/{trackId}/{filename}.m4a` (must be before assets)
2. Peaks JSON: `/*_peaks.json` (must be before assets)
3. Assets: `/assets/*` (JS, CSS, JSON, modules)
4. App: `/` (home) or `/{trackId}` (mixer)

## Documentation

Detailed documentation in `docs/`:
- `ARCHITECTURE.md` - Modular architecture, classes
- `CLIENT_APP.md` - Audio, state, transport, UI
- `SERVER_WORKER.md` - Routing, R2, caching
- `GUIDES.md` - Adding tracks, FX, deployment
- `MIXER_SYSTEM.md` - Effects, state encoding
- `PERFORMANCE.md` - Animation loop, memory, rendering optimizations
- `STEM_COLOR_PALETTES.md` - Color generation
- `TRACK_COLORS.md` - Track primary colors
- `PEAK_GENERATOR.md` - Waveform peaks tool

## Filter Rolloff

The filter supports two rolloff slopes selectable via the FX modal "Slope" dropdown:

| Rolloff | Implementation | Use Case |
|---------|----------------|----------|
| **-12 dB/oct** | Single BiquadFilterNode | Gentle slope, default |
| **-24 dB/oct** | 2 cascaded BiquadFilterNodes | Steeper, more surgical |

Hot-swapping rolloff requires reconnecting the audio graph (disconnect old filter, create new, reconnect EQ → Filter → Delay).

## Persona

The project embodies the philosophy that "Everything is free" and "Music should circulate like electricity." Code should reflect high engineering standards while respecting the artistic intent of radical accessibility.
