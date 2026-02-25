# Mixer Effects Upgrade Plan

## Current State

**Existing FX chain (per-stem):**
```
Source → EQ (3-band) → Filter (LP/HP/BP, -12/-24 dB/oct) → Delay → Panner → Gain → Master
                                                                                  └→ Reverb Send → Master Reverb (shared)
```

**Current node count:** ~12-13 per stem (~360-390 for 30 stems)

**Current effects and parameters:**

| Effect | Parameters | Web Audio Nodes |
|--------|-----------|-----------------|
| **3-Band EQ** | Low/Mid/High: -12 to +12 dB | 3 BiquadFilterNodes (lowshelf/peaking/highshelf) |
| **Filter** | Type (LP/HP/BP), Freq (20-20kHz), Q (0.1-10), Rolloff (-12/-24) | 1-2 BiquadFilterNodes |
| **Reverb** | Send: 0-100% | ConvolverNode (shared master) + per-stem GainNode |
| **Delay** | Time (0.01-2s), Feedback (0-90%), Mix (0-100%) | DelayNode + 3 GainNodes |
| **Pan** | -1 to +1 | StereoPannerNode |

---

## New Effects Options

### Tier 1 — High Priority (Native nodes, low cost, industry-standard)

#### 1. Compressor

The most important missing effect. Present in every browser DAW (BandLab, Soundtrap, AudioMass).

| Detail | Value |
|--------|-------|
| **Nodes** | 1 `DynamicsCompressorNode` |
| **Cost per stem** | +1 node |
| **Implementation** | LOW complexity |
| **Scope** | Per-stem |

**Parameters:**

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| threshold | -100 to 0 dB | -24 | Level where compression starts |
| knee | 0 to 40 dB | 30 | Transition smoothness |
| ratio | 1 to 20 | 12 | Compression amount |
| attack | 0 to 1 s | 0.003 | How fast compression engages |
| release | 0 to 1 s | 0.250 | How fast compression releases |

Bonus: `reduction` property (read-only) enables a gain reduction meter in the UI.

**Chain position:** After EQ, before Filter.

---

#### 2. Distortion / Saturation

Second most common effect across browser DAWs. Uses `WaveShaperNode` with custom transfer curves.

| Detail | Value |
|--------|-------|
| **Nodes** | 1 `WaveShaperNode` + 1 `GainNode` (drive) + 1 `GainNode` (output) |
| **Cost per stem** | +3 nodes |
| **Implementation** | LOW-MEDIUM complexity |
| **Scope** | Per-stem |

**Parameters:**

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| drive | 0 to 100 | 0 | Distortion amount (maps to curve shape) |
| tone | enum | warm | Preset: warm, crunch, fuzz, hard-clip |
| mix | 0 to 100% | 0 | Dry/wet blend |

**Curve algorithms:**
- **Warm/Tape:** `Math.tanh(x * amount)` — soft saturation
- **Crunch:** `(3 + k) * x * 20 * (PI/180) / (PI + k * |x|)` — tube-like
- **Fuzz:** Asymmetric soft clip
- **Hard clip:** `Math.max(-1, Math.min(1, x * amount))`

**Notes:**
- `oversample: 'none'` for performance (30 stems), optionally `'2x'` for master bus
- Curve array (~44100 samples, ~172KB per stem, ~5MB for 30 stems) is negligible

**Chain position:** After Compressor, before Filter.

---

#### 3. Tremolo

Very cheap, musically versatile. Creates rhythmic volume modulation.

| Detail | Value |
|--------|-------|
| **Nodes** | 1 `OscillatorNode` (LFO) + 1 `GainNode` (depth) + 1 `ConstantSourceNode` (bias) + 1 `GainNode` (signal) |
| **Cost per stem** | +4 nodes |
| **Implementation** | LOW complexity |
| **Scope** | Per-stem |

**Parameters:**

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| rate | 0.1 to 20 Hz | 4 | Tremolo speed |
| depth | 0 to 100% | 0 | Modulation intensity |
| shape | sine, square, triangle, sawtooth | sine | LFO waveform |

**How it works:** LFO (OscillatorNode) modulates a GainNode's gain. ConstantSourceNode provides DC offset to keep gain in [0,1] range (LFO output is bipolar [-1,+1]).

**Chain position:** After Delay, before Panner.

---

### Tier 2 — Medium Priority (Low-moderate cost, creative effects)

#### 4. Chorus (Send Effect)

High musical value. Best implemented as a shared send (like reverb) to avoid 300+ extra nodes.

| Detail | Value |
|--------|-------|
| **Nodes (shared)** | 2 `DelayNode` + 2 `OscillatorNode` + 5 `GainNode` |
| **Cost per stem** | +1 `GainNode` (send level) |
| **Implementation** | MEDIUM complexity |
| **Scope** | Send/bus (shared, like reverb) |

**Parameters:**

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| send | 0 to 100% | 0 | Per-stem send level |
| rate | 0.1 to 10 Hz | 1.5 | LFO speed (global) |
| depth | 0 to 20 ms | 5 | Modulation depth (global) |

**How it works:** Two voices with phase-offset LFOs modulate DelayNode delay times (5-30ms base). Mixed with dry signal. Per-stem send controls how much of each stem feeds the shared chorus bus.

**Chain position:** Send from stem gain → shared Chorus bus → Master.

---

#### 5. Bitcrusher

Unique lo-fi character. The canonical AudioWorklet example — well-documented.

| Detail | Value |
|--------|-------|
| **Nodes** | 1 `AudioWorkletNode` |
| **Cost per stem** | +1 node |
| **Implementation** | MEDIUM complexity (requires AudioWorklet module) |
| **Scope** | Per-stem |

**Parameters:**

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| bitDepth | 1 to 16 | 16 | Bit reduction (lower = more crushed) |
| sampleRate | 1 to 40 | 1 | Downsampling factor |
| mix | 0 to 100% | 0 | Dry/wet blend |

**Requirements:**
- Separate `AudioWorkletProcessor` JS file
- Async registration via `audioContext.audioWorklet.addModule()`
- Browser support: Chrome 66+, Firefox 76+, Safari 14.1+, Edge 79+

**Chain position:** After Filter, before Delay.

---

#### 6. Ring Modulator

Low cost creative/experimental effect. Nearly identical architecture to tremolo but at audible frequencies.

| Detail | Value |
|--------|-------|
| **Nodes** | 1 `OscillatorNode` + 1 `GainNode` (modulator) + 2 `GainNode` (dry/wet) |
| **Cost per stem** | +4 nodes |
| **Implementation** | LOW complexity |
| **Scope** | Per-stem |

**Parameters:**

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| frequency | 20 to 2000 Hz | 440 | Carrier frequency |
| shape | sine, square, triangle, sawtooth | sine | Carrier waveform |
| mix | 0 to 100% | 0 | Dry/wet blend |

**How it works:** Multiplies audio signal by carrier oscillator, producing sum and difference frequencies. Unlike tremolo (sub-20Hz), ring mod uses audible frequencies for metallic/robotic tones.

**Chain position:** After Filter, before Delay (or swappable with Tremolo position).

---

### Tier 3 — Lower Priority (Higher cost or complexity)

#### 7. Phaser (Send Effect)

Best as a shared send due to high node count (4-12 allpass stages per instance).

| Detail | Value |
|--------|-------|
| **Nodes (shared)** | 4-6 `BiquadFilterNode` (allpass) + 1 `OscillatorNode` + 3 `GainNode` |
| **Cost per stem** | +1 `GainNode` (send level) |
| **Implementation** | MEDIUM-HIGH complexity |
| **Scope** | Send/bus (shared) |

**Parameters:**

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| send | 0 to 100% | 0 | Per-stem send level |
| rate | 0.05 to 8 Hz | 0.5 | LFO sweep speed (global) |
| depth | 0 to 100% | 50 | Modulation intensity (global) |
| feedback | -95 to 95% | 0 | Resonance (global) |
| stages | 2, 4, 6 | 4 | Allpass stages (global) |

**Chain position:** Send from stem gain → shared Phaser bus → Master.

---

#### 8. Tape Stop (Master Effect)

Creative transition effect. Zero additional nodes — uses existing `playbackRate` automation.

| Detail | Value |
|--------|-------|
| **Nodes** | 0 (uses existing source nodes) |
| **Cost** | Negligible |
| **Implementation** | MEDIUM (transport integration, sync recovery) |
| **Scope** | Master only (all stems simultaneously) |

**Parameters:**

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| stopTime | 0.1 to 5 s | 1 | Duration of slowdown |
| curve | linear, exponential | exponential | Deceleration shape |

**Caveat:** Applying to individual stems breaks sync. Must apply to ALL stems simultaneously. Requires transport-level integration and sync recovery after effect completes.

**Chain position:** Transport-level (modifies source playbackRate).

---

#### 9. Auto-Wah / Envelope Follower

| Detail | Value |
|--------|-------|
| **Nodes** | 1 `BiquadFilterNode` (bandpass) + 1 `AnalyserNode` |
| **Cost per stem** | +2-3 nodes + JS polling overhead |
| **Implementation** | HIGH complexity (envelope detection bridges audio/main thread) |
| **Scope** | Per-stem (selectively enabled) |

Not recommended for initial release due to main-thread polling requirement for 30 stems.

---

#### 10. Pitch Shifter

| Detail | Value |
|--------|-------|
| **Nodes** | 1 `AudioWorkletNode` (phase vocoder or granular) |
| **Cost** | HIGH CPU per instance |
| **Implementation** | HIGH complexity (FFT, overlap-add, phase locking) |
| **Scope** | Limited to a few stems, or master only |

Not recommended due to extreme CPU cost at scale. Consider as a future stretch goal.

---

## Proposed New FX Chain

```
Source
  → EQ (3-band)              [existing]
  → Compressor                [NEW - Tier 1]
  → Distortion/Saturation     [NEW - Tier 1]
  → Filter (LP/HP/BP)         [existing]
  → Bitcrusher                [NEW - Tier 2]
  → Ring Modulator            [NEW - Tier 2]
  → Delay                     [existing]
  → Tremolo                   [NEW - Tier 1]
  → Panner                    [existing]
  → Gain                      [existing]
  ├→ Master Analyser           [existing]
  ├→ Reverb Send               [existing]
  ├→ Chorus Send               [NEW - Tier 2]
  └→ Phaser Send               [NEW - Tier 3]

Master Bus:
  Master Reverb (shared)       [existing]
  Master Chorus (shared)       [NEW - Tier 2]
  Master Phaser (shared)       [NEW - Tier 3]
  → Master Gain → Destination  [existing]
```

---

## Performance Strategy

### Lazy Instantiation (Critical)
Do NOT create effect nodes until the user enables them. A stem with all new effects disabled should have zero additional nodes beyond the current baseline.

### Bypass = Disconnect
When an effect is bypassed, disconnect it from the graph entirely. Disconnected nodes consume zero CPU.

### Mobile Limits
On mobile (`isMobile` flag already exists in `AudioEngine`):
- Limit simultaneous active effects per stem
- Disable `oversample` on WaveShaperNode
- Reduce phaser stages (4 → 2)
- Shorter reverb/chorus tails

### Node Budget

| Scenario | Nodes per Stem | x30 Stems | Total |
|----------|---------------|-----------|-------|
| Current (no new FX active) | 12-13 | 360-390 | 360-390 |
| + Compressor only | +1 | +30 | ~420 |
| + Compressor + Distortion | +4 | +120 | ~510 |
| + All Tier 1 per-stem | +8 | +240 | ~630 |
| + All Tier 1 + Tier 2 per-stem | +13 | +390 | ~780 |
| + Send effects (shared) | — | +20 | ~800 |

---

## UI Plan

### FX Modal Tabs

Current tabs: `[EQ / FILTER]` `[REVERB / DELAY]`

**Option A — Add a third tab:**
```
[EQ / FILTER]  [REVERB / DELAY]  [DYNAMICS / MOD]
```
- Dynamics / Mod tab contains: Compressor, Distortion, Tremolo, Ring Mod, Bitcrusher
- Send effects (Chorus, Phaser) add to the Reverb/Delay tab

**Option B — Four tabs:**
```
[EQ / FILTER]  [DYNAMICS]  [MOD / FX]  [SEND / DELAY]
```
- EQ / Filter: EQ, Filter (unchanged)
- Dynamics: Compressor, Distortion
- Mod / FX: Tremolo, Ring Mod, Bitcrusher
- Send / Delay: Reverb, Chorus, Phaser, Delay

### Per-Effect UI Pattern
Each new effect follows the existing slider-based pattern:
```
Effect Name
├─ Param 1   [────●────]  value
├─ Param 2   [────●────]  value
└─ Param 3   [▼ Dropdown  ]
```

### Compressor Gain Reduction Meter
The `DynamicsCompressorNode.reduction` property enables a visual gain reduction indicator — a horizontal bar or LED showing how much compression is being applied in real-time.

---

## State Encoding Extension

Current per-stem URL format (16 fields):
```
index:volume:muted:solo:pan:eqLow:eqMid:eqHigh:filterType:filterFreq:filterRes:reverbSend:delayTime:delayFB:delayMix:filterRolloff
```

**Extended format (adding new effects):**
```
...:filterRolloff:compThresh:compKnee:compRatio:compAttack:compRelease:distDrive:distTone:distMix:tremoloRate:tremoloDepth:tremoloShape:chorusSend:bitDepth:bitSR:bitMix:ringFreq:ringShape:ringMix:phaserSend
```

All new parameters use the same integer-encoding pattern (multiply to avoid decimals in URL). Backward compatible — missing fields default to `DEFAULT_FX_STATE` values.

---

## Implementation Order

| Phase | Effects | Estimated Node Impact | FX Modal Change |
|-------|---------|----------------------|-----------------|
| **Phase 1** | Compressor | +1/stem | Add third tab |
| **Phase 2** | Distortion + Tremolo | +7/stem | Populate third tab |
| **Phase 3** | Chorus (send) + Bitcrusher | +1/stem + shared bus | Extend Reverb/Delay tab |
| **Phase 4** | Ring Mod + Phaser (send) | +4/stem + shared bus | Extend third tab + Reverb/Delay tab |
| **Phase 5** | Tape Stop | 0 (transport) | Master transport UI button |

Each phase includes: constants, audio node factory, state encoding, UI template, FX controller bindings, and standalone mixer sync.

---

## Browser DAW Comparison

| Effect | BandLab | Soundtrap | AudioMass | EVR Current | EVR Proposed |
|--------|---------|-----------|-----------|-------------|--------------|
| EQ | Yes | Yes | Yes | Yes | Yes |
| Compressor | Yes | Yes | Yes | No | **Phase 1** |
| Reverb | Yes | Yes | Yes | Yes | Yes |
| Delay | Yes | Yes | Yes | Yes | Yes |
| Distortion | Yes | Yes | Yes | No | **Phase 2** |
| Filter | Yes | Yes | No | Yes | Yes |
| Chorus | Yes | Yes | No | No | **Phase 3** |
| Tremolo | No | No | No | No | **Phase 2** |
| Bitcrusher | No | No | No | No | **Phase 3** |
| Ring Mod | No | No | No | No | **Phase 4** |
| Phaser | No | No | No | No | **Phase 4** |
| Tape Stop | No | No | No | No | **Phase 5** |
