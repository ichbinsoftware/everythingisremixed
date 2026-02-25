# Client-Side Mix Recording & Export

## Overview

Enable users to record/save their mix as a downloadable audio file entirely client-side — no server required. Two primary approaches exist: **offline rendering** (fast, preferred) and **real-time recording** (fallback).

---

## Approach 1: OfflineAudioContext + Encoding (Recommended)

Renders the mix faster than real-time without playing it through speakers.

### How It Works

1. Create an `OfflineAudioContext` with desired sample rate, channels, and total length
2. Rebuild the audio graph (EQ → Filter → Delay → Panner → Gain → Master + Reverb) inside this context using `AudioBufferSourceNode`
3. Call `startRendering()` — returns a `Promise<AudioBuffer>` with raw PCM data
4. Encode the PCM data to WAV or MP3
5. Trigger browser download

### Performance

- Renders **10-50x faster than real-time** depending on graph complexity
- A 5-minute mix with 15 stems + effects: ~10-30 seconds to render

### Critical Constraint: No HTMLMediaElement Sources

`OfflineAudioContext` does **not** support `createMediaElementSource()`. All audio must be decoded into `AudioBuffer` objects via `decodeAudioData()` first. If EVR currently uses `<audio>` elements for playback, the raw audio data must be fetched and decoded before offline rendering.

### Memory Impact

| Stems | Duration | Decoded Audio RAM |
|-------|----------|-------------------|
| 9 | 5 min | ~945 MB |
| 15 | 5 min | ~1.6 GB |
| 30 | 5 min | ~3.2 GB |
| 38 | 5 min | ~4.0 GB |

(44.1kHz stereo 32-bit float = ~105 MB per 5-minute stem)

**Mitigations:**
- Reuse `AudioBuffer` objects if stems are already decoded for playback
- Render in batches (groups of stems summed sequentially) to reduce peak memory
- Fall back to MediaRecorder approach if memory is insufficient

### Browser Support

Universal. `OfflineAudioContext` supported in all modern browsers. `suspend()`/`resume()` (for progress) supported in Chrome 49+, Firefox 46+, Safari.

### Pros
- No real-time playback required — dramatically faster
- Produces raw PCM — can encode to any format
- Deterministic output
- User doesn't need to hear the mix during export

### Cons
- Cannot use HTMLMediaElement sources — must have AudioBuffers
- Must rebuild entire audio graph in new context
- High memory usage
- Medium-high code complexity

---

## Approach 2: MediaRecorder + MediaStreamDestination (Fallback)

Records the mix in real-time as it plays through speakers.

### How It Works

1. Create `MediaStreamAudioDestinationNode` via `audioContext.createMediaStreamDestination()`
2. Connect master gain to this destination (in addition to speakers)
3. Feed `.stream` into a `MediaRecorder`
4. Collect `Blob` chunks via `ondataavailable`
5. Concatenate into final `Blob` on stop

### Codec Support

| Browser | Format | MIME Type |
|---------|--------|-----------|
| Chrome/Edge | WebM/Opus | `audio/webm;codecs=opus` |
| Chrome 120+ | MP4/AAC | `audio/mp4;codecs=aac` |
| Firefox | WebM/Opus | `audio/webm;codecs=opus` |
| Firefox | OGG/Opus | `audio/ogg;codecs=opus` |
| Safari | MP4/AAC | `audio/mp4` |

**WAV is not natively supported** by MediaRecorder in any browser.

### Pros
- Simple API (~30-50 lines of core logic)
- Low memory overhead (streaming encoding)
- No need to decode stems into AudioBuffers
- Captures exact output as heard

### Cons
- **Must play in real-time** — 5-minute mix takes 5 minutes
- No WAV output
- Codec support fragmented across browsers
- WebM not playable on all devices (iOS)
- Lossy only
- User must not navigate away during recording

---

## Encoding Formats

### WAV (Lossless)

| Aspect | Detail |
|--------|--------|
| **Complexity** | Very low (~60-100 lines, no libraries) |
| **Speed** | Near-instantaneous (just a memory copy + header) |
| **Quality** | Lossless |
| **File size** | ~10 MB/min (16-bit/44.1kHz stereo) |
| **5-min mix** | ~50 MB |
| **Playback** | Universal |

**Implementation:** Write 44-byte RIFF header + interleaved PCM samples. Libraries: [audiobuffer-to-wav](https://github.com/Experience-Monks/audiobuffer-to-wav) (~80 lines, 0 deps) or manual `DataView` construction.

**Best for:** Users who want to import into a DAW for further editing.

---

### MP3 (Lossy, Recommended Default)

| Aspect | Detail |
|--------|--------|
| **Complexity** | Low-medium |
| **Library** | [lamejs](https://github.com/zhuker/lamejs) (LGPL, JS port of LAME) |
| **Speed** | ~20x real-time (~15-20s for 5-min track) |
| **Quality** | 320kbps is perceptually transparent |
| **Patent status** | All MP3 patents expired 2017 |

**File sizes:**

| Bitrate | Quality | 5-min file |
|---------|---------|------------|
| 128 kbps | Acceptable | ~4.7 MB |
| 192 kbps | Good | ~7.0 MB |
| 320 kbps | Transparent | ~11.7 MB |

**Best for:** Sharing and listening. Best balance of quality, size, and universal compatibility.

---

### OGG/Opus (Lossy, Best Quality-Per-Bit)

| Aspect | Detail |
|--------|--------|
| **Complexity** | Medium |
| **Library** | [opus-recorder](https://github.com/chris-rudmin/opus-recorder) (WASM-based) |
| **Quality** | Superior to MP3/AAC at equivalent bitrates |
| **File size** | ~2.3 MB/5min at 64kbps, ~4.7 MB at 128kbps |

**Drawback:** Not playable in Safari (OGG container). Less universal than MP3.

---

## Format Recommendation

Offer users a choice:

| Option | Format | Use Case |
|--------|--------|----------|
| **WAV** | 16-bit/44.1kHz | DAW import, lossless archival |
| **MP3** (default) | 320 kbps | Sharing, listening, universal playback |

MP3 should be the default — best tradeoff of quality, file size, and device compatibility.

---

## Saving / Downloading

### Primary: Blob + Anchor Download (Universal)

```
1. Create Blob from encoded ArrayBuffer
2. URL.createObjectURL(blob)
3. Create <a> with download attribute + filename
4. Programmatic click
5. URL.revokeObjectURL()
```

Works everywhere. Entire file must fit in memory.

### Enhancement: File System Access API (Chromium Only)

`showSaveFilePicker()` lets users choose save location via native dialog. Use as progressive enhancement with fallback to anchor download.

| Browser | Support |
|---------|---------|
| Chrome/Edge 86+ | Yes |
| Firefox | No |
| Safari | No |

### Size Limits

Blob URL limits are typically 500MB-2GB depending on browser and available RAM. A 5-minute mix in any format is well within limits.

---

## Progress Indication

### During OfflineAudioContext Rendering

No native progress callback. Use the **suspend/resume trick:**

1. Schedule `suspend()` calls at regular intervals (e.g., every 10% of total duration)
2. Each suspension resolves a promise — update progress UI
3. Call `resume()` to continue to next checkpoint

Overhead is minimal. Suspending every 1 second of audio time provides good granularity.

### During Encoding

- **WAV:** Near-instant, no progress needed
- **MP3 (lamejs):** Process in chunks (1152 samples). Post progress after each chunk. If in a Web Worker, use `postMessage`.

### Combined Export Progress UX

| Phase | Progress | Detail |
|-------|----------|--------|
| Preparing | 0-10% | Fetch/decode stems not already in memory |
| Rendering | 10-70% | OfflineAudioContext with suspend/resume |
| Encoding | 70-95% | WAV (instant) or MP3 (chunked) |
| Saving | 95-100% | Blob creation + download trigger |

---

## Web Worker Strategy

### What Runs in a Worker

- **MP3/WAV encoding** — offload to a dedicated Worker to keep UI responsive
- Transfer `Float32Array` channel data via **Transferable objects** (zero-copy move, not copy)

### What Cannot Run in a Worker

- `AudioContext` and `OfflineAudioContext` — require main thread
- DOM manipulation for progress UI

### Data Transfer Pattern

1. Main thread: Render via OfflineAudioContext → get `AudioBuffer`
2. Copy channel data: `new Float32Array(audioBuffer.getChannelData(0))`
3. Transfer copy to Worker (original `AudioBuffer` stays intact)
4. Worker encodes → posts back encoded `ArrayBuffer` + progress updates
5. Main thread creates Blob → triggers download

**Note:** Transferring the `ArrayBuffer` backing `AudioBuffer.getChannelData()` directly would neuter the AudioBuffer. Always copy first if you need to keep the AudioBuffer.

---

## Stem Export (Individual Stems with FX)

### Approach

1. For each selected stem, create a separate `OfflineAudioContext`
2. Wire: `AudioBufferSourceNode` → stem's effects chain → destination
3. Render each stem individually (simpler graph, faster per-stem)
4. Encode each to chosen format
5. Bundle into ZIP ([JSZip](https://stuk.github.io/jszip/)) or trigger individual downloads

### UX

- Modal with checkboxes for which stems to export
- Per-stem progress bar
- "Download All" produces a ZIP
- Sequential rendering keeps memory usage manageable (one stem at a time)

---

## Implementation Plan

### Phase 1: Full Mix Export (WAV)

Simplest path to a working export:

1. Add "Export Mix" button to transport/UI
2. Fetch + decode all stems to `AudioBuffer` (or reuse if cached)
3. Build offline graph mirroring current effects chain from `MixerState`
4. Render via `OfflineAudioContext`
5. Encode to WAV (manual header, ~60 lines)
6. Download via Blob + anchor

### Phase 2: MP3 Export

1. Add lamejs (or load dynamically)
2. Create encoding Web Worker
3. Add format selector (WAV / MP3) to export UI
4. Add quality selector for MP3 (128/192/320 kbps)
5. Add progress bar with combined render + encode phases

### Phase 3: Real-Time Recording Fallback

1. Add `MediaStreamAudioDestinationNode` to master output
2. Implement MediaRecorder with codec detection
3. Add record button (red dot) to transport
4. Show recording duration / status
5. Auto-detect best codec per browser

### Phase 4: Stem Export

1. Add "Export Stems" option to export modal
2. Stem selection UI (checkboxes)
3. Sequential OfflineAudioContext rendering per stem
4. ZIP packaging via JSZip
5. Per-stem progress tracking

---

## Architecture Integration Points

| Component | Change |
|-----------|--------|
| `mixer-constants.js` | Add export defaults (format, bitrate, sample rate) |
| `mixer-audio.js` | Add `buildOfflineGraph(offlineCtx, state, buffers)` method |
| `mixer-state.js` | Expose full state snapshot for offline graph construction |
| `mixer-templates.js` | Export modal HTML (format selector, progress bar, buttons) |
| `mixer-app.js` | Wire export button, manage export lifecycle |
| New: `mixer-export.js` | Export controller (OfflineAudioContext, encoding, download) |
| New: `mixer-encode-worker.js` | Web Worker for MP3/WAV encoding |

---

## Risk Summary

| Risk | Impact | Mitigation |
|------|--------|------------|
| Memory pressure (30+ stems decoded) | Browser crash/OOM | Batch rendering, MediaRecorder fallback, user warning |
| OfflineAudioContext graph mismatch | Wrong output | Share graph-building code between live and offline contexts |
| lamejs LGPL license | Legal | Load dynamically, don't bundle; or use manual encoder |
| Long encode times on mobile | Bad UX | Show progress, consider lower bitrate default on mobile |
| Safari codec gaps | No WebM export | Use MP4/AAC via MediaRecorder on Safari, or WAV/MP3 via offline |

---

## Reference Implementations

| Project | Approach | Notes |
|---------|----------|-------|
| [AudioMass](https://github.com/pkalogiros/AudioMass) | lamejs + manual WAV | Open source, ~65KB, zero deps |
| [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) | Full FFmpeg in WASM | Any format, but ~32MB download, needs SharedArrayBuffer |
| [audio-encoder](https://github.com/cstoquer/audio-encoder) | Unified WAV/MP3 API | Simple AudioBuffer → file |
| [audiobuffer-to-wav](https://github.com/Experience-Monks/audiobuffer-to-wav) | Manual WAV header | ~80 lines, 0 deps |
