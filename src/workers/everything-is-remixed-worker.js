// ==========================================
// Cloudflare Worker: Stem Mixer
// Version: 2.0 | Modular Architecture
// ==========================================

const TRACKS = {
  'hydrogen': { name: 'Hydrogen', bpm: 132, key: 'D Major', number: 1, symbol: 'H', color: '#25daf0' },
  'lithium': { name: 'Lithium', bpm: 124, key: 'G minor', number: 2, symbol: 'Li', color: '#cf2739' },
  'sodium': { name: 'Sodium', bpm: 140, key: 'G minor', number: 3, symbol: 'Na', color: '#f7ca47' },
  'potassium': { name: 'Potassium', bpm: 90, key: 'C Major', number: 4, symbol: 'K', color: '#8f01ff' },
  'rubidium': { name: 'Rubidium', bpm: 132, key: 'G Major', number: 5, symbol: 'Rb', color: '#c71585' },
  'caesium': { name: 'Caesium', bpm: 130, key: 'C Major', number: 6, symbol: 'Cs', color: '#afa0ef' },
  'francium': { name: 'Francium', bpm: 128, key: 'B♭ Major', number: 7, symbol: 'Fr', color: '#c1c1c1' },
};

const CACHE_MAX_AGE = 31536000;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Range, Content-Type',
          'Access-Control-Max-Age': '86400',
          'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Type, ETag, Accept-Ranges'
        }
      });
    }

    // 1. AUDIO FILES (must be before asset handler)
    const pathParts = path.split('/').filter(p => p);
    if (pathParts.length === 2 && pathParts[1].endsWith('.m4a')) {
      return handleStemRequest(decodeURIComponent(pathParts[0]), decodeURIComponent(pathParts[1]), request, env, ctx);
    }

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

    // 3. ASSET HANDLER (JS, CSS, JSON, Modules)
    if (path.startsWith('/assets/')) {
      const filename = path.replace('/assets/', '').replace(/^\//, '');
      const flatName = filename.split('/').pop();

      let asset = await fetchAssetSafely(env, filename);
      if (!asset && filename.includes('/')) {
        asset = await fetchAssetSafely(env, flatName);
      }

      if (asset) {
        let contentType = 'application/javascript';
        if (filename.endsWith('.css')) contentType = 'text/css';
        else if (filename.endsWith('.json')) contentType = 'application/json';

        return new Response(asset, {
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

      return new Response('Asset Not Found', { status: 404 });
    }

    // 4. SERVE APP
    const trackId = pathParts[0] || '';
    const track = TRACKS[trackId] || null;

    let allStems = {};
    try {
      const stemsRaw = await fetchAssetSafely(env, 'stems.json');
      if (stemsRaw && (stemsRaw.trim().startsWith('{') || stemsRaw.trim().startsWith('['))) {
        allStems = JSON.parse(stemsRaw);
      }
    } catch (e) {
      console.error('Asset Fetch Error', e);
    }

    return serveApp(track, trackId, url.searchParams, allStems);
  },
};

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

async function handleStemRequest(trackId, stemFile, request, env, ctx) {
  if (!TRACKS[trackId]) return new Response('Track not found', { status: 404 });

  const cache = caches.default;
  const cacheKey = new Request(request.url, request);
  const isRange = request.headers.has('Range');

  if (!isRange) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const h = new Headers(cached.headers);
      h.set('Access-Control-Allow-Origin', '*');
      h.set('Access-Control-Expose-Headers', 'Content-Length, Content-Type, ETag');
      return new Response(cached.body, { status: cached.status, headers: h });
    }
  }

  const bucket = env[trackId.toUpperCase()];
  if (!bucket) return new Response('Bucket Config Error', { status: 500 });

  try {
    const rangeHeader = request.headers.get('Range');
    let rangeOptions = undefined;
    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        rangeOptions = {
          offset: parseInt(match[1]),
          length: match[2] ? parseInt(match[2]) - parseInt(match[1]) + 1 : undefined
        };
      }
    }

    const ifNoneMatch = request.headers.get('If-None-Match');
    const object = await bucket.get(stemFile, {
      range: rangeOptions,
      onlyIf: ifNoneMatch
        ? { etagDoesNotMatch: ifNoneMatch.replace(/"/g, '') }
        : undefined
    });

    // Handle conditional request: return 304 if ETag matched (object is null but was a conditional request)
    if (!object) {
      if (ifNoneMatch) {
        return new Response(null, {
          status: 304,
          headers: { 'Access-Control-Allow-Origin': '*' }
        });
      }
      return new Response('Not Found', { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cache-Control', `public, max-age=${CACHE_MAX_AGE}`);
    headers.set('Accept-Ranges', 'bytes');
    if (stemFile.endsWith('.m4a')) headers.set('Content-Type', 'audio/mp4');

    let status = 200;
    if (rangeOptions && object.range) {
      status = 206;
      headers.set('Content-Range', `bytes ${object.range.offset}-${object.range.offset + object.size - 1}/${object.size}`);
      headers.set('Content-Length', object.size.toString());
    } else {
      headers.set('Content-Length', object.size.toString());
    }

    // Fix: Use tee() to split stream for response and cache to avoid race condition
    let responseBody = object.body;
    if (status === 200 && request.method === 'GET') {
      const [stream1, stream2] = object.body.tee();
      responseBody = stream1;
      ctx.waitUntil(cache.put(cacheKey, new Response(stream2, { status, headers: new Headers(headers) })));
    }
    return new Response(responseBody, { status, headers });
  } catch (e) {
    return new Response('Stream Error', { status: 500 });
  }
}

function serveApp(track, trackId, searchParams, allStems) {
  const mixParam = searchParams.get('mix');
  const masterParam = searchParams.get('master');
  const trackConfig = track
    ? JSON.stringify({ id: trackId, name: track.name, bpm: track.bpm, key: track.key, number: track.number, color: track.color })
    : 'null';
  const stems = allStems[trackId] || [];
  const stemConfigJson = JSON.stringify(stems);

  const trackCardsHtml = Object.keys(TRACKS).map(k => {
    const t = TRACKS[k];
    const stemCount = (allStems[k] || []).length;
    return `<a href="/${k}" class="track-card" style="--accent: ${t.color};">
      <div class="card-top"><span class="card-num">${String(t.number).padStart(2, '0')}</span><span class="card-ch">${stemCount} CH</span></div>
      <div class="symbol">${t.symbol}</div>
      <div class="card-bottom"><span class="card-name">${t.name.toUpperCase()}</span><span class="card-bpm">${t.bpm}</span></div>
    </a>`;
  }).join('') + '<div class="track-card-filler"></div>';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${track ? track.name + ' - ' : ''}EVR</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/assets/app/mix-style.css">
  <style>
    :root { --track-color: ${track ? track.color : '#fff'}; }
  </style>
  <script>document.documentElement.setAttribute('data-theme', localStorage.getItem('evr-theme') || 'dark');</script>
</head>
<body>
  <div class="container">
    <header class="mixer-header">
      <div>
        <span class="status-dot"></span>${track ? 'ONLINE' : 'STANDBY'}
        <button id="themeToggle" class="theme-toggle" aria-label="Toggle theme">
          <svg class="sun-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
            <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
          </svg>
          <svg class="moon-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
          </svg>
        </button>
      </div>
      <div>${track ? track.name : ''}</div>
      <div>
        ${track ? track.bpm + ' BPM' : 'EVR'}
        ${track ? '<button id="helpBtn" class="help-btn" aria-label="Help">?</button>' : ''}
      </div>
    </header>

    ${track ? `
    <div id="startOverlay" class="start-overlay" style="--track-color: ${track.color};">
      <div class="start-overlay-symbol" style="color: ${track.color};">${track.symbol}</div>
      <div class="start-overlay-content">
        <p class="start-overlay-label">READY TO MIX</p>
        <h2 class="start-overlay-title" style="color: ${track.color};">${track.name}</h2>
        <button id="startMixBtn" class="start-overlay-btn">ENTER STUDIO</button>
        <p class="start-overlay-hint">Tap to initialize Audio Engine</p>
      </div>
    </div>
    ` : `
    <div class="track-list-container">
      <div class="track-grid">${trackCardsHtml}</div>
      <footer>
        <p><strong>Everything is Free</strong> · CC0 1.0 Universal · Zero Restrictions</p>
        <p class="footer-links">
          <a href="https://github.com/ichbinsoftware/everythingisfree" target="_blank" rel="noopener noreferrer">GitHub</a>
          &nbsp;·&nbsp;
          <a href="https://software-entwicklungskit.bandcamp.com" target="_blank" rel="noopener noreferrer">Bandcamp</a>
        </p>
      </footer>
    </div>
    `}

    ${track ? `<div class="loading" id="loadingIndicator" style="display:none;"><div class="loading-spinner"></div><p>Loading stems...</p><div style="width:200px;height:4px;background:#333;border-radius:2px;margin:12px auto;overflow:hidden;"><div id="loadingBar" style="width:0%;height:100%;background:var(--track-color);transition:width 0.1s linear;"></div></div></div>` : ''}

    <div class="mixer-panel" id="mixerPanel" style="--track-color: ${track ? track.color : '#4ecdc4'}; display: none;">
      <div class="master-waveform"><canvas id="masterWaveform"></canvas></div>
      <div class="progress-container">
        <span id="currentTime" class="time-start">0:00</span>
        <div class="progress-bar" id="progressBar"><div class="progress-fill" id="progressFill"><div class="progress-handle"></div></div></div>
        <span id="duration" class="time-end">0:00</span>
      </div>
      <div class="channels-container" id="channelsContainer"></div>

      <div class="transport">
        <button class="transport-btn" id="restartBtn" title="Restart">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
        </button>
        <button class="transport-btn" id="skipBackBtn" title="Back 10s">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/></svg>
        </button>
        <button class="transport-btn play" id="playBtn" title="Play">
          <svg viewBox="0 0 24 24" fill="currentColor" id="playIcon"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <button class="transport-btn" id="skipFwdBtn" title="Fwd 10s">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/></svg>
        </button>
        <button class="transport-btn" id="stopBtn" title="Stop">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h12v12H6z"/></svg>
        </button>
      </div>
    </div>

    <div class="actions" id="actionsSection" style="display: none;">
      <button id="backBtn"><</button>
      <button id="resetBtn">RESET</button>
      <button id="shareBtn">SHARE</button>
    </div>
    <div class="share-section" id="shareSection" style="display: none;"><textarea class="share-url" id="shareUrl" readonly></textarea></div>
    ${track ? `<footer id="mixerFooter" style="display: none;">
      <p><strong>Everything is Free</strong> · CC0 1.0 Universal · Zero Restrictions</p>
      <p class="footer-links">
        <a href="https://github.com/ichbinsoftware/everythingisfree" target="_blank" rel="noopener noreferrer">GitHub</a>
        &nbsp;·&nbsp;
        <a href="https://software-entwicklungskit.bandcamp.com/album/everything-is-free" target="_blank" rel="noopener noreferrer">Bandcamp</a>
      </p>
    </footer>` : ''}
  </div>

  <script>
    const TRACK_CONFIG = ${trackConfig};
    const STEM_CONFIG = ${stemConfigJson};
    const INITIAL_MIX_STATE = ${mixParam ? `"${mixParam}"` : 'null'};
    const INITIAL_MASTER_VOLUME = ${masterParam || '80'};
  </script>
  <script type="module" src="/assets/app/mixer-app.js"></script>
</body>
</html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
}
