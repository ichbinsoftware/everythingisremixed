# Mixer System Reference

This document provides detailed reference information for the mixer's audio processing, state management, and UI systems.

## Track Catalog

| Track | BPM | Key | Stems | Symbol | Primary Color |
|-------|-----|-----|-------|--------|---------------|
| **Hydrogen** | 132 | D Major | 12 | H | `#25daf0` |
| **Lithium** | 124 | G minor | 38 | Li | `#cf2739` |
| **Sodium** | 140 | G minor | 28 | Na | `#f7ca47` |
| **Potassium** | 90 | C Major | 19 | K | `#8f01ff` |
| **Rubidium** | 132 | G Major | 9 | Rb | `#c71585` |
| **Caesium** | 130 | C Major | 16 | Cs | `#afa0ef` |
| **Francium** | 128 | B♭ Major | 26 | Fr | `#c1c1c1` |

## Effects Reference

### 3-Band EQ

| Band | Type | Frequency | Range |
|------|------|-----------|-------|
| **Low** | Low Shelf | 250 Hz | -12 to +12 dB |
| **Mid** | Peaking | 1000 Hz | -12 to +12 dB |
| **High** | High Shelf | 4000 Hz | -12 to +12 dB |

**Audio Nodes:**
```javascript
lowShelf:  BiquadFilterNode { type: 'lowshelf',  frequency: 250,  gain: [-12, 12] }
mid:       BiquadFilterNode { type: 'peaking',   frequency: 1000, gain: [-12, 12] }
highShelf: BiquadFilterNode { type: 'highshelf', frequency: 4000, gain: [-12, 12] }
```

### Filter

| Parameter | Range | Default |
|-----------|-------|---------|
| **Type** | lowpass, highpass, bandpass | lowpass |
| **Frequency** | 20 - 20,000 Hz | 20,000 Hz |
| **Q (Resonance)** | 0.1 - 10 | 1 |
| **Rolloff (Slope)** | -12, -24 dB/octave | -12 dB/oct |

**Audio Nodes:**
```javascript
// -12 dB/oct (default): single BiquadFilterNode
filter: BiquadFilterNode { type: 'lowpass', frequency: 20000, Q: 1 }

// -24 dB/oct: cascaded BiquadFilterNodes for steeper slope
filter: {
  filters: [BiquadFilterNode, BiquadFilterNode],  // 2 cascaded filters
  input: filters[0],
  output: filters[1],
  rolloff: -24
}
```

**Rolloff Implementation:**

The filter uses a wrapper interface that supports both single and cascaded filters, with built-in hot-swap capability:

```javascript
createFilter(rolloff = -12) {
  const createStages = (numStages) => {
    const filters = [];
    for (let i = 0; i < numStages; i++) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 20000;
      if (i > 0) filters[i - 1].connect(f);
      filters.push(f);
    }
    return filters;
  };

  let filters = createStages(Math.abs(rolloff) / 12);
  let currentRolloff = rolloff;

  return {
    get filters() { return filters; },
    get input() { return filters[0]; },
    get output() { return filters[filters.length - 1]; },
    get rolloff() { return currentRolloff; },
    setType(t) { filters.forEach(f => f.type = t); },
    setFrequency(v, time) { filters.forEach(f => f.frequency.setTargetAtTime(v, time, 0.02)); },
    setQ(v, time) { filters.forEach(f => f.Q.setTargetAtTime(v, time, 0.02)); },

    // Hot-swap rolloff: recreates internal stages, reconnects to chain
    setRolloff(newRolloff, prevNode, nextNode) {
      if (newRolloff === currentRolloff) return false;
      const type = filters[0].type;
      const freq = filters[0].frequency.value;
      const q = filters[0].Q.value;
      prevNode.disconnect();
      filters.forEach(f => f.disconnect());
      filters = createStages(Math.abs(newRolloff) / 12);
      currentRolloff = newRolloff;
      filters.forEach(f => { f.type = type; f.frequency.value = freq; f.Q.value = q; });
      prevNode.connect(filters[0]);
      filters[filters.length - 1].connect(nextNode);
      return true;
    }
  };
}
```

**Hot-swapping Rolloff:**

The filter wrapper handles rolloff changes internally via `setRolloff()`:

```javascript
_changeFilterRolloff(index, player, newRolloff) {
  const filter = player.effects.filter;
  const nextNode = player.effects.ringmod
    ? player.effects.ringmod.input
    : player.effects.delay.input;
  const changed = filter.setRolloff(
    newRolloff,
    this._filterPrevNode(player),  // distortion.output || compressor.output || eq.output
    nextNode,
    this.audio.currentTime
  );
  if (changed) {
    this.state.updateFX(index, 'filter', 'rolloff', newRolloff);
  }
}
```

### Compressor (Lazy)

| Parameter | Range | Default |
|-----------|-------|---------|
| **Threshold** | -100 to 0 dB | -24 dB |
| **Knee** | 0 - 40 dB | 30 dB |
| **Ratio** | 1 - 20 | 12 |
| **Attack** | 0.001 - 1 s | 0.003s |
| **Release** | 0.01 - 1 s | 0.25s |

**Implementation:** Uses native `DynamicsCompressorNode`. Lazily instantiated — only created when user first interacts. Splices into chain between EQ output and Distortion/Filter input.

### Distortion (Lazy)

| Parameter | Range | Default |
|-----------|-------|---------|
| **Drive** | 0 - 100 | 0 |
| **Tone** | warm, crunch, fuzz, hard-clip | warm |
| **Mix** | 0 - 100% | 0% |

**Implementation:** Uses `WaveShaperNode` with dry/wet mix. Four tone presets generate different transfer curves (tanh, soft-knee, exponential, hard-clip). Lazily instantiated — splices between Compressor/EQ and Filter.

**Signal Flow:**
```
Input ─┬─► Dry (GainNode) ──────────────┬─► Output
       └─► WaveShaper → Wet (GainNode) ─┘
```

### Tremolo (Lazy)

| Parameter | Range | Default |
|-----------|-------|---------|
| **Rate** | 0.1 - 20 Hz | 4 Hz |
| **Depth** | 0 - 100% | 0% |
| **Shape** | sine, square, triangle, sawtooth | sine |

**Implementation:** LFO (OscillatorNode) modulates a signal GainNode. A ConstantSource bias of 1.0 keeps the gain centered. Depth controls modulation amount (0 = no effect). Lazily instantiated — splices between Delay output and Panner.

**Signal Flow:**
```
Signal in → signalGain → out
LFO (osc) → depthGain → signalGain.gain
bias (constant 1) → signalGain.gain
```

### Ring Modulator (Lazy)

| Parameter | Range | Default |
|-----------|-------|---------|
| **Frequency** | 20 - 2000 Hz | 440 Hz |
| **Shape** | sine, square, triangle, sawtooth | sine |
| **Mix** | 0 - 100% | 0% |

**Implementation:** Carrier OscillatorNode multiplied with input signal via GainNode modulation, with dry/wet crossfade. Lazily instantiated — splices between Filter output and Delay input.

**Signal Flow:**
```
Input ─┬─► Dry (GainNode) ──────────────────┬─► Output
       └─► modGain → Wet (GainNode) ────────┘
Carrier Osc → modGain.gain
```

### Reverb

| Parameter | Range | Default | Description |
|-----------|-------|---------|-------------|
| **Send** | 0 - 100% | 0% | Amount sent to reverb |

**Implementation:**
- Uses `ConvolverNode` with synthetic impulse response
- Duration: 1 second (desktop), 0.5 second (mobile) - optimized for performance
- Decay factor of 2
- Shared master reverb (all stems send to same convolver)
- Simple per-stem send gain (no per-stem filtering)

**Signal Flow:**
```
Panner → GainNode (send) → Master Convolver
```

**Audio Nodes (per stem):**
```javascript
reverbSend: {
  gain: GainNode { gain: [0, 1] }
}
```

**Performance Note:** The reverb uses a simple send gain per stem rather than a full per-stem effects chain. This reduces CPU load significantly when multiple stems have reverb enabled.

### Delay

| Parameter | Range | Default |
|-----------|-------|---------|
| **Time** | 0.01 - 2 seconds | 0.375s |
| **Feedback** | 0 - 90% | 30% |
| **Mix** | 0 - 100% | 0% |

**Implementation:**
```
Input ─┬─► Dry (GainNode) ─────────────┬─► Output
       │                               │
       └─► DelayNode ─► Wet (GainNode) ┘
                │
                └─► Feedback (GainNode) ─┘
```

### Pan

| Parameter | Range | Default |
|-----------|-------|---------|
| **Pan** | -1 (left) to +1 (right) | 0 (center) |

**Audio Node:**
```javascript
panner: StereoPannerNode { pan: [-1, 1] }
```

## State Encoding

### Share URL Format

Mix state is encoded as URL query parameters:

```
?mix=<stem1>,<stem2>,...&master=<volume>
```

**Per-Stem Format (values[0-29]):**
```
index:volume:muted:solo:pan:eqLow:eqMid:eqHigh:filterType:filterFreq:filterRes:reverbSend:delayTime:delayFB:delayMix:filterRolloff:compThresh:compKnee:compRatio:compAttack:compRelease:distDrive:distTone:distMix:tremRate:tremDepth:tremShape:rmFreq:rmShape:rmMix
```

### Parameter Encoding

| Index | Parameter | URL Value | Actual Value | Conversion |
|-------|-----------|-----------|--------------|------------|
| 0 | index | stem index | stem index | direct |
| 1 | volume | 0-100 | 0-1 | ÷100 |
| 2 | muted | 0 or 1 | boolean | ===1 |
| 3 | solo | 0 or 1 | boolean | ===1 |
| 4 | pan | -100 to 100 | -1 to 1 | ÷100 |
| 5 | eqLow | -120 to 120 | -12 to 12 dB | ÷10 |
| 6 | eqMid | -120 to 120 | -12 to 12 dB | ÷10 |
| 7 | eqHigh | -120 to 120 | -12 to 12 dB | ÷10 |
| 8 | filterType | 0, 1, 2 | lowpass, highpass, bandpass | lookup |
| 9 | filterFreq | 20-20000 | 20-20000 Hz | direct |
| 10 | filterRes | 1-100 | 0.1-10 | ÷10 |
| 11 | reverbSend | 0-100 | 0-100% | direct |
| 12 | delayTime | 1-200 | 0.01-2s | ÷100 |
| 13 | delayFB | 0-90 | 0-0.9 | ÷100 |
| 14 | delayMix | 0-100 | 0-100% | direct |
| 15 | filterRolloff | -12, -24 | -12, -24 dB/oct | direct |
| 16 | compThresh | -100 to 0 | -100 to 0 dB | direct |
| 17 | compKnee | 0-40 | 0-40 dB | direct |
| 18 | compRatio | 10-200 | 1-20 | ÷10 |
| 19 | compAttack | 1-1000 | 0.001-1s | ÷1000 |
| 20 | compRelease | 10-1000 | 0.01-1s | ÷1000 |
| 21 | distDrive | 0-100 | 0-100 | direct |
| 22 | distTone | 0-3 | warm, crunch, fuzz, hard-clip | lookup |
| 23 | distMix | 0-100 | 0-100% | direct |
| 24 | tremRate | 1-200 | 0.1-20 Hz | ÷10 |
| 25 | tremDepth | 0-100 | 0-100% | direct |
| 26 | tremShape | 0-3 | sine, square, triangle, sawtooth | lookup |
| 27 | rmFreq | 20-2000 | 20-2000 Hz | direct |
| 28 | rmShape | 0-3 | sine, square, triangle, sawtooth | lookup |
| 29 | rmMix | 0-100 | 0-100% | direct |

### Example URL

```
?mix=0:80:0:0:0:0:0:0:0:20000:10:0:38:30:0,1:65:0:1:50:0:0:0:1:1000:25:30:50:40:20&master=75
```

**Decoded:**
- Stem 0: 80% volume, no mute/solo, centered, EQ flat, filter off, no reverb/delay
- Stem 1: 65% volume, solo, panned right 50%, highpass @ 1kHz, 30% reverb, delay active
- Master: 75% volume

### Backward Compatibility

URLs with fewer parameters (old format) are supported:
- Missing parameters use defaults from `DEFAULT_FX_STATE`
- Missing `master` parameter defaults to 80

## UI Components

### Channel Strip

```
┌─────────────────────┐
│         ●           │  ← Signal LED (lights up when audio detected)
│    STEM NAME        │  ← Name glows when active
├─────────────────────┤
│  ▄▃▅▆▇█▇▆▅▃▄       │  ← Waveform Canvas
├─────────────────────┤
│      ◄●►            │  ← Pan Slider
│      PAN            │
├─────────────────────┤
│  ┃▓▓▓▓▓▓▓▓▓▓▓      │  ← Meter + Fader
│  ┃▓▓▓▓▓▓▓▓▓▓▓      │
│  ┃▓▓▓▓▓▓▓▓▓▓▓      │
│  ┃▓▓▓▓▓████████    │  ← Fader Handle
│  ┃                 │
├─────────────────────┤
│       80%          │  ← Volume Readout
├─────────────────────┤
│    [ M ]  [ S ]    │  ← Mute / Solo
├─────────────────────┤
│       [FX]         │  ← FX Button (opens modal)
└─────────────────────┘
```

**Signal LED Behavior:**
- 6px circular LED centered above channel name
- Lights up with channel color + glow when audio level exceeds 5%
- Channel name gets text-shadow glow when active
- Uses `has-signal` CSS class toggled in animation loop

**Button States:**
| Button | Inactive | Active (Dark Mode) | Active (Light Mode) |
|--------|----------|--------------------|--------------------|
| **M** (Mute) | Dark grey | Grey (#666) | Grey |
| **S** (Solo) | Dark grey | Yellow | Yellow (var(--accent-yellow)) |

**Muted Channel Visibility:**
When a channel is muted/inactive, most elements dim to 30% opacity, but active M/S buttons remain at full opacity for easy unmuting.

### FX Modal

The FX panel opens as a centered modal overlay with a tabbed interface.

```
┌──────────────────────────────────────────────────────────┐
│  STEM NAME EFFECTS                                   [×] │
├──────────────────────────────────────────────────────────┤
│  [EQ / FILTER]  [DYNAMICS]  [MOD / FX]  [SEND / DELAY]  │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  (Tab content shown below)                               │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Tab 1: EQ / FILTER**
```
│  EQ                                 │
│  Low   ◄━━━━━━●━━━━━━►   0.0dB     │
│  Mid   ◄━━━━━━●━━━━━━►   0.0dB     │
│  High  ◄━━━━━━●━━━━━━►   0.0dB     │
├─────────────────────────────────────┤
│  Filter                             │
│  Type  [▼ Lowpass          ]        │
│  Slope [▼ -12 dB/oct       ]        │
│  Freq  ◄━━━━━━━━━━━━━●►  20000Hz   │
│  Q     ◄━━━●━━━━━━━━━━►    1.0     │
```

**Tab 2: DYNAMICS**
```
│  Compressor                         │
│  Thresh ◄━━━━●━━━━━━━━►   -24dB    │
│  Knee   ◄━━━━━━━●━━━━━►    30dB    │
│  Ratio  ◄━━━━━━━━━●━━━►    12.0    │
│  Attack ◄●━━━━━━━━━━━━►   0.003s   │
│  Release◄━━●━━━━━━━━━━►    0.25s   │
├─────────────────────────────────────┤
│  Distortion                         │
│  Drive  ◄●━━━━━━━━━━━━►      0     │
│  Tone   [▼ Warm            ]        │
│  Mix    ◄●━━━━━━━━━━━━►      0%    │
```

**Tab 3: MOD / FX**
```
│  Tremolo                            │
│  Rate   ◄━━━●━━━━━━━━━►   4.0Hz    │
│  Depth  ◄●━━━━━━━━━━━━►      0%    │
│  Shape  [▼ Sine            ]        │
├─────────────────────────────────────┤
│  Ring Modulator                     │
│  Freq   ◄━━━━━━━●━━━━━►   440Hz    │
│  Shape  [▼ Sine            ]        │
│  Mix    ◄●━━━━━━━━━━━━►      0%    │
```

**Tab 4: SEND / DELAY**
```
│  Reverb                             │
│  Send      ◄●━━━━━━━━━━━►     0%   │
├─────────────────────────────────────┤
│  Delay                              │
│  Time  ◄━━━●━━━━━━━━━━►   0.38s    │
│  FB    ◄━━●━━━━━━━━━━━►    30%     │
│  Mix   ◄●━━━━━━━━━━━━━►     0%     │
```

**Modal Behavior:**
- Opens centered on screen with blurred backdrop
- Click backdrop or press Escape to close
- Always opens on EQ/FILTER tab (resets between channels)
- One modal at a time (reused for all stems)

### Master Channel

```
┌──────────────────────┐
│       MASTER         │
├──────────────────────┤
│   ┃▓▓▓▓▓▓▓▓▓▓▓▓▓    │  ← Larger Meter
│   ┃▓▓▓▓▓▓▓▓▓▓▓▓▓    │     (120px vs 80px)
│   ┃▓▓▓▓▓▓▓▓▓▓▓▓▓    │
│   ┃▓▓▓▓▓████████    │  ← Larger Fader
│   ┃▓▓▓▓▓████████    │     (16px vs 10px)
│   ┃                 │
├──────────────────────┤
│        80%           │
└──────────────────────┘
```

### Transport Controls

```
┌──────────────────────────────────────────┐
│  [⏮]   [⏪]   [▶]   [⏩]   [⏹]         │
│   │      │     │      │      │          │
│   │      │     │      │      └─ Stop    │
│   │      │     │      └─ Skip +10s      │
│   │      │     └─ Play/Pause            │
│   │      └─ Skip -10s                   │
│   └─ Restart                            │
└──────────────────────────────────────────┘
```

**Progress Bar:** Display-only (shows current position and time). Use skip buttons (±10s) or restart for navigation. No click-to-seek functionality.

### Help Modal / Bottom Sheet

The help system adapts to device type:

**Desktop (Modal):**
```
┌─────────────────────────────────────┐
│  MIXER GUIDE                    [×] │
├─────────────────────────────────────┤
│  [Controls]  [Shortcuts]  [Tips]    │  ← Tab buttons
├─────────────────────────────────────┤
│                                     │
│  (Tab content - see below)          │
│                                     │
├─────────────────────────────────────┤
│           [Got it]                  │  ← Dismiss button
└─────────────────────────────────────┘
```

**Mobile (Bottom Sheet):**
```
┌─────────────────────────────────────┐
│          ═══                        │  ← Drag handle (swipe down to dismiss)
├─────────────────────────────────────┤
│  MIXER GUIDE                    [×] │
├─────────────────────────────────────┤
│  [Controls]  [Tips]                 │  ← No Shortcuts tab on mobile
├─────────────────────────────────────┤
│                                     │
│  (Tab content)                      │
│                                     │
├─────────────────────────────────────┤
│           [Got it]                  │
└─────────────────────────────────────┘
```

**Tab Content:**

| Tab | Content |
|-----|---------|
| **Controls** | Volume Fader, Mute/Solo, Pan, FX, Signal LED, Light/Dark Mode, Share, Reset |
| **Shortcuts** | Space (play/pause), ←/→ (skip ±10s), Home (start), R (reset), ? (help), Esc (close) |
| **Tips** | Quick Solo, Pan for width, Share via URL, Mute vocals for instrumental, Filter tips, Reverb/Delay tips, etc. |

**Keyboard Shortcut:** Press `?` to toggle help (when not focused in an input field).

**Styling:** Uses cyan accent color (same as FX modal) instead of track color for consistent appearance across tracks.

## Waveform System

### Peak Data Format

Pre-generated peaks are stored in `{trackId}_peaks.json`:

```json
{
  "0": [
    { "min": -0.45, "max": 0.52 },
    { "min": -0.38, "max": 0.41 },
    ...
  ],
  "1": [ ... ]
}
```

- Index matches stem index
- Array length equals `WAVEFORM_WIDTH` (140 pixels)
- Values normalized to [-1, 1]

### Rendering

```javascript
_drawWaveform(ctx, peaks, color) {
  const amplitude = WAVEFORM_HEIGHT / 2;
  ctx.clearRect(0, 0, WAVEFORM_WIDTH, WAVEFORM_HEIGHT);
  ctx.fillStyle = color;

  for (let i = 0; i < peaks.length; i++) {
    const peak = peaks[i];
    ctx.fillRect(
      i,                           // x
      (1 + peak.min) * amplitude,  // y
      1,                           // width
      Math.max(1, (peak.max - peak.min) * amplitude)  // height
    );
  }
}
```

## Meter System

### Configuration

```javascript
FFT_SIZE: { mobile: 64, desktop: 128 }     // Per-stem
MASTER_FFT: { mobile: 256, desktop: 1024 } // Master waveform
```

### Level Calculation

```javascript
function calculateLevel(analyser) {
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);
  return Math.max(...data) / 255;  // 0-1
}
```

### Update Rate

Meters update at ~30fps via the AnimationManager throttling system. Only visible channels update (virtualization via IntersectionObserver).

## Configuration Constants

### Performance Tuning

| Constant | Mobile | Desktop |
|----------|--------|---------|
| `BATCH_SIZE` | 3 | 10 |
| `FFT_SIZE` | 64 | 128 |
| `MASTER_FFT` | 256 | 1024 |

### Dimensions

| Constant | Value |
|----------|-------|
| `WAVEFORM_WIDTH` | 140 |
| `WAVEFORM_HEIGHT` | 30 |

## Default State Values

```javascript
DEFAULT_FX_STATE = {
  eq: { low: 0, mid: 0, high: 0 },
  filter: { freq: 20000, resonance: 1, type: 'lowpass', rolloff: -12 },
  compressor: { threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 },
  distortion: { drive: 0, tone: 'warm', mix: 0 },
  tremolo: { rate: 4, depth: 0, shape: 'sine' },
  ringmod: { frequency: 440, shape: 'sine', mix: 0 },
  reverb: { send: 0 },
  delay: { time: 0.375, feedback: 0.3, mix: 0 },
  pan: 0
}

DEFAULT_STEM_STATE = {
  volume: 0.8,
  muted: false,
  solo: false,
  fx: { ...DEFAULT_FX_STATE }
}

DEFAULT_MASTER_VOLUME = 0.8
```

## Mobile Detection

```javascript
const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
  || ('ontouchstart' in window);
```

Used to select appropriate batch sizes and FFT sizes.

## Audio Context Handling

### Safari Compatibility

Safari (especially macOS) requires explicit AudioContext resume:

```javascript
async play() {
  // Always resume - required for Safari
  await this.audio.resume();

  Object.values(this.players).forEach(p => {
    p.audioElement.play();
  });
}
```

### State Management

```javascript
audioContext.state === 'suspended'  // User hasn't interacted
audioContext.state === 'running'    // Active
audioContext.state === 'closed'     // Disposed
```

## Error Handling

### Stem Loading Errors

```javascript
try {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  // Process blob...
} catch (e) {
  console.warn(`Failed to load stem ${index}:`, e);
  // Continue loading other stems
}
```

### Audio Playback Errors

```javascript
p.audioElement.play().catch(e => {
  if (e.name !== 'AbortError') {
    console.warn('Playback error:', e);
  }
  // AbortError is normal when stopping during play
});
```

### WebAudio Node Errors

Parameters are clamped to valid ranges before applying:

```javascript
const clampedValue = Math.max(0, Math.min(1, value));
gainNode.gain.setTargetAtTime(clampedValue, currentTime, 0.02);
```
