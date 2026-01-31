# Development Guides

## Adding a New Track

To add a new track to the mixer, you must update the worker configuration, add stem definitions, and upload audio files.

### 1. Update Worker Configuration

In `everything-is-remixed-worker.js`, add an entry to the `TRACKS` object:

```javascript
const TRACKS = {
  // ... existing tracks ...
  'newtrack': {
    name: 'NewTrack',
    bpm: 128,
    key: 'A Major',
    number: 8,
    symbol: 'Nt',
    color: '#00ff00'
  },
};
```

### 2. Add Stem Definitions

In `stems.json`, add an entry for the new track:

```json
{
  "newtrack": [
    {
      "file": "1-Kick.m4a",
      "name": "KICK",
      "desc": "Kick drum pattern",
      "color": "#00ff00",
      "downSample": true,
      "mono": true
    },
    {
      "file": "2-Bass.m4a",
      "name": "BASS",
      "desc": "Bass line",
      "color": "#00cc00",
      "downSample": true,
      "mono": true
    }
    // ... more stems
  ]
}
```

**Stem Properties:**
- `file`: Filename in R2 bucket
- `name`: Display name (uppercase)
- `desc`: Description (optional)
- `color`: Hex color for channel
- `downSample`: Optimization flag (for bass-heavy stems)
- `mono`: Optimization flag (for non-stereo stems)

### 3. Generate Waveform Peaks

Pre-generate waveform data to avoid audio decoding on load:

1. Open `src/peak-generator.html` in a browser
2. Select the new track from the dropdown
3. Click "Generate Peaks" to process all stems
4. Download the generated JSON file
5. Save as `src/workers/newtrack_peaks.json`

### 4. Infrastructure Setup

**R2 Bucket:**
1. Create a new R2 bucket in Cloudflare dashboard
2. Name it consistently (e.g., `newtrack-stems`)
3. Upload all stem audio files (`.m4a` format)

**Worker Binding:**
Add an R2 bucket binding for the new track (e.g., `NEWTRACK` → `newtrack-stems`).

---

## Adding New FX Parameters

The FX system can be extended with new effect types.

### 1. Update Default State

In `app/modules/mixer-constants.js`, add the new parameter to `DEFAULT_FX_STATE`:

```javascript
export const DEFAULT_FX_STATE = {
  eq: { low: 0, mid: 0, high: 0 },
  filter: { freq: 20000, resonance: 1, type: 'lowpass' },
  reverb: 0,
  delay: { time: 0.375, feedback: 0.3, mix: 0 },
  pan: 0,
  // Add new effect:
  chorus: { rate: 1, depth: 0, mix: 0 }
};
```

### 2. Create Audio Nodes

In `app/modules/mixer-audio.js`, add a method to create the effect nodes:

```javascript
createChorus() {
  // Create LFO for modulation
  const lfo = this.ctx.createOscillator();
  const lfoGain = this.ctx.createGain();
  const delay = this.ctx.createDelay(0.05);
  const wet = this.ctx.createGain();
  const dry = this.ctx.createGain();
  const merger = this.ctx.createChannelMerger(2);

  lfo.frequency.value = 1;
  lfoGain.gain.value = 0;
  delay.delayTime.value = 0.025;
  wet.gain.value = 0;
  dry.gain.value = 1;

  lfo.connect(lfoGain);
  lfoGain.connect(delay.delayTime);
  lfo.start();

  return { lfo, lfoGain, delay, wet, dry, merger };
}
```

### 3. Add Modal Controls

In `app/modules/mixer-templates.js`, add the control section to the FX modal template (in the appropriate tab):

```javascript
<div class="fx-section">
  <label>Chorus</label>
  <div class="fx-control">
    <span class="fx-label">Rate</span>
    <input type="range" min="0.1" max="10" step="0.1" value="${fx.chorus.rate}"
           class="fx-slider" id="chorus-rate-${index}">
    <span class="fx-value" id="chorus-rate-val-${index}">${fx.chorus.rate.toFixed(1)}Hz</span>
  </div>
  <div class="fx-control">
    <span class="fx-label">Depth</span>
    <input type="range" min="0" max="100" step="1" value="${fx.chorus.depth}"
           class="fx-slider" id="chorus-depth-${index}">
    <span class="fx-value" id="chorus-depth-val-${index}">${Math.round(fx.chorus.depth)}%</span>
  </div>
  <div class="fx-control">
    <span class="fx-label">Mix</span>
    <input type="range" min="0" max="100" step="1" value="${fx.chorus.mix}"
           class="fx-slider" id="chorus-mix-${index}">
    <span class="fx-value" id="chorus-mix-val-${index}">${Math.round(fx.chorus.mix)}%</span>
  </div>
</div>
```

### 4. Wire Up Event Listeners

In `app/modules/mixer-fx.js`, add handlers in `setupModalListeners()`:

```javascript
modal.querySelector(`#chorus-rate-${index}`).addEventListener('input', e => {
  const value = parseFloat(e.target.value);
  this.state.updateFX(index, 'chorus', 'rate', value);
  player.effects.chorus.lfo.frequency.setTargetAtTime(value, currentTime(), 0.01);
  modal.querySelector(`#chorus-rate-val-${index}`).textContent = `${value.toFixed(1)}Hz`;
  if (this.onUpdate) this.onUpdate();
});
// ... depth and mix handlers
```

### 5. Update Share URL Encoding

In `app/modules/mixer-state.js`, extend `toShareUrl()` and `applyFromUrl()` to include the new parameters.

---

## Modifying the Signal Chain

### Current Chain
```
Source → EQ → Filter → Delay → Panner → Gain → Analyser → Master
```

### Adding a Node

To insert a new node (e.g., compressor after EQ):

1. **Create the node** in `app/modules/mixer-audio.js`:
```javascript
createCompressor() {
  const comp = this.ctx.createDynamicsCompressor();
  comp.threshold.value = -24;
  comp.knee.value = 30;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.25;
  return comp;
}
```

2. **Update the chain** in `app/mixer-app.js` stem creation:
```javascript
// Current:
source → eq.lowShelf → eq.mid → eq.highShelf → filter → ...

// With compressor:
source → eq.lowShelf → eq.mid → eq.highShelf → compressor → filter → ...
```

3. **Store reference** in the player object:
```javascript
player.effects.compressor = compressor;
```

---

## Customizing the UI

### Channel Width

In `app/mix-style.css`, modify the `.channel` class:

```css
.channel {
  width: 80px;  /* Default: 60px */
  min-width: 80px;
}
```

### Fader Height

```css
.fader {
  height: 150px;  /* Default: 100px */
}
```

### Color Theming

The mixer uses CSS custom properties for theming:

```css
:root {
  --track-color: #4ecdc4;  /* Injected by worker */
}

.channel-btn.active {
  background: var(--track-color);
  box-shadow: 0 0 10px var(--track-color);
}
```

### Dark/Light Theme

Theme is controlled via `data-theme` attribute on the document root:

```css
:root[data-theme="dark"] {
  --bg: #0a0a0a;
  --fg: #ffffff;
}

:root[data-theme="light"] {
  --bg: #f0f0f0;
  --fg: #1a1a1a;
}
```

**Theme Toggle:**
```javascript
const newTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
document.documentElement.setAttribute('data-theme', newTheme);
localStorage.setItem('evr-theme', newTheme);
```

**Early Loading (prevents flash):**
```html
<script>document.documentElement.setAttribute('data-theme', localStorage.getItem('evr-theme') || 'dark');</script>
```

**Theme-Aware Components:**
- Listing grid (Swiss Lab cards)
- Start overlay
- Loading view
- Mixer panel
- Channel buttons
- Waveforms (stem + master/holograph)
- Help modal icons

---

## Performance Tuning

### Reducing CPU Usage

1. **Reduce FFT Size:**
```javascript
export const FFT_SIZE = { mobile: 32, desktop: 64 };
```

### Reducing Memory Usage

1. **Use Pre-generated Peaks:**
   - Ensure all `{trackId}_peaks.json` files exist
   - Avoids storing full AudioBuffers

2. **Reduce Batch Size:**
```javascript
export const BATCH_SIZE = { mobile: 2, desktop: 5 };
```

### Mobile Optimization

The mixer automatically detects mobile devices:

```javascript
const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
  || ('ontouchstart' in window);
```

Mobile gets reduced settings:
- Smaller FFT sizes
- Smaller batch sizes
- Touch-optimized fader handling

---

## Debugging Tips

### Audio Issues

**No Sound:**
1. Check browser console for AudioContext state
2. Ensure user interaction before `play()`
3. Verify stem URLs are accessible

**Clicking/Popping:**
1. Use `setTargetAtTime()` instead of direct value assignment
2. Check for rapid parameter changes

**Safari Issues:**
1. Always call `audioContext.resume()` on play
2. Check for webkit-specific AudioContext

### FX Modal Issues

**Modal Not Appearing:**
1. Verify modal element exists in DOM
2. Check click event is reaching the FX button

**Values Not Applying:**
1. Check event listener is attached
2. Verify audio node references
3. Check state is being updated

**Tabs Not Switching:**
1. Verify tab button click handlers
2. Check `.active` class is toggling

### Help System Issues

**Help Modal Not Appearing:**
1. Verify `HelpController.init()` was called
2. Check help button exists (only on track pages)
3. Verify modal elements in DOM

**Keyboard Shortcut (?) Not Working:**
1. Check focus isn't in an input/textarea/select
2. Verify keydown listener is attached
3. Check `isInputFocused()` method

**Mobile Bottom Sheet Not Swiping:**
1. Verify `isMobile` detection is correct
2. Check touch event listeners on handle element
3. Verify `bindSwipeEvents()` was called

### Share URL Issues

**URL Not Working:**
1. Check parameter count matches expected
2. Verify scaling factors (×10, ×100)
3. Test with minimal state first

### Performance Issues

1. Use browser DevTools Performance tab
2. Check `requestAnimationFrame` callback duration
3. Reduce FFT sizes or disable meters

---

---

## Testing Checklist

Before deploying, verify:

- [ ] All stems load correctly
- [ ] Waveforms display
- [ ] Play/pause/stop work
- [ ] Skip buttons work (±10s)
- [ ] Restart button works
- [ ] Mute/solo toggle correctly
- [ ] FX modal opens/closes (click FX button)
- [ ] FX modal tabs switch correctly
- [ ] FX sliders affect audio
- [ ] Pan control works
- [ ] Share URL generates
- [ ] Share URL loads correctly
- [ ] Theme toggle works (listing, loading, mixer views)
- [ ] Theme persists across page reloads
- [ ] No flash of wrong theme on load
- [ ] Waveforms update on theme change
- [ ] Holograph visualizer updates on theme change
- [ ] Mobile touch works
- [ ] Master fader controls volume
- [ ] Reset button works
- [ ] Signal LEDs light up when audio plays
- [ ] Help button opens help modal
- [ ] Help modal tabs switch correctly
- [ ] Help modal closes (×, backdrop, Escape, Got it)
- [ ] Help keyboard shortcut (?) works
- [ ] Mobile: Help bottom sheet swipe-to-dismiss works
- [ ] Holograph visualizer animates during playback
