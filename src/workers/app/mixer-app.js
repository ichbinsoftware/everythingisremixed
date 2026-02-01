// ==========================================
// Mixer App - Main Orchestrator
// Version: 2.0 | Modular Architecture
// ==========================================

import { BATCH_SIZE } from './modules/mixer-constants.js';
import { AudioEngine } from './modules/mixer-audio.js';
import { MixerState } from './modules/mixer-state.js';
import { UIBuilder } from './modules/mixer-ui.js';
import { FXController } from './modules/mixer-fx.js';
import { TransportController } from './modules/mixer-transport.js';
import { StemLoader } from './modules/mixer-loader.js';
import { Holograph } from './modules/mixer-visualizer.js';
import { AnimationManager } from './modules/mixer-loop.js';
import { HelpController } from './modules/mixer-help.js';

// Device detection
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  || navigator.maxTouchPoints > 1;

// Core instances
let audioEngine = null;
let mixerState = null;
let uiBuilder = null;
let fxController = null;
let transport = null;
let holograph = null;
let loop = null;
let helpController = null;

// Players and meters
let players = {};
let meters = {};

// Master waveform
let cachedColors = null;

// Pre-allocated buffers (avoid GC pressure in animation loop)
let masterWaveformBuffer = null;
let meterBuffers = {};
let masterMeterBuffer = null;

// ==========================================
// Theme Logic
// ==========================================
const themeToggle = document.getElementById('themeToggle');
if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const newTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('evr-theme', newTheme);
    if (holograph) holograph.setTheme(newTheme === 'light');
  });
}
document.documentElement.setAttribute('data-theme', localStorage.getItem('evr-theme') || 'dark');

// ==========================================
// DOM Elements
// ==========================================
const elements = {
  mixerPanel: document.getElementById('mixerPanel'),
  channelsContainer: document.getElementById('channelsContainer'),
  playBtn: document.getElementById('playBtn'),
  playIcon: document.getElementById('playIcon'),
  stopBtn: document.getElementById('stopBtn'),
  restartBtn: document.getElementById('restartBtn'),
  skipBackBtn: document.getElementById('skipBackBtn'),
  skipFwdBtn: document.getElementById('skipFwdBtn'),
  progressBar: document.getElementById('progressBar'),
  progressFill: document.getElementById('progressFill'),
  currentTimeEl: document.getElementById('currentTime'),
  durationEl: document.getElementById('duration'),
  masterWaveformCanvas: document.getElementById('masterWaveform'),
  actionsSection: document.getElementById('actionsSection'),
  shareSection: document.getElementById('shareSection'),
  shareUrl: document.getElementById('shareUrl'),
  shareBtn: document.getElementById('shareBtn'),
  resetBtn: document.getElementById('resetBtn'),
  backBtn: document.getElementById('backBtn'),
  loadingIndicator: document.getElementById('loadingIndicator'),
  startOverlay: document.getElementById('startOverlay'),
  startMixBtn: document.getElementById('startMixBtn'),
  mixerFooter: document.getElementById('mixerFooter')
};

// ==========================================
// Browser Support Check
// ==========================================
function checkBrowserSupport() {
  const missing = [];

  // Check Web Audio API
  if (!(window.AudioContext || window.webkitAudioContext)) {
    missing.push('Web Audio API');
  }

  // Check OffscreenCanvas
  if (typeof OffscreenCanvas === 'undefined') {
    missing.push('OffscreenCanvas');
  }

  return missing;
}

function showUnsupportedBrowser(missing) {
  const backdrop = document.getElementById('unsupportedBackdrop');
  const missingEl = document.getElementById('unsupportedMissing');

  if (missingEl && missing.length) {
    missingEl.textContent = 'Missing: ' + missing.join(', ');
  }

  if (backdrop) {
    backdrop.classList.add('active');
  }
}

// Back button handler for unsupported browser overlay
const unsupportedBackBtn = document.getElementById('unsupportedBack');
if (unsupportedBackBtn) {
  unsupportedBackBtn.addEventListener('click', () => {
    window.location.href = '/';
  });
}

// ==========================================
// Main Initialization
// ==========================================
async function initMixer() {
  // 1. Initialize audio engine
  audioEngine = new AudioEngine(isMobile);
  await audioEngine.init();

  // 2. Initialize state
  mixerState = new MixerState(STEM_CONFIG);
  mixerState.masterVolume = INITIAL_MASTER_VOLUME / 100;

  // 3. Initialize UI builder
  uiBuilder = new UIBuilder(elements.channelsContainer, mixerState);

  // 4. Initialize FX controller
  fxController = new FXController(mixerState, audioEngine, updateShare);

  // 5. Initialize transport
  transport = new TransportController(audioEngine);
  transport.onStateChange = handleTransportStateChange;

  // 5.1 Initialize loop manager
  initAnimationLoop();

  // 6. Load stems
  await loadStems();

  // 7. Apply initial mix state if provided
  if (INITIAL_MIX_STATE) {
    mixerState.applyFromUrl(INITIAL_MIX_STATE);
    fxController.applyAll(players);
  }

  // 8. Build UI
  buildUI();

  // 9. Apply mix state to audio (mute/solo/volume from URL or defaults)
  updateMix();

  // 10. Show mixer (must be before setupMasterWaveform so canvas has dimensions)
  elements.mixerPanel.style.display = 'block';
  elements.actionsSection.style.display = 'flex';
  elements.shareSection.style.display = 'block';
  if (elements.mixerFooter) elements.mixerFooter.style.display = 'block';

  // 11. Setup master visualizer (wait for layout paint)
  requestAnimationFrame(() => {
    if (elements.masterWaveformCanvas && audioEngine.holographAnalyser) {
        holograph = new Holograph(
          elements.masterWaveformCanvas, 
          audioEngine.holographAnalyser,
          TRACK_CONFIG ? TRACK_CONFIG.color : null
        );
    }
  });

  // 12. Pre-allocate audio buffers (avoid GC in animation loop)
  initBuffers();

  // 13. Set duration display
  uiBuilder.setDuration(transport.duration);

  // 14. Initialize help system
  helpController = new HelpController();
  helpController.init();
}

// ==========================================
// Stem Loading
// ==========================================
async function loadStems() {
  if (!TRACK_CONFIG || !STEM_CONFIG.length) return;

  const loadEl = elements.loadingIndicator;
  const loadBar = document.getElementById('loadingBar');
  const loadText = loadEl?.querySelector('p');

  if (loadEl) loadEl.style.display = 'block';

  // Try to load pre-generated peaks
  try {
    const response = await fetch('/' + TRACK_CONFIG.id + '_peaks.json');
    if (response.ok) {
      const data = await response.json();
      uiBuilder.setWaveformCache(data);
    }
  } catch (e) {
    console.log('No peaks file found, falling back to decode');
  }

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 KB';
    const mb = bytes / (1024 * 1024);
    if (mb < 1) {
      const kb = bytes / 1024;
      return kb.toFixed(1) + ' KB';
    }
    return mb.toFixed(1) + ' MB';
  };

  const loader = new StemLoader(audioEngine, mixerState, isMobile);

  const { players: loadedPlayers, meters: loadedMeters } = await loader.loadStems(
    STEM_CONFIG,
    TRACK_CONFIG,
    {
      onProgress: ({ stemName, receivedBytes, stemSize, totalDownloaded, totalSize }) => {
        if (loadEl && loadText) {
          const stemProgress = stemSize > 0 ? Math.round((receivedBytes / stemSize) * 100) : 0;
          loadText.textContent =
            `Downloading ${stemName}: ${stemProgress}% (${formatBytes(totalDownloaded)} / ${formatBytes(totalSize)})`;

          if (loadBar && totalSize > 0) {
            loadBar.style.width = ((totalDownloaded / totalSize) * 100) + '%';
          }
        }
      }
    }
  );

  players = loadedPlayers;
  meters = loadedMeters;

  if (loadEl) loadEl.style.display = 'none';

  // Set players in transport
  transport.setPlayers(players);
}

// ==========================================
// UI Building
// ==========================================
function buildUI() {
  const callbacks = {
    onFader: handleFaderChange,
    onMute: handleMute,
    onSolo: handleSolo,
    onPan: handlePan,
    onFXToggle: handleFXToggle,
    onMasterFader: handleMasterFaderChange
  };

  uiBuilder.buildChannels(players, callbacks);

  // Setup FX modal (once, reused for all stems)
  fxController.setPlayers(players);
  fxController.initModal();

  // Draw waveforms
  drawAllWaveforms();
}

async function drawAllWaveforms() {
  for (const [index, player] of Object.entries(players)) {
    if (uiBuilder.waveformCache[index]) {
      uiBuilder.drawWaveformFromCache(index, player.color);
    } else if (player.blob) {
      await uiBuilder.drawWaveformFromBlob(index, player.blob, player.color, audioEngine.context);
    }
    await new Promise(r => setTimeout(r, 50));
  }

  // Release blobs after waveforms are drawn (frees memory early)
  releaseBlobs();
}

function releaseBlobs() {
  Object.values(players).forEach(p => {
    // Release blob reference - waveforms are now cached
    // Note: Keep blobUrl alive - audio element still needs it for seeking/buffering
    if (p.blob) {
      p.blob = null;
    }
  });
}

function revokeBlobUrls() {
  // Only revoke blob URLs on page unload - audio elements need them until then
  Object.values(players).forEach(p => {
    if (p.blobUrl) {
      URL.revokeObjectURL(p.blobUrl);
      p.blobUrl = null;
    }
  });
}

// ==========================================
// Event Handlers
// ==========================================
function handleFaderChange(index, value) {
  mixerState.updateStemVolume(index, value);
  updateMix();
}

function handleMute(index) {
  mixerState.toggleMute(index);
  updateMix();
}

function handleSolo(index) {
  mixerState.toggleSolo(index);
  updateMix();
}

function handlePan(index, value) {
  mixerState.updateFX(index, 'pan', null, value);
  const player = players[index];
  if (player && player.effects.panner) {
    player.effects.panner.pan.setTargetAtTime(value, audioEngine.currentTime, 0.01);
  }
  updateShare();
}

function handleFXToggle(index) {
  fxController.togglePanel(index);
}

function handleMasterFaderChange(value) {
  mixerState.masterVolume = value;
  audioEngine.setMasterVolume(value);
  updateShare();
}

function handleTransportStateChange(state) {
  updatePlayButton();

  if (state === 'playing') {
    loop.start();
  } else if (state === 'stopped' || state === 'paused') {
    // We keep the loop running for meters to fall to zero naturally, 
    // but the manager handles conditional tasks (holograph/sync) automatically.
    // If stopped, we can stop the whole loop after a short delay or just let it idle.
    if (state === 'stopped') {
        loop.stop();
        // Force one last UI update to reset meters/progress
        updateMeters();
        updateProgress();
    }
  }
}

// ==========================================
// Mix Updates
// ==========================================
function updateMix() {
  const hasSolo = mixerState.hasSolo();

  Object.entries(players).forEach(([index, player]) => {
    const stemState = mixerState.getStem(index);
    const isActive = mixerState.isStemActive(index, hasSolo);

    player.gainNode.gain.setTargetAtTime(
      isActive ? stemState.volume : 0,
      audioEngine.currentTime,
      0.05
    );

    uiBuilder.updateChannelState(index, isActive, stemState.muted, stemState.solo);
  });

  updateShare();
}

function updateShare() {
  if (elements.shareUrl) {
    elements.shareUrl.value = mixerState.toShareUrl(location.origin + location.pathname);
  }
}

function resetMix() {
  mixerState.reset();

  Object.entries(players).forEach(([index, player]) => {
    fxController.resetNode(index, player);
  });

  audioEngine.setMasterVolume(mixerState.masterVolume);

  // Rebuild UI
  buildUI();
  updateShare();
}

// ==========================================
// Master Waveform
// ==========================================
function initBuffers() {
  // Pre-allocate meter buffers
  Object.entries(meters).forEach(([index, meter]) => {
    meterBuffers[index] = new Float32Array(meter.frequencyBinCount);
  });

  if (audioEngine?.masterMeter) {
    masterMeterBuffer = new Float32Array(audioEngine.masterMeter.frequencyBinCount);
  }
}

// ==========================================
// Animation Loop
// ==========================================
function initAnimationLoop() {
  loop = new AnimationManager();

  // Progress update (10 FPS is enough for the progress bar)
  loop.add('progress', () => updateProgress(), 10);

  // Meters (30 FPS for smooth levels)
  loop.add('meters', () => updateMeters(), 30);

  // Holograph (30 FPS, only while playing)
  loop.add('holograph', () => {
    if (holograph) holograph.update();
  }, 30, () => transport.isPlaying);

  // Sync check (1Hz, only while playing and not on mobile)
  if (!isMobile) {
    loop.add('sync', () => transport.syncCheck(), 1, () => transport.isPlaying);
  }
}

function updateProgress() {
  const currentTime = transport.getCurrentTime();
  const duration = transport.duration;

  if (elements.progressFill && duration > 0) {
    elements.progressFill.style.width = `${(currentTime / duration) * 100}%`;
  }

  if (elements.currentTimeEl) {
    elements.currentTimeEl.textContent = transport.formatTime(currentTime);
  }
}

let meterUpdateFrame = 0;

// Meter Update Strategy:
// - Called at 30fps via AnimationManager
// - Time Slicing: Even-indexed meters update on even frames, odd on odd frames
//   This halves the work per frame (30fps loop → 15fps effective per meter)
//   Reduces CPU load while maintaining smooth visual appearance
// - Virtualization: Skip meters for channels scrolled out of view
// - Dirty checking: UIBuilder skips DOM updates if value unchanged
function updateMeters() {
  meterUpdateFrame++;
  const frameParity = meterUpdateFrame % 2;
  const hasSolo = mixerState.hasSolo();

  Object.entries(meters).forEach(([index, meter]) => {
    // Virtualization: Skip invisible channels
    if (uiBuilder.isChannelVisible && !uiBuilder.isChannelVisible(index)) return;

    // Time Slicing: Update only half the meters per frame
    if (parseInt(index) % 2 !== frameParity) return;

    if (!mixerState.isStemActive(index, hasSolo)) {
      uiBuilder.updateMeter(index, 0);
      uiBuilder.setChannelSignal(index, false);
      return;
    }

    const buffer = meterBuffers[index];
    if (!buffer) return;
    meter.getFloatTimeDomainData(buffer);

    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      sum += buffer[i] * buffer[i];
    }

    const rms = Math.sqrt(sum / buffer.length);
    const db = 20 * Math.log10(rms + 0.0001);
    const normalized = Math.max(0, Math.min(1, (db + 60) / 60));

    uiBuilder.updateMeter(index, normalized);
    uiBuilder.setChannelSignal(index, normalized > 0.05);
  });

  // Master meter
  if (audioEngine.masterMeter && masterMeterBuffer) {
    audioEngine.masterMeter.getFloatTimeDomainData(masterMeterBuffer);

    let masterSum = 0;
    for (let i = 0; i < masterMeterBuffer.length; i++) {
      masterSum += masterMeterBuffer[i] * masterMeterBuffer[i];
    }

    const masterRms = Math.sqrt(masterSum / masterMeterBuffer.length);
    const masterDb = 20 * Math.log10(masterRms + 0.0001);
    const masterNormalized = Math.max(0, Math.min(1, (masterDb + 60) / 60));

    uiBuilder.updateMasterMeter(masterNormalized);
  }
}

// ==========================================
// Play Button
// ==========================================
function updatePlayButton() {
  if (elements.playIcon) {
    elements.playIcon.innerHTML = transport.isPlaying
      ? '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>'  // Pause
      : '<path d="M8 5v14l11-7z"/>';                    // Play
  }
}

// ==========================================
// Cleanup
// ==========================================
function cleanup() {
  // Release any remaining blobs (usually already released after waveforms)
  releaseBlobs();

  // Revoke blob URLs (only safe to do on page unload)
  revokeBlobUrls();

  // Dispose UI (removes event listeners)
  if (uiBuilder) {
    uiBuilder.dispose();
  }
}

// ==========================================
// Event Bindings
// ==========================================

// Transport buttons
if (elements.playBtn) {
  elements.playBtn.addEventListener('click', () => {
    transport.isPlaying ? transport.pause() : transport.play();
  });
}

if (elements.stopBtn) {
  elements.stopBtn.addEventListener('click', () => transport.stop());
}

if (elements.restartBtn) {
  elements.restartBtn.addEventListener('click', () => transport.restart());
}

if (elements.skipBackBtn) {
  elements.skipBackBtn.addEventListener('click', () => transport.skipBack(10));
}

if (elements.skipFwdBtn) {
  elements.skipFwdBtn.addEventListener('click', () => transport.skipForward(10));
}

// Progress bar (display only, no seeking)

// Action buttons
if (elements.backBtn) {
  elements.backBtn.addEventListener('click', () => {
    window.location.href = '/';
  });
}

if (elements.resetBtn) {
  elements.resetBtn.addEventListener('click', resetMix);
}

if (elements.shareBtn) {
  elements.shareBtn.addEventListener('click', async () => {
    const url = elements.shareUrl.value;
    try {
      await navigator.clipboard.writeText(url);
      const orig = elements.shareBtn.textContent;
      elements.shareBtn.textContent = 'COPIED!';
      setTimeout(() => elements.shareBtn.textContent = orig, 2000);
    } catch (e) {
      elements.shareUrl.select();
      elements.shareUrl.setSelectionRange(0, 99999);
    }
  });
}

// Start button
if (elements.startMixBtn && TRACK_CONFIG) {
  elements.startMixBtn.addEventListener('click', async () => {
    // Check browser support first
    const missing = checkBrowserSupport();
    if (missing.length) {
      return showUnsupportedBrowser(missing);
    }

    elements.startMixBtn.textContent = 'INITIALIZING...';
    // Hide overlay early so loading indicator is visible
    elements.startOverlay.style.display = 'none';
    await initMixer();
  });
}

// Cleanup on unload
window.addEventListener('beforeunload', cleanup);

// Handle window resize for visualizers
window.addEventListener('resize', () => {
  if (holograph) holograph.resize();
});

