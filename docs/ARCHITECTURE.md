# Architecture Overview

**Everything is Remixed (EVR Mixer)** uses a modular ES6 architecture for an interactive stem mixer application. The design separates concerns across a Cloudflare Worker and client-side modules, enabling real-time audio manipulation with the Web Audio API.

## The Architecture

The application is split across a server-side worker and multiple client-side modules:

### 1. Cloudflare Worker (Server-side)
**File:** `everything-is-remixed-worker.js` (~309 lines)
- **Role:** The entry point. Handles HTTP routing, request processing, and asset serving.
- **Key Functions:**
    - Serves the main HTML application shell via `serveApp()`.
    - Proxies stem audio files via `/{trackId}/{filename}.m4a` endpoints.
    - Serves client-side JavaScript assets from ASSETS binding.
    - Injects configuration data (track metadata, stem config, initial mix state) into the HTML template.

### 2. Client Application (Orchestrator)
**File:** `app/mixer-app.js` (~565 lines)
- **Role:** The main orchestrator. Coordinates all modules and manages the application lifecycle.
- **Key Functions:**
    - Initializes all modules (audio, state, transport, UI, FX, visualizer).
    - Loads stem audio files with progress tracking via StemLoader.
    - Sets up transport controls and user interactions.
    - Handles share URL generation and parsing.
    - Manages play/pause states and animation loop.
    - Coordinates the holographic visualizer.

### 3. Modular System (13 Modules)

**Modules Directory:** `src/workers/app/modules/`

| Module | Lines | Responsibility |
|--------|-------|----------------|
| **mixer-constants.js** | ~59 | Configuration constants, default FX state, batch sizes, FFT sizes |
| **mixer-audio.js** | ~174 | Web Audio API setup, effects chain creation, master output |
| **mixer-state.js** | ~151 | Stem state management, mute/solo logic, share URL encoding |
| **mixer-transport.js** | ~270 | Playback control, sync, leader election, playback rate nudging |
| **mixer-ui.js** | ~321 | Channel interaction, view state, DOM updates, visibility tracking |
| **mixer-fx.js** | ~266 | FX modal logic, parameter binding, tabbed interface |
| **mixer-help.js** | ~165 | Help modal/bottom sheet, swipe-to-dismiss (mobile) |
| **mixer-loop.js** | ~67 | Animation loop management, throttling, drift correction |
| **mixer-waveform.js** | ~82 | Canvas rendering of audio waveforms |
| **mixer-templates.js** | ~200 | Pure HTML string generation for UI components (channels, FX, help) |
| **mixer-loader.js** | ~174 | Stem download, batch loading, audio graph construction |
| **mixer-visualizer.js** | ~86 | Holograph class (main thread ↔ worker bridge) |
| **mixer-holographic-worker.js** | ~287 | 3D visualizer rendering (Web Worker) |

## Web Audio Signal Chain

The mixer uses the Web Audio API for real-time audio processing with the following per-stem signal chain:

```
MediaElementSource
        │
        ▼
    ┌───────┐
    │  EQ   │ (3-band: Low Shelf @ 250Hz, Peak @ 1kHz, High Shelf @ 4kHz)
    └───┬───┘
        │
        ▼
    ┌────────┐
    │ Filter │ (Biquad: lowpass/highpass/bandpass)
    └───┬────┘
        │
        ▼
    ┌───────┐
    │ Delay │ (Dry/Wet mix with feedback loop)
    └───┬───┘
        │
        ▼
    ┌────────┐       ┌───────────────┐
    │ Panner │──────►│  Reverb Send  │──────► Master Reverb (ConvolverNode)
    └───┬────┘       │   (GainNode)  │              │
        │            └───────────────┘              │
        ▼                                          │
    ┌───────┐                                      │
    │ Gain  │◄─────────────────────────────────────┘
    └───┬───┘
        │
        ▼
    ┌──────────┐
    │ Analyser │ (Per-stem meter)
    └───┬──────┘
        │
        ▼
    ┌─────────────┐      ┌─────────────────────┐
    │ Master Gain │─────►│ Holograph Analyser  │
    └───┬─────────┘      └─────────────────────┘
        │
        ▼
    ┌───────────────┐
    │ Master Meter  │
    └───┬───────────┘
        │
        ▼
    ┌─────────────┐
    │ Destination │
    └─────────────┘
```

**Reverb:** Simplified for performance - each stem has just a GainNode sending to a shared ConvolverNode. IR duration: 1s (desktop) / 0.5s (mobile).

## Module Dependency Graph

```
app/mixer-app.js (Orchestrator)
├── app/modules/mixer-constants.js
├── app/modules/mixer-audio.js (AudioEngine)
├── app/modules/mixer-state.js (MixerState)
├── app/modules/mixer-ui.js (UIBuilder)
│   ├── mixer-templates.js
│   └── mixer-waveform.js (WaveformRenderer)
├── app/modules/mixer-fx.js (FXController)
│   └── mixer-templates.js
├── app/modules/mixer-help.js (HelpController)
│   └── mixer-templates.js
├── app/modules/mixer-transport.js (TransportController)
├── app/modules/mixer-loader.js (StemLoader)
├── app/modules/mixer-visualizer.js (Holograph)
│   └── mixer-holographic-worker.js (Web Worker)
└── app/modules/mixer-loop.js (AnimationManager)
```

**Module Responsibilities:**

- **constants**: Configuration values, FFT sizes, defaults
- **audio**: Web Audio API context, node creation, master output
- **state**: Stem state, mute/solo logic, URL encoding
- **ui**: Channel rendering, DOM interaction, visibility tracking
- **fx**: Effects modal, parameter binding, tabbed UI
- **help**: Help modal (desktop) / bottom sheet (mobile), keyboard shortcut
- **transport**: Playback sync, leader election, rate nudging
- **loader**: Batch loading, audio graph construction
- **visualizer**: Main thread bridge to holograph worker, theme updates
- **loop**: Manages `requestAnimationFrame` and task throttling
- **waveform**: Handles canvas drawing operations (theme-aware)
- **templates**: Generates HTML strings (View layer)


## Design Benefits

- **No Circular Dependencies**: Clean unidirectional dependency flow
- **Separation of Concerns**: Each module handles a single responsibility
- **Pure Configuration**: Constants module contains no logic
- **Testability**: Each module can be tested in isolation
- **Performance**: No build step overhead, native ES6 module loading
- **Maintainability**: Clear boundaries between audio, state, and UI
- **Theme-Aware**: Dark/light theme support via CSS custom properties and `data-theme` attribute

## Class Overview

### AudioEngine (mixer-audio.js)
Manages the Web Audio API context and creates all audio nodes.

```javascript
class AudioEngine {
  constructor()                    // Creates AudioContext
  async init()                     // Initializes master nodes
  createEQ()                       // Returns 3-band EQ chain
  createFilter()                   // Returns BiquadFilterNode
  createDelay()                    // Returns delay with dry/wet/feedback
  createReverbSend(impulseBuffer)  // Returns convolver with send
  createPanner()                   // Returns StereoPannerNode
  createMeter()                    // Returns AnalyserNode
  setMasterVolume(value)           // Sets master gain (0-1)
  generateImpulseResponse()        // Creates reverb impulse response
}
```

### MixerState (mixer-state.js)
Manages all state for stems and provides share URL encoding/decoding.

```javascript
class MixerState {
  constructor(stemCount)           // Initializes stem array
  getStem(index)                   // Returns stem state object
  updateStemVolume(index, value)   // Sets stem volume
  toggleMute(index)                // Toggles mute state
  toggleSolo(index)                // Toggles solo state
  updateFX(index, type, prop, val) // Updates FX parameter
  hasSolo()                        // Returns true if any stem solo'd
  isStemActive(index)              // Returns true if stem audible
  reset()                          // Resets all stems to defaults
  applyFromUrl(mixParam)           // Parses and applies share URL
  toShareUrl()                     // Encodes state to share URL
}
```

### TransportController (mixer-transport.js)
Controls synchronized playback across all stem audio elements using a "Master Clock" pattern with playback rate nudging (~270 lines).

```javascript
class TransportController {
  constructor(audioEngine)         // Stores audio context reference
  setPlayers(players)              // Sets player objects, calculates duration, invalidates cache
  get leader()                     // Cached getter for rhythmic leader stem
  getLeader()                      // Identifies leader based on rhythm priority
  async play()                     // Resumes context, plays all stems (optimistic)
  pause()                          // Resets rates, pauses all, captures leader position
  stop()                           // Resets rates, stops and resets to start
  async seek(time)                 // Resets rates, pauses, seeks all, resumes if playing
  skipBack(seconds)                // Rewinds by seconds
  skipForward(seconds)             // Fast-forwards by seconds
  restart()                        // Seeks to 0 and plays
  getCurrentTime()                 // Returns leader's playback time
  formatTime(seconds)              // Returns "M:SS" string
  resetPlaybackRates()             // Resets all stems to playbackRate=1.0
  syncCheck()                      // Nudges drifting stems (called from animation loop)
}
```

**Leader Election:** The transport identifies a "leader" stem based on rhythmic priority (kick > main drums > drums > beat > perc > bass). All time tracking and pause position capture use the leader, ensuring consistent progress display. The leader is cached to avoid redundant regex matching.

**Playback Rate Nudging (Desktop Only):** During playback, `syncCheck()` is called ~1Hz from the animation loop. Stems drifting >20ms from the leader are gradually corrected via `playbackRate` adjustment (0.2-0.5% rate change). Extreme drift (>500ms) triggers hard resync.

**Mobile:** No active sync correction - rate nudging and hard-seek correction cause audio glitches on mobile browsers. Mobile relies on optimistic simultaneous play and threshold-based seeking.

See [PERFORMANCE.md](PERFORMANCE.md#audio-synchronization) for full sync architecture details.

### StemLoader (mixer-loader.js)
Handles batch downloading and audio graph construction for stems (~174 lines).

```javascript
class StemLoader {
  constructor(audioEngine, isMobile) // Stores audio engine reference and device type
  async loadStems(stemConfig, trackId, onProgress)
                                   // Loads stems in batches with progress callback
  createAudioGraph(player)         // Builds per-stem audio node chain
}
```

**Batch Loading:** Stems are loaded in batches (3 for mobile, 10 for desktop) with progress tracking. Each stem gets an HTMLAudioElement with crossOrigin and loop flags.

**Audio Graph:** Creates the full per-stem signal chain: source → EQ → filter → delay → panner → gain → analyser → master.

### UIBuilder (mixer-ui.js)
Renders all UI components and handles user interactions. Delegates waveform drawing to `WaveformRenderer` and HTML generation to `mixer-templates.js`.

```javascript
class UIBuilder {
  constructor(container, state)    // Stores container and state refs
  buildChannels()                  // Uses renderChannel template
  drawWaveformFromCache()          // Delegates to WaveformRenderer
  // ...
}
```

### WaveformRenderer (mixer-waveform.js)
Handles Canvas operations for drawing audio waveforms.

```javascript
class WaveformRenderer {
  setCache(cache)                  // Stores peaks data
  drawFromCache(index, color)      // Draws from cached peaks
  drawFromBlob(index, blob)        // Decodes audio and draws
}
```

### AnimationManager (mixer-loop.js)
Manages the application loop with task-based registration.

```javascript
class AnimationManager {
  add(id, callback, fps, cond)     // Register task with FPS throttle
  start() / stop()                 // Control the loop
}
```

### FXController (mixer-fx.js)
Manages FX modal and applies effects to audio nodes (~266 lines). Uses a tabbed modal interface.

```javascript
class FXController {
  constructor(state, audioEngine, onUpdate)
                                   // Stores state and audio refs
  initModal()                      // Creates shared modal element
  openModal(index, stemName, player)
                                   // Opens FX modal for stem
  closeModal()                     // Closes the modal
  setupModalListeners(index, player)
                                   // Wires up slider event handlers
  applyToNode(index, player)       // Applies state to audio nodes
  applyAll(players)                // Applies all stems' FX
  resetNode(index, player)         // Resets stem FX to defaults
  togglePanel(index)               // Opens/closes FX modal
}
```

**Modal UI:** The FX panel opens as a centered modal overlay with two tabs: EQ/FILTER and REVERB/DELAY. Click backdrop or press Escape to close.

## Performance Optimizations

### Device-Aware Configuration
```javascript
BATCH_SIZE: { mobile: 3, desktop: 10 }      // Stems loaded per batch
FFT_SIZE: { mobile: 64, desktop: 128 }      // Per-stem analyser FFT
WAVEFORM_FFT: { mobile: 256, desktop: 1024 } // Waveform FFT size
HOLOGRAPH_FFT: { mobile: 512, desktop: 2048 } // Visualizer FFT size
```

### Waveform Caching
- **Pre-generated peaks**: `{trackId}_peaks.json` files contain peak data
- **Fallback**: Audio decoding only if peaks file missing
- **Cache size**: ~2.2 KB per stem vs. full AudioBuffer

### Animation Loop Optimizations

| Optimization | Impact |
|--------------|--------|
| **Pre-allocated TypedArrays** | Eliminates ~2,400 allocations/second (GC pressure) |
| **Cached DOM references** | Eliminates ~1,140 `getElementById` calls/second |
| **CSS `transform: scaleY()`** | GPU-composited meter updates (no layout thrashing) |
| **Throttled progress updates** | 10 FPS instead of 60 FPS for progress bar |
| **Cached `hasSolo()` results** | O(n) instead of O(n²) for stem active checks |
| **Event listener cleanup** | `dispose()` method prevents memory leaks |

### Memory Management
- **Blob release**: Blob objects released after waveforms cached
- **Blob URL retention**: URLs kept until page unload (audio elements need them)
- **Early cleanup**: Memory freed during session, not just on unload

## Asset Loading Strategy

1. **Batched Loading**: Stems loaded in batches (3 mobile, 10 desktop)
2. **Progress Tracking**: Loading bar shows percentage complete
3. **Pre-generated Waveforms**: Peaks JSON eliminates audio decoding
4. **Range Request Support**: HTTP Range headers for audio seeking
5. **Cache-Control**: Long-term caching for audio files (1 year)
6. **Early Memory Release**: Blob objects freed after waveform caching
