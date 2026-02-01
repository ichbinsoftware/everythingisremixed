# Peak Generator Tool

The Peak Generator is a browser-based tool that pre-generates waveform peak data for the stem mixer, eliminating audio decoding on initial page load.

## Purpose

Without pre-generated peaks, the mixer must:
1. Fetch each stem's audio file
2. Decode the entire audio to an AudioBuffer
3. Extract min/max peaks for visualization
4. Store large AudioBuffers in memory

With pre-generated peaks:
1. Fetch a small JSON file (~2.2 KB per stem)
2. Immediately render waveforms from peak data
3. No audio decoding until playback starts
4. Minimal memory footprint

## Files & Output

### Tool Location

| File | Description |
|------|-------------|
| `src/peak-generator.html` | Browser-based peak generation tool |

### Output Files

| File | Description |
|------|-------------|
| `src/workers/hydrogen_peaks.json` | Hydrogen track peaks |
| `src/workers/lithium_peaks.json` | Lithium track peaks |
| `src/workers/sodium_peaks.json` | Sodium track peaks |
| `src/workers/potassium_peaks.json` | Potassium track peaks |
| `src/workers/rubidium_peaks.json` | Rubidium track peaks |
| `src/workers/caesium_peaks.json` | Caesium track peaks |
| `src/workers/francium_peaks.json` | Francium track peaks |

### Source Configuration

| File | Description |
|------|-------------|
| `src/workers/stems.json` | Stem filenames used by the generator |

## Usage

### Step-by-Step Process

1. **Start a local server** (required for CORS):
   ```bash
   cd /path/to/evr/src
   python3 -m http.server 8000
   ```

2. **Open the tool**:
   ```
   http://localhost:8000/peak-generator.html
   ```

3. **Generate peaks for each track**:
   - The tool displays all tracks from `stems.json`
   - Click "Generate JSON" for each track
   - Wait for processing (progress shown per stem)
   - JSON file downloads automatically

4. **Move generated files**:
   ```bash
   mv ~/Downloads/*_peaks.json src/workers/
   ```

## Technical Details

### Peak Data Format

Each peaks file contains an object mapping stem indices to peak arrays:

```json
{
  "0": [
    { "min": -0.4523, "max": 0.5234 },
    { "min": -0.3812, "max": 0.4156 },
    ...
  ],
  "1": [ ... ],
  "2": [ ... ]
}
```

**Structure:**
- Keys: Stem index (0-based, as string)
- Values: Array of 140 peak objects
- Each peak: `{ min: number, max: number }` (4 decimal places)

### Peak Extraction Algorithm

```javascript
function extractPeaks(audioBuffer) {
  const WAVEFORM_WIDTH = 140;
  const data = audioBuffer.getChannelData(0);  // First channel only
  const step = Math.ceil(data.length / WAVEFORM_WIDTH);
  const peaks = [];

  for (let i = 0; i < WAVEFORM_WIDTH; i++) {
    let min = 1, max = -1;
    for (let j = 0; j < step; j++) {
      const idx = (i * step) + j;
      if (idx < data.length) {
        const v = data[idx];
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    // Handle silence
    if (min > max) { min = 0; max = 0; }
    // Round to 4 decimals
    peaks.push({
      min: parseFloat(min.toFixed(4)),
      max: parseFloat(max.toFixed(4))
    });
  }
  return peaks;
}
```

**Key aspects:**
- Uses only first audio channel (mono representation)
- Divides audio into 140 segments (matches `WAVEFORM_WIDTH`)
- Finds min/max amplitude in each segment
- Rounds to 4 decimal places to reduce file size

### Audio Fetching

The tool fetches audio from production URLs:

```javascript
const url = `https://${trackId}.ichbinsoftware.com/${trackId}/${encodeURIComponent(stem.filename)}`;
```

This ensures:
- Access to all stem audio files
- No local file path issues
- Consistent with production data

## Waveform Rendering

### From Peaks (Fast Path)

```javascript
_drawWaveform(ctx, peaks, color) {
  const amplitude = WAVEFORM_HEIGHT / 2;
  ctx.clearRect(0, 0, WAVEFORM_WIDTH, WAVEFORM_HEIGHT);
  ctx.fillStyle = color;

  for (let i = 0; i < peaks.length; i++) {
    const peak = peaks[i];
    ctx.fillRect(
      i,                                    // x position
      (1 + peak.min) * amplitude,           // y position
      1,                                    // width (1 pixel)
      Math.max(1, (peak.max - peak.min) * amplitude)  // height
    );
  }
}
```

### From Audio (Fallback)

If peaks JSON is unavailable:

```javascript
async drawWaveformFromBlob(index, blob, color, audioContext) {
  const arrayBuffer = await blob.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  const peaks = this.extractPeaks(audioBuffer);
  this.waveformCache[index] = peaks;
  this._drawWaveform(ctx, peaks, color);
}
```

## File Sizes

Typical file sizes for generated peaks:

| Track | Stems | Approx Size |
|-------|-------|-------------|
| Hydrogen | 12 | ~27 KB |
| Lithium | 38 | ~84 KB |
| Sodium | 28 | ~62 KB |
| Potassium | 19 | ~42 KB |
| Rubidium | 9 | ~20 KB |
| Caesium | 16 | ~35 KB |
| Francium | 26 | ~57 KB |

**Total: ~327 KB** for all 7 tracks

Compare to full AudioBuffer caching:
- ~4-8 MB per stem (depending on duration)
- ~570 MB total for all stems

## Tool UI

The Peak Generator displays:

```
╔══════════════════════════════════════════╗
║  Waveform Peak Generator                 ║
╠══════════════════════════════════════════╣
║  HYDROGEN                                ║
║  12 Stems                                ║
║  Ready to generate      [Generate JSON]  ║
╠══════════════════════════════════════════╣
║  LITHIUM                                 ║
║  38 Stems                                ║
║  Ready to generate      [Generate JSON]  ║
╠══════════════════════════════════════════╣
║  ...                                     ║
╚══════════════════════════════════════════╝
```

Progress updates during generation:
```
Processing stem 15/38: SY PAD...
```

## Troubleshooting

### CORS Errors

**Problem:** Cross-origin request blocked

**Solution:** Must run via local server, not `file://` protocol
```bash
python3 -m http.server 8000
# Then open http://localhost:8000/peak-generator.html
```

### Fetch Failed

**Problem:** Network error fetching audio

**Possible causes:**
- Audio file doesn't exist in R2 bucket
- Stem filename mismatch in `stems.json`
- Network connectivity issues

**Solution:** Verify stem exists:
```bash
curl -I "https://hydrogen.ichbinsoftware.com/hydrogen/1-Kick.m4a"
```

### AudioContext Errors

**Problem:** Audio decoding fails

**Possible causes:**
- Corrupted audio file
- Unsupported format
- Browser compatibility

**Solution:** Try different browser (Chrome recommended)

### Large File Downloads

**Problem:** JSON file very large

**Possible causes:**
- Too many decimal places
- Duplicate data

**Solution:** Check `toFixed(4)` is being applied in `extractPeaks()`

## Integration with Mixer

### Loading Peaks

In `mixer-app.js`:

```javascript
async function loadWaveformPeaks() {
  try {
    const response = await fetch(`/${TRACK_CONFIG.id}_peaks.json`);
    if (response.ok) {
      const peaks = await response.json();
      uiBuilder.setWaveformCache(peaks);
      return true;
    }
  } catch (e) {
    console.warn('Peaks not available, will decode on demand');
  }
  return false;
}
```

### Worker Serving

The worker serves peaks files:

```javascript
// 2. PEAKS JSON (must be before asset handler)
if (path.endsWith('_peaks.json')) {
  const filename = path.split('/').pop();
  const json = await fetchAssetSafely(env, filename);
  if (json) {
    return new Response(json, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=31536000',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}
```

## Regenerating Peaks

To regenerate peaks for a track:

1. Open Peak Generator tool
2. Regenerate affected track(s)
3. Replace old peaks file in `src/workers/`
4. Deploy to Cloudflare

```bash
# Full regeneration workflow
cd src
python3 -m http.server 8000 &
open http://localhost:8000/peak-generator.html
# Generate all tracks, download files
mv ~/Downloads/*_peaks.json workers/
```
