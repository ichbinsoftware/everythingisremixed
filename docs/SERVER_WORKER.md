# Server & Worker Documentation

This document details the server-side logic handled by the Cloudflare Worker.

## Core Responsibilities

The worker (`everything-is-remixed-worker.js`) is the single entry point for the application. It handles routing, proxies audio from R2 buckets, and serves the application shell.

### Route Handling

Routes are processed in this order:

1. **CORS Preflight**
   - `OPTIONS *` → Returns CORS headers

2. **Audio Files** (must be before asset handler)
   - `/{trackId}/{filename}.m4a` → `handleStemRequest()`

3. **Peaks JSON** (must be before asset handler)
   - `/*_peaks.json` → Serves pre-generated waveform data

4. **Assets**
   - `/assets/*` → Serves JS, CSS, JSON from ASSETS binding

5. **Application**
   - `/` → Home page (track grid)
   - `/{trackId}` → Track mixer page via `serveApp()`

### Why Route Order Matters

The audio and peaks handlers must come before the generic asset handler because:
- Audio paths like `/hydrogen/kick.m4a` could match `/assets/*` patterns
- Peaks paths like `/hydrogen_peaks.json` need specific handling
- The asset handler uses a simple prefix check (`path.startsWith('/assets/')`)

## Environment Bindings

The worker relies on specific Cloudflare environment bindings:

### 1. ASSETS (Workers Assets binding)
Contains static code and data:
- `app/mixer-app.js` - Client application
- `app/mix-style.css` - Styles
- `app/modules/*.js` - ES6 modules
- `stems.json` - Stem configurations
- `{trackId}_peaks.json` - Pre-generated waveform data

### 2. Track R2 Buckets
One R2 bucket binding per track (uppercase names):
- `HYDROGEN`, `LITHIUM`, `SODIUM`, `POTASSIUM`, `RUBIDIUM`, `CAESIUM`, `FRANCIUM`

Each bucket contains:
- Stem audio files (`.m4a` format)
- Named by stem filename from `stems.json`

## Track Configuration

Tracks are defined in the `TRACKS` object:

```javascript
const TRACKS = {
  'hydrogen': { name: 'Hydrogen', bpm: 132, key: 'D Major', number: 1, symbol: 'H', color: '#25daf0' },
  'lithium':  { name: 'Lithium',  bpm: 124, key: 'G minor', number: 2, symbol: 'Li', color: '#cf2739' },
  'sodium':   { name: 'Sodium',   bpm: 140, key: 'G minor', number: 3, symbol: 'Na', color: '#f7ca47' },
  'potassium':{ name: 'Potassium',bpm: 90,  key: 'C Major', number: 4, symbol: 'K', color: '#8f01ff' },
  'rubidium': { name: 'Rubidium', bpm: 132, key: 'G Major', number: 5, symbol: 'Rb', color: '#c71585' },
  'caesium':  { name: 'Caesium',  bpm: 130, key: 'C Major', number: 6, symbol: 'Cs', color: '#afa0ef' },
  'francium': { name: 'Francium', bpm: 128, key: 'B♭ Major',number: 7, symbol: 'Fr', color: '#c1c1c1' },
};
```

Stem configurations are stored in `stems.json` and loaded at runtime.

## Audio Request Flow

### handleStemRequest()

1. **Validate Track**: Check trackId exists in `TRACKS`
2. **Cache Check**: Look for non-range requests in Cloudflare cache
3. **Get Bucket**: Resolve R2 bucket from `env[trackId.toUpperCase()]`
4. **Parse Range**: Extract byte range from `Range` header if present
5. **Fetch Object**: Get object from R2 with range/etag options
6. **Build Response**: Set appropriate headers and status code
7. **Cache Response**: Store full responses (status 200) in cache

### Range Request Support

Essential for audio seeking:

```javascript
const rangeHeader = request.headers.get('Range');
if (rangeHeader) {
  const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
  if (match) {
    rangeOptions = {
      offset: parseInt(match[1]),
      length: match[2] ? parseInt(match[2]) - parseInt(match[1]) + 1 : undefined
    };
  }
}
```

Range responses return status 206 with `Content-Range` header.

### Caching Strategy

```javascript
const CACHE_MAX_AGE = 31536000;  // 1 year

// Non-range requests are cached using tee() to avoid stream race condition
if (status === 200 && request.method === 'GET') {
  const [stream1, stream2] = object.body.tee();
  responseBody = stream1;
  ctx.waitUntil(cache.put(cacheKey, new Response(stream2, { status, headers: new Headers(headers) })));
}
```

Range requests are not cached to avoid serving partial content for full requests.

### Conditional Requests (304)

The worker properly handles `If-None-Match` conditional requests:

```javascript
const ifNoneMatch = request.headers.get('If-None-Match');
const object = await bucket.get(stemFile, {
  range: rangeOptions,
  onlyIf: ifNoneMatch
    ? { etagDoesNotMatch: ifNoneMatch.replace(/"/g, '') }
    : undefined
});

// Return 304 if ETag matched (object is null but was a conditional request)
if (!object) {
  if (ifNoneMatch) {
    return new Response(null, { status: 304, headers: { 'Access-Control-Allow-Origin': '*' } });
  }
  return new Response('Not Found', { status: 404 });
}
```

This allows browsers to efficiently revalidate cached audio files without re-downloading.

## Asset Serving

### Generic Asset Handler

```javascript
if (path.startsWith('/assets/')) {
  const filename = path.replace('/assets/', '').replace(/^\//, '');
  const flatName = filename.split('/').pop();

  let asset = await fetchAssetSafely(env, filename);
  if (!asset && filename.includes('/')) {
    asset = await fetchAssetSafely(env, flatName);
  }
  // ...
}
```

**Features:**
- Supports nested paths (`/assets/app/modules/mixer-audio.js`)
- Falls back to flat name if nested path fails
- Auto-detects Content-Type from extension

### Content-Type Detection

```javascript
let contentType = 'application/javascript';
if (filename.endsWith('.css')) contentType = 'text/css';
else if (filename.endsWith('.json')) contentType = 'application/json';
```

### Cache Control

```javascript
// Assets: No cache (development)
'Cache-Control': 'no-store'

// Media: 1 year cache
'Cache-Control': `public, max-age=${CACHE_MAX_AGE}`
```

## CORS Configuration

All responses include CORS headers:

```javascript
// Preflight response
{
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Content-Type',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Type, ETag, Accept-Ranges'
}

// Audio/asset responses
{
  'Access-Control-Allow-Origin': '*'
}
```

The `Accept-Ranges` header is essential for audio seeking.

## HTML Application Shell

### serveApp()

Generates the full HTML page with injected configuration:

```javascript
function serveApp(track, trackId, searchParams, allStems) {
  const mixParam = searchParams.get('mix');
  const masterParam = searchParams.get('master');

  const trackConfig = track
    ? JSON.stringify({ id: trackId, name: track.name, bpm: track.bpm, key: track.key, number: track.number })
    : 'null';

  const stems = allStems[trackId] || [];
  const stemConfigJson = JSON.stringify(stems);

  // ... HTML template with injected values
}
```

### Theme Initialization

Theme is set early in `<head>` to prevent flash of wrong theme:

```html
<script>document.documentElement.setAttribute('data-theme', localStorage.getItem('evr-theme') || 'dark');</script>
```

### Injected Globals

```html
<script>
  const TRACK_CONFIG = ${trackConfig};
  const STEM_CONFIG = ${stemConfigJson};
  const INITIAL_MIX_STATE = ${mixParam ? `"${mixParam}"` : 'null'};
  const INITIAL_MASTER_VOLUME = ${masterParam || '80'};
</script>
<script type="module" src="/assets/app/mixer-app.js"></script>
```

### Home Page vs Track Page

**Home Page** (`track = null`):
- Shows track grid with cards for each track
- Status dot shows "STANDBY"
- No start overlay

**Track Page** (`track = {...}`):
- Shows start overlay with "Enter Studio" button
- Status dot shows "ONLINE"
- Mixer panel hidden until initialization

## Track Cards (Swiss Lab Design)

The home page displays a periodic table-inspired grid using the "Swiss Lab" design:

```javascript
const trackCardsHtml = Object.keys(TRACKS).map(k => {
  const t = TRACKS[k];
  const stemCount = (allStems[k] || []).length;
  return `<a href="/${k}" class="track-card" style="--accent: ${t.color};">
    <div class="card-top"><span class="card-num">${String(t.number).padStart(2, '0')}</span><span class="card-ch">${stemCount} CH</span></div>
    <div class="symbol">${t.symbol}</div>
    <div class="card-bottom"><span class="card-name">${t.name.toUpperCase()}</span><span class="card-bpm">${t.bpm}</span></div>
  </a>`;
}).join('') + '<div class="track-card-filler"></div>';
```

Each card shows:
- Track number (top-left, zero-padded)
- Channel count (top-right)
- Element symbol (large, centered) - changes to track color on hover
- Track name (bottom-left, uppercase)
- BPM (bottom-right)

**Grid Layout:**
- 4 columns with 2px gaps
- Dark mode: dark cards (#111) with white gaps
- Light mode: light cards (#f0f0f0) with black gaps
- 8th cell is a filler (matches background)

## Error Handling

### fetchAssetSafely()

Wraps asset fetches with error handling:

```javascript
async function fetchAssetSafely(env, filename) {
  if (!env.ASSETS) return null;
  try {
    const obj = await env.ASSETS.get(filename);
    if (!obj) return null;
    if (typeof obj === 'string') return obj;
    if (obj.text) return await obj.text();
    return obj;
  } catch (e) {
    return null;
  }
}
```

### Audio Request Errors

```javascript
if (!TRACKS[trackId]) return new Response('Track not found', { status: 404 });
if (!bucket) return new Response('Bucket Config Error', { status: 500 });
if (!object) return new Response('Not Found', { status: 404 });
```

Stream errors return status 500 with "Stream Error" message.

## Cloudflare Configuration

The worker requires these environment bindings:

| Binding | Type | Description |
|---------|------|-------------|
| `ASSETS` | Workers Assets | Static files (JS, CSS, JSON) |
| `HYDROGEN` | R2 Bucket | Hydrogen track stems |
| `LITHIUM` | R2 Bucket | Lithium track stems |
| `SODIUM` | R2 Bucket | Sodium track stems |
| `POTASSIUM` | R2 Bucket | Potassium track stems |
| `RUBIDIUM` | R2 Bucket | Rubidium track stems |
| `CAESIUM` | R2 Bucket | Caesium track stems |
| `FRANCIUM` | R2 Bucket | Francium track stems |
