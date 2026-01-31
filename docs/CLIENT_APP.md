# Client Application

This document covers `mixer-app.js` and its supporting modules, which together provide the interactive stem mixing interface.

## Application Lifecycle

The mixer follows a defined initialization sequence:

### 1. Configuration Injection
The server injects these globals into the HTML template:
```javascript
const TRACK_CONFIG = { id, name, bpm, key, number };  // Track metadata
const STEM_CONFIG = [{ file, name, desc, color }];    // Stem definitions
const INITIAL_MIX_STATE = "...";                      // Optional share URL
const INITIAL_MASTER_VOLUME = 80;                     // Master volume (0-100)
```

### 2. Start Overlay
Users must click "Enter Studio" to initialize the audio context. This is required by browser autoplay policies.

### 3. Initialization Sequence
```
User Click → Hide Overlay → initMixer()
                              │
                              ├─► Initialize AudioEngine
                              ├─► Create MixerState
                              ├─► Create TransportController
                              ├─► Create UIBuilder
                              ├─► Create FXController
                              ├─► Create Holograph Visualizer
                              ├─► Load Waveform Peaks (JSON)
                              ├─► Load Stem Audio Files (batched via StemLoader)
                              ├─► Apply Initial Mix State
                              └─► Start Animation Loop (AnimationManager)
```

## Audio System (mixer-audio.js)

### AudioEngine Class

The `AudioEngine` class manages the Web Audio API context and creates all audio processing nodes.

#### Initialization
```javascript
const audio = new AudioEngine();
await audio.init();
```

The `init()` method:
1. Creates `masterGain` node for overall volume
2. Creates `masterMeter` analyser for output visualization
3. Generates reverb impulse response (2 seconds, decay factor 2)
4. Connects: `masterGain` → `masterMeter` → `destination`

#### Per-Stem Node Creation

Each stem gets its own effects chain:

**EQ (3-band):**
```javascript
const eq = audio.createEQ();
// eq.lowShelf  - BiquadFilterNode @ 250Hz
// eq.mid       - BiquadFilterNode @ 1000Hz (peaking)
// eq.highShelf - BiquadFilterNode @ 4000Hz
```

**Filter:**
```javascript
const filter = audio.createFilter(rolloff);
// rolloff: -12 (default) or -24 dB/octave
// Returns wrapper with cascaded BiquadFilterNodes for steeper slopes
// filter.input - first filter in chain
// filter.output - last filter in chain
// filter.setType(t) - sets type on all filters
// filter.setFrequency(v, time) - sets frequency on all filters
// filter.setQ(v, time) - sets Q on all filters
// filter.rolloff - returns current rolloff value
```

**Delay:**
```javascript
const delay = audio.createDelay();
// delay.delayNode - DelayNode (0.01-2 seconds)
// delay.feedback  - GainNode (0-0.9)
// delay.wet       - GainNode (0-1)
// delay.dry       - GainNode (0-1)
```

**Reverb Send:**
```javascript
// Simple gain node per stem, sends to shared master reverb
const reverbSendGain = context.createGain();
reverbSendGain.connect(audioEngine.masterReverb.input);
// reverbSend.gain - GainNode (0-1)
```

**Panner:**
```javascript
const panner = audio.createPanner();
// StereoPannerNode - pan: -1 (left) to 1 (right)
```

**Meter:**
```javascript
const meter = audio.createMeter();
// AnalyserNode - FFT size: 64 (mobile) or 128 (desktop)
```

#### Impulse Response Generation

The reverb uses a synthetic impulse response, with duration optimized for device:
```javascript
// Duration: 1s (desktop), 0.5s (mobile) for better performance
const duration = this.isMobile ? 0.5 : 1;
generateImpulseResponse(duration, decay = 2) {
  // Creates stereo buffer with exponential decay
  // Left and right channels have independent noise
}
```

## Stem Loading (mixer-loader.js)

### StemLoader Class

Handles batch downloading and audio graph construction for stems (~174 lines).

#### Batch Loading

Stems are loaded in configurable batches with progress tracking:

```javascript
const loader = new StemLoader(audioEngine, isMobile);
await loader.loadStems(STEM_CONFIG, trackId, (progress, message) => {
  updateLoadingBar(progress);
  updateStatusText(message);
});
```

**Configuration:**
- Mobile: 3 stems per batch (reduces memory pressure)
- Desktop: 10 stems per batch (faster loading)
- 45-second timeout per stem with error handling

#### Audio Graph Construction

Each stem gets its own effects chain built by `createAudioGraph()`:

```javascript
// Per-stem signal chain
MediaElementSource
    → EQ (lowShelf → mid → highShelf)
    → Filter (BiquadFilterNode)
    → Delay (with feedback loop)
    → Panner (StereoPannerNode)
    → Gain (volume control)
    → Analyser (meter data)
    → Master Gain
```

The loader also connects each stem's reverb send to the shared master reverb.

## State Management (mixer-state.js)

### MixerState Class

Manages all stem state including volume, mute/solo, and FX parameters.

#### Stem State Structure
```javascript
{
  volume: 0.8,        // 0-1
  muted: false,
  solo: false,
  fx: {
    eq: { low: 0, mid: 0, high: 0 },       // -12 to 12 dB
    filter: { freq: 20000, resonance: 1, type: 'lowpass', rolloff: -12 },
    reverb: { send: 0 },                    // 0-100 %
    delay: { time: 0.375, feedback: 0.3, mix: 0 },
    pan: 0                                  // -1 to 1
  }
}
```

#### Mute/Solo Logic

The `isStemActive(index, hasSolo)` method determines if a stem should be audible:

```javascript
isStemActive(index, hasSolo = null) {
  const stem = this.stems[index];
  if (stem.muted) return false;
  // Use passed value if available (performance optimization)
  const soloActive = hasSolo !== null ? hasSolo : this.hasSolo();
  if (soloActive && !stem.solo) return false;
  return true;
}
```

**Performance Note:** The optional `hasSolo` parameter allows callers to cache the result of `hasSolo()` when checking multiple stems, reducing complexity from O(n²) to O(n).

#### Share URL Encoding

State is encoded to URL parameters for sharing:

```javascript
const shareUrl = state.toShareUrl();
// Returns: "0:80:0:0:0:0:0:0:0:20000:10:0:38:30:0,1:100:1:0..."
```

**Format per stem:**
```
index:volume:muted:solo:pan:eqLow:eqMid:eqHigh:filterType:filterFreq:filterRes:reverb:delayTime:delayFB:delayMix:filterRolloff
```

**Value scaling:**
- Volume: 0-100 (percentage)
- Pan: -100 to 100
- EQ: -120 to 120 (actual -12 to 12 dB × 10)
- Filter Type: 0=lowpass, 1=highpass, 2=bandpass
- Filter Resonance: 1-100 (actual 0.1-10 × 10)
- Delay Time: 1-200 (actual 0.01-2s × 100)
- Delay Feedback: 0-90 (actual 0-0.9 × 100)

## Transport Control (mixer-transport.js)

### TransportController Class

Manages synchronized playback across all stem `HTMLAudioElement` instances using a "Master Clock" pattern.

#### Leader Election

The transport identifies a "leader" stem for time reference based on rhythmic priority:

```javascript
getLeader() {
  // Priority: kick > main drums > drums > beat > perc > bass > first
  const patterns = [
    { regex: /kick/i, score: 100 },
    { regex: /main.*drums|drums.*main/i, score: 90 },
    { regex: /drums/i, score: 80 },
    { regex: /beat/i, score: 70 },
    { regex: /perc|prc/i, score: 60 },
    { regex: /bass/i, score: 20 }
  ];
  // Returns best rhythmic stem as time reference
}
```

This ensures the UI progress and pause position track the most rhythmically important stem.

**Note:** On desktop, `syncCheck()` is called ~1Hz from the animation loop to correct drift via playback rate nudging. On mobile, NO active sync correction is performed - all approaches tested caused audio glitches.

#### Play/Pause
```javascript
await transport.play();   // Resumes AudioContext, plays all stems
transport.pause();        // Pauses all stems, captures leader position
```

**Audio Context Resume**: Required for macOS Safari. The `play()` method always calls `this.audio.resume()` before starting playback.

**Optimistic Start**: All stems start immediately without waiting for seek events. A threshold check (>100ms drift) determines whether to re-seek each element.

#### Seeking
```javascript
transport.seek(30);       // Seek to 30 seconds (async)
transport.skipBack(10);   // Rewind 10 seconds
transport.skipForward(10);// Fast-forward 10 seconds
transport.restart();      // Seek to 0 and play
```

Seek operations pause all stems before setting time, then resume if playing.

#### Time Tracking
```javascript
const time = transport.getCurrentTime();  // Returns leader's time in seconds
const formatted = transport.formatTime(time);  // Returns "M:SS"
```

Time is always read from the leader stem, ensuring consistent progress display.

## UI Rendering (mixer-ui.js)

### UIBuilder Class

Renders all channel strips and handles user interactions. It delegates HTML generation to `mixer-templates.js` and waveform drawing to `mixer-waveform.js`.

#### Channel Strip Structure (mixer-templates.js)
HTML generation is handled by pure functions in `mixer-templates.js`:

```javascript
export function renderChannel(index, player, stemState) {
  // Returns channel DOM element
}
```

#### Event Delegation

Instead of attaching event listeners to each channel element, UIBuilder uses event delegation on the container:

```javascript
_setupDelegatedListeners() {
  // Single click handler for all mute/solo/fx buttons
  this._onContainerClick = e => {
    if (!this.callbacks) return;
    const target = e.target;
    if (target.tagName === 'BUTTON') {
      const id = target.id;
      if (id.startsWith('mute-')) {
        this.callbacks.onMute(id.split('-')[1]);
      } else if (id.startsWith('solo-')) {
        this.callbacks.onSolo(id.split('-')[1]);
      }
      // ...
    }
  };

  // Single input handler for all pan sliders
  this._onContainerInput = e => { /* ... */ };

  // Single handler for all fader interactions
  this._onFaderStart = e => { /* ... */ };

  this.container.addEventListener('click', this._onContainerClick);
  this.container.addEventListener('input', this._onContainerInput);
  this.container.addEventListener('mousedown', this._onFaderStart);
  this.container.addEventListener('touchstart', this._onFaderStart);
}
```

This reduces listener count from O(n × handlers) to O(handlers), improving memory usage and initialization time.

#### Fader Interaction

Both stem and master faders use a shared handler factory to eliminate code duplication:

```javascript
// Shared fader handler factory
_createFaderHandler(fader, fill, handle, readout, callback) {
  return (evt) => {
    const rect = fader.getBoundingClientRect();
    const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
    const y = clientY - rect.top;
    const value = Math.max(0, Math.min(1, 1 - y / rect.height));

    fill.style.height = `${value * 100}%`;
    handle.style.bottom = `${value * 100}%`;
    if (readout) readout.textContent = `${Math.round(value * 100)}%`;

    callback(value);
  };
}

// Used for stem faders (via delegation)
this._onFaderStart = e => {
  const fader = e.target.closest('.fader');
  if (!fader || fader.id === 'masterFader') return;
  const index = fader.id.split('-')[1];
  const updateFader = this._createFaderHandler(
    fader,
    fader.querySelector('.fader-fill'),
    fader.querySelector('.fader-handle'),
    document.getElementById(`readout-${index}`),
    (value) => { if (this.callbacks) this.callbacks.onFader(index, value); }
  );
  this.activeFader = updateFader;
  updateFader(e);
};

// Used for master fader (direct binding)
_setupMasterFaderControls(element, callbacks) {
  const fader = element.querySelector('#masterFader');
  const updateFader = this._createFaderHandler(
    fader,
    fader.querySelector('.fader-fill'),
    fader.querySelector('.fader-handle'),
    element.querySelector('#masterReadout'),
    callbacks.onMasterFader
  );
  // ... bind mousedown/touchstart
}
```

Global listeners track drag state across the window:

```javascript
_setupGlobalFaderListeners() {
  this._onMouseMove = e => { if (this.activeFader) this.activeFader(e); };
  this._onMouseUp = () => { this.activeFader = null; };
  // Touch handlers similar...

  window.addEventListener('mousemove', this._onMouseMove);
  window.addEventListener('mouseup', this._onMouseUp);
}
```

This approach allows dragging outside the fader element while maintaining responsiveness. The `dispose()` method enables proper cleanup when the mixer is destroyed.

#### Channel Visibility Tracking

UIBuilder uses `IntersectionObserver` to track which channels are visible in the viewport:

```javascript
// In constructor
this.visibleIndices = new Set();
this.observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    const index = entry.target.dataset.index;
    if (entry.isIntersecting) {
      this.visibleIndices.add(index);
    } else {
      this.visibleIndices.delete(index);
    }
  });
}, { threshold: 0 });

// In buildChannels()
this.observer.observe(channel);

// Query method
isChannelVisible(index) {
  return this.visibleIndices.has(index.toString());
}
```

This enables the meter update loop to skip calculations for off-screen channels, reducing CPU usage when scrolled.

#### Waveform Rendering (mixer-waveform.js)

The `WaveformRenderer` class handles all Canvas operations:

**Pre-generated Peaks (preferred):**
```javascript
// Delegated via UIBuilder
waveformRenderer.setCache(peaksData);
waveformRenderer.drawFromCache(index, color);
```

**Fallback (audio decoding):**
```javascript
await waveformRenderer.drawFromBlob(index, blob, color, audioContext);
```

The `extractPeaks()` method samples the audio buffer to create min/max values for 140 pixels.

#### Master Channel

The master channel appears as the rightmost element:
- Larger fader (16px vs 10px)
- Taller meter (120px vs 80px)
- No mute/solo/FX buttons
- Track color border and glow

### Signal LED Indicator

Each channel has a signal LED that lights up when audio is detected, making it easy to see which stems are actively contributing to the mix:

```javascript
// In updateMeters() - called alongside meter updates
uiBuilder.setChannelSignal(index, normalized > 0.05);
```

**Implementation:**
- LED element: `<span class="signal-led">` positioned above channel name
- CSS class `has-signal` toggled on channel element
- LED lights up with channel color and glow effect
- Channel name gets text-shadow glow when active
- 5% threshold prevents flickering on near-silent stems

**CSS:**
```css
.signal-led { width: 6px; height: 6px; background: #333; }
.channel.has-signal .signal-led { background: var(--channel-color); box-shadow: 0 0 8px var(--channel-color); }
.channel.has-signal .channel-name { text-shadow: 0 0 6px var(--channel-color); }
```

### Meter Updates

Real-time meter levels are calculated in the animation loop with several optimizations:

```javascript
// Pre-allocated buffers (avoid GC pressure)
let meterBuffers = {};

function initBuffers() {
  Object.entries(meters).forEach(([index, meter]) => {
    meterBuffers[index] = new Float32Array(meter.frequencyBinCount);
  });
}

function updateMeters() {
  const hasSolo = mixerState.hasSolo();  // Cache once per update

  Object.entries(meters).forEach(([index, meter]) => {
    // Skip invisible channels (virtualization)
    if (uiBuilder.isChannelVisible && !uiBuilder.isChannelVisible(index)) return;

    if (!mixerState.isStemActive(index, hasSolo)) {
      uiBuilder.updateMeter(index, 0);
      return;
    }

    const buffer = meterBuffers[index];  // Reuse pre-allocated buffer
    meter.getFloatTimeDomainData(buffer);
    // Calculate RMS level...
    uiBuilder.updateMeter(index, normalized);
  });
}
```

**Performance optimizations:**
- Pre-allocated `Float32Array` buffers avoid garbage collection pressure
- Cached `hasSolo()` result reduces O(n²) to O(n) complexity
- Cached DOM element references in UIBuilder (no `getElementById` per frame)
- CSS `transform: scaleY()` for meter fill (GPU-accelerated, no layout thrashing)
- Visibility tracking skips meter updates for off-screen channels

## FX System (mixer-fx.js)

### FXController Class

Manages the FX modal and applies effects to audio nodes (~266 lines). Uses a centered modal overlay with a tabbed interface.

#### FX Modal Structure

The modal contains two tabs:
- **EQ / FILTER**: 3-band EQ (Low, Mid, High) and filter (Type, Frequency, Q)
- **REVERB / DELAY**: Reverb send and delay (Time, Feedback, Mix)

#### Modal Behavior

```javascript
// In mixer-app.js - FX button opens modal for that stem
callbacks.onFX = (index) => {
  fxController.togglePanel(index);
};
```

**Key behaviors:**
- Opens centered on screen with blurred backdrop
- Click backdrop or press Escape to close
- Always opens on EQ/FILTER tab (resets between channels)
- One modal instance reused for all stems

#### Applying Effects

Effects are applied in real-time as sliders change:

```javascript
modal.querySelector(`#eq-low-${index}`).addEventListener('input', e => {
  const value = parseFloat(e.target.value);
  this.state.updateFX(index, 'eq', 'low', value);
  player.effects.eq.lowShelf.gain.setTargetAtTime(value, currentTime(), 0.01);
});
```

The `setTargetAtTime()` method provides smooth parameter changes (10-20ms ramp).

#### Batch Application

On load or reset, all FX can be applied at once:

```javascript
fxController.applyAll(players);  // Apply state to all stems
fxController.resetNode(index, player);  // Reset single stem
```

## Theme System

The mixer supports light and dark themes across all views (listing, loading overlay, mixer).

### Theme Toggle
```javascript
// Toggle handler - updates document attribute and notifies visualizer
themeToggle.addEventListener('click', () => {
  const newTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('evr-theme', newTheme);
  if (holograph) holograph.setTheme(newTheme === 'light');
});
```

### Early Theme Loading
Theme is set in `<head>` before body renders to prevent flash:
```html
<script>document.documentElement.setAttribute('data-theme', localStorage.getItem('evr-theme') || 'dark');</script>
```

### Theme-Aware Components

| Component | Dark Mode | Light Mode |
|-----------|-----------|------------|
| **Listing Grid** | Dark cards (#111), white gaps | Light cards (#f0f0f0), black gaps |
| **Start Overlay** | Dark bg (rgba(0,0,0,0.85)) | Light bg (rgba(240,240,240,0.95)) |
| **Waveforms** | Dark bg (#111, #0a0a0a) | Light bg (#e0e0e0) |
| **Holograph Visualizer** | Dark bg (#0a0a0a) | Light bg (#e0e0e0) |
| **Channel Buttons** | Dark (#222) | Light (var(--border)) |

### Visualizer Theme Updates
The holograph visualizer runs in a Web Worker and receives theme updates:
```javascript
// In mixer-visualizer.js
setTheme(isLight) {
  this.worker.postMessage({ type: 'theme', payload: { isLight } });
}
```

## Progress Bar

The progress bar is display-only (no click-to-seek). Use the skip buttons (±10s) or restart button for navigation.

```javascript
// Progress updates in animation loop
function updateProgress() {
  const time = transport.getCurrentTime();
  const ratio = time / transport.duration;
  progressFill.style.transform = `scaleX(${ratio})`;
  timeDisplay.textContent = transport.formatTime(time);
}
```

## Animation Loop (mixer-loop.js)

The application uses a centralized `AnimationManager` to handle the `requestAnimationFrame` loop. Tasks are registered declaratively with specific FPS targets.

### AnimationManager Class

```javascript
const loop = new AnimationManager();

// Register tasks
loop.add('progress', updateProgress, 10);      // Run at 10 FPS
loop.add('meters', updateMeters, 30);          // Run at 30 FPS
loop.add('holograph', updateHolograph, 30, () => isPlaying); // Conditional
loop.add('sync', () => transport.syncCheck(), 1, () => isPlaying && !isMobile); // Desktop only
```

**Features:**
- **Throttling**: Ensures tasks only run at their required frequency.
- **Drift Correction**: Adjusts next run time to maintain average FPS.
- **Conditional Execution**: Tasks can include a predicate function (e.g., only run when playing, or skip on mobile).

## Holographic Visualizer

The mixer includes a 3D "City Landscape" holographic visualizer using OffscreenCanvas + Web Worker.

### Architecture
- **Main thread** (`mixer-visualizer.js`): `Holograph` class reads frequency data from analyser, sends to worker
- **Worker** (`mixer-holographic-worker.js`): Renders 3D grid with perspective projection

### Performance Features
- Pre-allocated arrays (zero GC in render loop)
- Cached projection constants
- Fake glow effect (2-pass drawing instead of shadowBlur)
- Conditional shadow only when peaks exist
- Cached color strings

## Help System (mixer-help.js)

### HelpController Class

Provides contextual help via a modal (desktop) or bottom sheet (mobile).

```javascript
class HelpController {
  constructor()                    // Detects mobile, initializes state
  init()                           // Creates modal, binds events
  createModal()                    // Builds modal DOM structure
  bindEvents()                     // Help button, close, tabs, keyboard
  bindSwipeEvents()                // Mobile swipe-to-dismiss
  switchTab(tabId)                 // Switches between tabs
  toggle() / open() / close()      // Modal visibility
  isInputFocused()                 // Prevents ? shortcut in inputs
}
```

### Responsive Behavior

| Platform | UI Type | Features |
|----------|---------|----------|
| **Desktop** | Centered Modal | All 3 tabs, Escape to close, click backdrop to close |
| **Mobile** | Bottom Sheet | Controls + Tips tabs only (no Shortcuts), swipe down to dismiss |

### Tab Content

1. **Controls Tab**: Volume Fader, Mute/Solo, Pan, FX, Signal LED, Light/Dark Mode, Share, Reset
2. **Shortcuts Tab** (desktop only): Space (play/pause), ←/→ (skip), Home (start), R (reset), ? (help), Esc (close)
3. **Tips Tab**: Solo tips, pan/width, share URLs, filter techniques, reverb/delay usage, EQ tips

### Styling

The help modal uses cyan accent color (same as FX modal) instead of track color, ensuring consistent appearance across all tracks.

### Keyboard Shortcut

Press `?` to toggle help (when not in an input field).

### Integration

```javascript
// In mixer-app.js
import { HelpController } from './modules/mixer-help.js';

const helpController = new HelpController();
helpController.init();
```

The help button appears in the header (next to BPM) on track pages only.
