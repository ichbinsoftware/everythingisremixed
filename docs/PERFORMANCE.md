# Performance Optimizations

This document details the performance optimizations implemented in the EVR Mixer application.

## Overview

The mixer handles up to 38 simultaneous audio stems with real-time metering, effects processing, and visualization. These optimizations ensure smooth 60fps performance even on mobile devices.

## Animation Loop Optimizations

### 1. Pre-allocated TypedArrays

**Problem:** Creating new `Float32Array` objects every animation frame causes garbage collection pressure.

**Solution:** Pre-allocate buffers once during initialization and reuse them.

```javascript
// Allocated once in initBuffers()
let masterWaveformBuffer = null;
let meterBuffers = {};
let masterMeterBuffer = null;

function initBuffers() {
  masterWaveformBuffer = new Float32Array(audioEngine.analyser.frequencyBinCount);
  Object.entries(meters).forEach(([index, meter]) => {
    meterBuffers[index] = new Float32Array(meter.frequencyBinCount);
  });
}
```

**Impact:** Eliminates ~2,400 allocations/second (40 buffers × 60fps)

### 2. Cached DOM References

**Problem:** `document.getElementById()` called 1,140+ times/second for meter updates.

**Solution:** Cache element references after building the UI.

```javascript
// In UIBuilder
_cacheMeterElements(players) {
  this.meterElements = {};
  Object.keys(players).forEach(index => {
    this.meterElements[index] = document.getElementById(`meter-${index}`);
  });
  this.masterMeterElement = document.getElementById('masterMeterFill');
}

updateMeter(index, level) {
  const el = this.meterElements[index];  // Cached lookup
  if (el) el.style.transform = `scaleY(${level})`;
}
```

**Impact:** Zero DOM lookups per frame for meter updates

### 3. GPU-Accelerated Meter Animation

**Problem:** Animating CSS `height` triggers layout recalculation (reflow).

**Solution:** Use `transform: scaleY()` which only requires compositing.

```css
.meter-fill {
  height: 100%;
  transform-origin: bottom;
  transform: scaleY(0);
  transition: transform 0.05s;
  will-change: transform;
}
```

**Impact:** Eliminates layout thrashing for 38+ meters updating at 30fps

### 4. Throttled Updates (AnimationManager)

**Problem:** Progress bar updated at 60fps but changes only visible at ~10fps.

**Solution:** Use `AnimationManager` to throttle tasks to specific frame rates.

```javascript
// In mixer-app.js
loop.add('progress', updateProgress, 10); // 10 FPS
loop.add('meters', updateMeters, 30);     // 30 FPS
```

**Impact:** 83% reduction in progress bar DOM updates, 50% reduction in meter calculations.

### 5. Cached hasSolo() Results

**Problem:** `isStemActive()` called `hasSolo()` internally, causing O(n²) complexity.

**Solution:** Accept optional cached value to avoid redundant iterations.

```javascript
// Before: O(n²)
Object.entries(players).forEach(([index]) => {
  mixerState.isStemActive(index);  // Each call iterates all stems
});

// After: O(n)
const hasSolo = mixerState.hasSolo();  // Once
Object.entries(players).forEach(([index]) => {
  mixerState.isStemActive(index, hasSolo);  // Uses cached value
});
```

**Impact:** With 38 stems: 1,444 iterations → 76 iterations

## Memory Management

### 6. Early Blob Release

**Problem:** Blob objects (2-5MB each) held in memory until page unload.

**Solution:** Release blob objects after waveforms are cached, keep URLs for audio.

```javascript
function releaseBlobs() {
  Object.values(players).forEach(p => {
    // Release blob object (frees ArrayBuffer memory)
    if (p.blob) p.blob = null;
    // Keep blobUrl - audio element still needs it
  });
}

function revokeBlobUrls() {
  // Only called on page unload
  Object.values(players).forEach(p => {
    if (p.blobUrl) URL.revokeObjectURL(p.blobUrl);
  });
}
```

**Impact:** 50-200MB freed during session instead of at unload

### 7. Event Listener Cleanup

**Problem:** Global event listeners never removed, causing memory leaks on re-initialization.

**Solution:** Store handler references and provide `dispose()` method.

```javascript
_setupGlobalFaderListeners() {
  this._onMouseMove = e => { /* ... */ };
  window.addEventListener('mousemove', this._onMouseMove);
}

dispose() {
  window.removeEventListener('mousemove', this._onMouseMove);
  this._onMouseMove = null;
}
```

**Impact:** Prevents listener accumulation on track changes

### 8. Event Delegation

**Problem:** Per-channel event listeners multiply with stem count (38 stems × 4 handlers = 152 listeners).

**Solution:** Use event delegation with single listeners on the container element.

```javascript
_setupDelegatedListeners() {
  // Single click handler for all mute/solo/fx buttons
  this._onContainerClick = e => {
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
  this.container.addEventListener('click', this._onContainerClick);
}

dispose() {
  this.container.removeEventListener('click', this._onContainerClick);
  this._onContainerClick = null;
}
```

**Impact:** Reduces listener count from O(n × handlers) to O(handlers)

### 9. Signal LED Cached Elements

**Problem:** Signal LED updates require DOM lookups for each channel.

**Solution:** Cache LED and channel element references alongside meter elements.

```javascript
// In _cacheMeterElements()
this.signalLedElements = {};
this.channelElements = {};
Object.keys(players).forEach(index => {
  this.signalLedElements[index] = document.getElementById(`led-${index}`);
  this.channelElements[index] = document.getElementById(`channel-${index}`);
});

// In setChannelSignal() - uses cached reference
setChannelSignal(index, hasSignal) {
  const channel = this.channelElements[index];
  if (channel) channel.classList.toggle('has-signal', hasSignal);
}
```

**Impact:** Zero DOM lookups per frame for signal LED updates

### 10. Channel Visibility Tracking (Virtualization)

**Problem:** Meter updates run for all 38 channels even when scrolled off-screen.

**Solution:** Use `IntersectionObserver` to track visible channels and skip meter updates for invisible ones.

```javascript
// In UIBuilder constructor
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

// In updateMeters() (mixer-app.js)
if (!uiBuilder.isChannelVisible(index)) return;
```

**Impact:** With typical viewport showing ~8 channels, skips 30 meter calculations per frame

### 18. Time Slicing for Meters

**Problem:** Updating all meters at 30fps causes CPU spikes, especially with many stems.

**Solution:** Update only half the meters per frame using frame parity. Even-indexed meters update on even frames, odd-indexed on odd frames.

```javascript
// Meter Update Strategy:
// - Called at 30fps via AnimationManager
// - Time Slicing: Even-indexed meters update on even frames, odd on odd frames
//   This halves the work per frame (30fps loop → 15fps effective per meter)
// - Virtualization: Skip meters for channels scrolled out of view
// - Dirty checking: UIBuilder skips DOM updates if value unchanged

let meterUpdateFrame = 0;

function updateMeters() {
  meterUpdateFrame++;
  const frameParity = meterUpdateFrame % 2;

  Object.entries(meters).forEach(([i, meter]) => {
    // Virtualization: Skip invisible channels
    if (uiBuilder.isChannelVisible && !uiBuilder.isChannelVisible(i)) return;

    // Time Slicing: Update only half the meters per frame
    if (parseInt(i) % 2 !== frameParity) return;

    // ... meter calculation
  });
}
```

**Impact:** Each meter updates at 15fps effective rate (30fps / 2), but perceived as smooth due to staggered updates. Combined with virtualization, only visible meters are processed.

### 19. Dirty Check for Meter DOM Updates

**Problem:** Setting `transform` triggers style recalculation even when value hasn't changed.

**Solution:** Track last meter level and only update DOM if changed significantly.

```javascript
const lastMeterLevels = {};

function updateMeter(index, level) {
  // Skip if value changed by less than 1%
  if (Math.abs((lastMeterLevels[index] || 0) - level) < 0.01) return;
  lastMeterLevels[index] = level;

  el.style.transform = `scaleY(${level})`;
}
```

**Impact:** Reduces DOM updates by ~30-50% during steady-state playback

## Holographic Visualizer Optimizations

The 3D "City Landscape" holographic visualizer uses OffscreenCanvas + Web Worker for off-main-thread rendering.

### 11. Pre-allocated Arrays

**Problem:** Creating new arrays every frame causes GC pressure in the worker.

**Solution:** Pre-allocate and reuse arrays.

```javascript
// Allocated once in init()
let newRow = new Array(GRID_COLS);
let points = Array(GRID_ROWS).fill(null).map(() => Array(GRID_COLS).fill(null));

// In draw() - reuse arrays
const recycledRow = gridData.pop();
gridData.unshift(newRow);
newRow = recycledRow;  // Recycle the popped row
```

**Impact:** Zero allocations per frame in the render loop

### 12. Cached Projection Constants

**Problem:** `centerX`, `centerY` recalculated every frame.

**Solution:** Calculate once on resize, store at module level.

```javascript
// Calculated once in resize()
let centerX = 0;
let centerY = 0;
const FOV = 300;
const VIEW_DISTANCE = 150;

function resize({ width, height }) {
  centerX = width / 2;
  centerY = height / 2 - 40;
}

function project(c, r, amp) {
  // Uses cached centerX, centerY, FOV, VIEW_DISTANCE
  const scale = FOV / (VIEW_DISTANCE + z3d);
  return { x: centerX + x3d * scale, y: centerY + y3d * scale };
}
```

### 13. Fake Glow Effect

**Problem:** `shadowBlur` is expensive and was applied on every "now" line draw.

**Solution:** Use a 2-pass "fake glow" - thick colored line underneath, thin white line on top.

```javascript
// Before: expensive shadowBlur every frame
ctx.shadowBlur = 15;
ctx.strokeStyle = '#ffffff';
ctx.stroke();

// After: cheap 2-pass fake glow
ctx.strokeStyle = glowColor;  // Cached color string
ctx.lineWidth = 6;
ctx.stroke();  // Thick glow layer

ctx.strokeStyle = '#ffffff';
ctx.lineWidth = 2;
ctx.stroke();  // Thin white layer
```

**Impact:** Eliminates per-frame shadow calculations

### 14. Conditional Shadow on Peaks

**Problem:** `shadowBlur` applied even when no peaks exist.

**Solution:** Track if any peaks exist and skip shadow pass when not needed.

```javascript
let hasPeaks = false;
for (let i = 0; i < GRID_COLS; i++) {
  const amp = calculateAmplitude(i);
  if (amp >= 160) hasPeaks = true;
}

// Only apply expensive shadow when peaks exist
if (hasPeaks) {
  ctx.shadowBlur = 10;
  drawGridLines(ctx, points, gridData, PEAK_THRESH, 255);
}
```

### 15. Throttled to 30fps

**Problem:** Holograph rendered at 60fps but visual changes aren't perceptible.

**Solution:** Throttle to 30fps in the animation loop.

```javascript
let lastHolographTime = 0;

function loop(now) {
  // Throttle holograph to ~30fps (33ms)
  if (transport.isPlaying && holograph && now - lastHolographTime > 33) {
    holograph.update();
    lastHolographTime = now;
  }
}
```

**Impact:** 50% reduction in worker messages and render calls

### 16. Cached Color Strings

**Problem:** RGB color strings built every frame via template literals.

**Solution:** Build once at init, store for reuse.

```javascript
// Built once in init()
glowColor = `rgb(${themeColorRgb.r},${themeColorRgb.g},${themeColorRgb.b})`;

// Reused every frame
ctx.shadowColor = glowColor;
ctx.strokeStyle = glowColor;
```

## CSS Optimizations

### 17. Inline Styles Moved to Stylesheet

**Problem:** ~500 bytes of inline styles in HTML template, not cacheable.

**Solution:** Move to CSS classes.

```html
<!-- Before -->
<div style="position:fixed; top:0; left:0; width:100%; ...">

<!-- After -->
<div class="start-overlay" style="--track-color: #8f01ff;">
```

**Impact:** Smaller HTML, better caching, maintainable styles

## Summary Table

| Optimization | Category | Impact |
|--------------|----------|--------|
| Pre-allocated TypedArrays | GC | -2,400 allocs/sec |
| Cached DOM references | DOM | -1,140 lookups/sec |
| CSS transform for meters | Render | GPU-only compositing |
| Throttled progress | DOM | -83% updates |
| Cached hasSolo() | CPU | O(n) vs O(n²) |
| Early blob release | Memory | -50-200MB |
| Event listener cleanup | Memory | No leaks |
| Event delegation | Memory/DOM | O(1) vs O(n) listeners |
| Channel visibility tracking | CPU | Skip ~80% meter updates |
| CSS classes | Network | Better caching |
| Holograph pre-allocated arrays | GC | Zero allocs in render loop |
| Holograph cached constants | CPU | No recalculation per frame |
| Holograph fake glow | GPU | No shadowBlur on "now" line |
| Holograph conditional shadow | GPU | Skip shadow when no peaks |
| Holograph 30fps throttle | CPU/GPU | -50% render calls |
| Holograph cached colors | GC | No string concat per frame |
| Signal LED cached elements | DOM | Zero lookups for LED updates |
| Time slicing for meters | CPU | 15fps effective per channel |
| Dirty check for meter DOM | DOM | -30-50% DOM updates |
| Simplified reverb chain | Audio | -3 nodes per stem |
| Shorter impulse response | Audio | 1s (desktop) / 0.5s (mobile) |
| Leader-based time tracking | Audio | Consistent sync reference |
| Threshold-based seeking | Audio | Avoids unnecessary re-buffering |
| AAC decoder warm-up | Audio | Prevents stall on stems with leading silence |

## Audio Synchronization

The transport uses a "Master Clock" pattern with playback rate nudging (desktop only) to maintain sync across multiple stems.

### The Fundamental Problem

The W3C Web Audio specification states that `MediaElementSourceNode` does not propagate timing information through the audio graph. Each `HTMLMediaElement` maintains its own independent clock that can drift relative to other elements.

**Why not use `AudioBufferSourceNode`?** It provides sample-accurate sync, but requires loading entire audio files into memory. For 30 stems at 4 minutes each: **~1.2GB RAM** - unacceptable for mobile devices.

### Sources of Desync

| Source | Impact | Cause |
|--------|--------|-------|
| Sequential Fire Lag | 10-50ms | Calling `.play()` on 30 elements sequentially |
| Independent Clock Drift | 10-20ms over 5 min | Each element has its own clock driver |
| Seek Race Conditions | Variable | `currentTime` assignment is asynchronous |

### Solution: Leader Election + Optimistic Start

#### Leader Election

A rhythmic stem is selected as the master clock reference:

```javascript
// Priority: kick > main drums > drums > beat > perc > bass
getLeader() {
  const patterns = [
    { regex: /kick/i, score: 100 },
    { regex: /main.*drums|drums.*main/i, score: 90 },
    { regex: /drums/i, score: 80 },
    { regex: /beat/i, score: 70 },
    { regex: /perc|prc/i, score: 60 },
    { regex: /bass/i, score: 20 }
  ];
  // Returns highest-scored stem
}

// Cached getter avoids redundant regex matching
get leader() {
  if (!this.cachedLeader) {
    this.cachedLeader = this.getLeader();
  }
  return this.cachedLeader;
}
```

#### Optimistic Start

Instead of waiting for all stems (which breaks mobile user gesture), playback starts immediately:

```javascript
// Only re-seek if significantly off (>100ms)
if (Math.abs(p.audioElement.currentTime - this.pauseTime) > 0.1) {
  p.audioElement.currentTime = this.pauseTime;
}
p.audioElement.play();
```

### Playback Rate Nudging (Desktop Only)

During playback, stems are gradually corrected using `playbackRate` adjustment instead of hard seeks:

```javascript
// Called from animation loop ~1Hz (desktop only)
syncCheck() {
  const leaderTime = this.leader.audioElement.currentTime;

  Object.values(this.players).forEach(p => {
    if (p === this.leader) return;

    const drift = p.audioElement.currentTime - leaderTime;
    const absDiff = Math.abs(drift);

    // Extreme drift - hard resync
    if (absDiff > 0.5) {
      p.audioElement.currentTime = leaderTime;
      p.audioElement.playbackRate = 1.0;
      return;
    }

    // Hysteresis thresholds
    const isNudging = this.nudgingStems.has(p);

    if (isNudging && absDiff < 0.005) {
      // Close enough - stop nudging
      p.audioElement.playbackRate = 1.0;
      this.nudgingStems.delete(p);
    } else if (absDiff > 0.020 || isNudging) {
      // Apply nudge (two-tier rates)
      const newRate = drift < 0
        ? (absDiff > 0.05 ? 1.005 : 1.002)  // Behind - speed up
        : (absDiff > 0.05 ? 0.995 : 0.998); // Ahead - slow down
      p.audioElement.playbackRate = newRate;
      this.nudgingStems.add(p);
    }
  });
}
```

#### Sync Algorithm Flow (Desktop)

```
Every ~1 second (via requestAnimationFrame):
│
├─ Get leader stem time
│
└─ For each follower stem:
    │
    ├─ If |drift| > 500ms → HARD RESYNC (currentTime = leaderTime)
    │
    ├─ If nudging AND |drift| < 5ms → STOP (playbackRate = 1.0)
    │
    ├─ If |drift| > 20ms OR already nudging → NUDGE
    │   ├─ Behind: playbackRate = 1.002 (or 1.005 if >50ms)
    │   └─ Ahead:  playbackRate = 0.998 (or 0.995 if >50ms)
    │
    └─ Else (5-20ms) → DO NOTHING (dead zone)
```

#### Key Features

| Feature | Purpose |
|---------|---------|
| Hysteresis (enter >20ms, exit <5ms) | Prevents oscillation at threshold boundaries |
| Two-tier rates (0.2% / 0.5%) | Faster correction for larger drift |
| Hard-seek fallback (>500ms) | Handles stalls/buffer issues |
| `preservesPitch = true` | Prevents chipmunk effect during rate changes |
| Animation loop integration | Better than `setInterval` for background tabs |
| Float epsilon comparison | Avoids floating point comparison issues |

#### Correction Time Estimates

| Drift | Rate | Time to Correct |
|-------|------|-----------------|
| 20ms | 0.2% | ~10 seconds |
| 50ms | 0.5% | ~10 seconds |
| 100ms | 0.5% | ~20 seconds |
| 500ms+ | - | Instant (hard resync) |

### Mobile vs Desktop Strategy

| Feature | Desktop | Mobile |
|---------|---------|--------|
| Leader Election | Yes | Yes |
| Leader-based Time Capture | Yes | Yes |
| Threshold-based Play (>100ms) | Yes | Yes |
| Playback Rate Nudging | Yes | **No** |
| Hard-seek Sync Correction | Yes (>500ms) | **No** |
| Any Active Sync Correction | Yes (~1Hz) | **No** |

**Why sync correction is disabled on mobile:**
- `playbackRate` changes trigger time-stretching for `preservesPitch` which is CPU-intensive
- Hard-seek sync correction causes audible audio stops and glitches due to re-buffering
- Mobile relies solely on the optimistic start strategy (simultaneous `.play()` calls)
- Mobile browsers keep stems reasonably synced without active correction

### Testing Sync Quality

To measure drift programmatically:

```javascript
// In browser console during playback
const times = Object.values(transport.players).map(p => p.audioElement.currentTime);
const maxDrift = Math.max(...times) - Math.min(...times);
console.log(`Max drift: ${(maxDrift * 1000).toFixed(1)}ms`);
```

Manual testing:
1. Mute all stems except two with different timbres (e.g., drums and synth)
2. Play for 5+ minutes without interaction
3. Use skip forward/back multiple times
4. On mobile: lock/unlock device during playback
5. Listen for phasing or echo-like effects indicating drift

### Result

**Desktop:** Achieves **"perceptually perfect" sync (<20ms variance)** using gradual playback rate correction at ~1Hz from the animation loop. Hard-seek fallback handles extreme drift (>500ms).

**Mobile:** Uses NO active drift correction. Relies on:
1. Leader-based time tracking for consistent progress display
2. Optimistic simultaneous play start
3. Threshold-based seeking (only re-seek if >100ms off)

This is sufficient for mixing purposes - mobile browsers generally maintain acceptable sync without active correction, and any correction attempts cause more problems (stuttering, glitches) than they solve.

## AAC Decoder Warm-up (Desktop)

Stems with long leading silence can cause audio stalls when dense audio suddenly begins, due to the AAC decoder needing to rapidly scale up from processing tiny silence packets to large audio packets.

**How it works:** During stem loading, each audio element seeks to the middle of the file (where actual audio exists), waits briefly, then seeks back to 0. This "warms up" the AAC decoder so it's ready when playback reaches dense audio sections.

**Example:** PLUCK in Sodium has 14.5s of silence before sustained audio at 148 kbps. Without warm-up, the decoder's cold-start causes a 1-2 second stall.

```javascript
// In mixer-loader.js, after canplaythrough fires
if (!this.isMobile) {
  const warmupTime = audioEl.duration / 2;
  audioEl.currentTime = warmupTime;
  await new Promise(r => setTimeout(r, 50));
  audioEl.currentTime = 0;
}
```

### Performance Impact

**Loading time:** ~150ms additional for Sodium (28 stems)
- Desktop batch size: 10 stems
- 3 batches × 50ms = 150ms (warm-up runs in parallel within each batch)

**Runtime:** Zero impact - warm-up only happens during initial load

**Desktop only:** Mobile uses lower bitrate files with different browser audio handling.

## Device-Specific Tuning

The application automatically adjusts based on device:

| Setting | Mobile | Desktop |
|---------|--------|---------|
| Batch size | 3 stems | 10 stems |
| FFT size (per-stem) | 64 | 128 |
| Waveform FFT | 256 | 1024 |
| Holograph FFT | 512 | 2048 |
| Reverb IR duration | 0.5s | 1s |
| Sync correction | None | Playback rate nudging |

## Measuring Performance

To profile the mixer:

1. Open Chrome DevTools → Performance tab
2. Start recording, interact with mixer
3. Look for:
   - Long tasks (>50ms) in Main thread
   - Forced reflows in Rendering
   - GC pressure in Memory

The optimizations above should result in:
- No forced reflows during playback
- Minimal GC activity
- Consistent 60fps frame rate
