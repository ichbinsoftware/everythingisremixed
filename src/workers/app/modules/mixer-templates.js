// ==========================================
// Mixer HTML Templates
// ==========================================

import { WAVEFORM_WIDTH, WAVEFORM_HEIGHT } from './mixer-constants.js';

// ==========================================
// Help Content Data
// ==========================================

const HELP_CONTENT = {
  controls: [
    { icon: 'fader', title: 'Volume Fader', description: 'Drag up/down to adjust the stem\'s volume in the mix' },
    { icon: 'mute-solo', title: 'Mute & Solo', description: 'M silences stem, S plays only this stem (combine multiple solos)' },
    { icon: 'pan', title: 'Pan Knob', description: 'Drag left/right to position the stem in the stereo field' },
    { icon: 'fx', title: 'Effects (FX)', description: 'EQ (Low/Mid/High), Filter (LP/HP/BP with -12 or -24 dB slope), Reverb send, and Delay (time/feedback/mix)' },
    { icon: 'led', title: 'Signal LED', description: 'Lights up when audio is detected on this stem' },
    { icon: 'theme', title: 'Light/Dark Mode', description: 'Click the sun/moon icon in the header to switch between light and dark themes' },
    { icon: 'share', title: 'Share', description: 'Copy a link that preserves your exact mix settings' },
    { icon: 'reset', title: 'Reset', description: 'Restore all stems to default volume, pan, and effects' }
  ],
  shortcuts: [
    { keys: ['Space'], description: 'Play / Pause' },
    { keys: ['←'], description: 'Rewind 10 seconds' },
    { keys: ['→'], description: 'Forward 10 seconds' },
    { keys: ['Home'], description: 'Skip to beginning' },
    { keys: ['R'], description: 'Reset mix to default' },
    { keys: ['?'], description: 'Toggle this help' },
    { keys: ['Esc'], description: 'Close modal' }
  ],
  tips: [
    'Solo multiple stems to isolate a group (e.g., all drums)',
    'Use the pan controls to create width in your mix',
    'Share your remix via URL - all settings are encoded in the link',
    'Try muting the lead vocal to create an instrumental version',
    'Use -24 dB/oct filter slope for sharper, more surgical cuts',
    'Highpass filter on bass-heavy stems can clean up muddy mixes',
    'Add subtle reverb (10-20%) to dry stems for cohesion',
    'Sync delay time to the track BPM for rhythmic effects',
    'Boost EQ highs on vocals to add presence and clarity',
    'Cut EQ lows on non-bass stems to reduce frequency masking',
    'Bandpass filter + high Q creates a "telephone" effect',
    'Hard pan two similar stems for a wide stereo image',
    'Experiment freely - hit Reset to start fresh anytime'
  ]
};

function renderHelpIcon(type) {
  switch (type) {
    case 'fader':
      return '<div class="icon-fader"></div>';
    case 'mute-solo':
      return '<div class="icon-btns"><span class="icon-btn m">M</span><span class="icon-btn s">S</span></div>';
    case 'pan':
      return '<div class="icon-pan"><div class="icon-pan-dot"></div></div>';
    case 'fx':
      return '<span class="icon-fx">FX</span>';
    case 'led':
      return '<div class="icon-led"></div>';
    case 'theme':
      return '<div class="icon-theme"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg></div>';
    case 'share':
      return '<span class="icon-share">SHARE</span>';
    case 'reset':
      return '<span class="icon-reset">RESET</span>';
    default:
      return '';
  }
}

/**
 * Renders the help modal content.
 */
export function renderHelpModal() {
  const controlsHtml = HELP_CONTENT.controls.map(item => `
    <div class="help-item">
      <div class="help-item-icon ${item.icon}">${renderHelpIcon(item.icon)}</div>
      <div class="help-item-text">
        <h4>${item.title}</h4>
        <p>${item.description}</p>
      </div>
    </div>
  `).join('');

  const shortcutsHtml = HELP_CONTENT.shortcuts.map(item => `
    <div class="help-shortcut">
      <div class="help-shortcut-keys">
        ${item.keys.map(k => `<span class="help-key">${k}</span>`).join('')}
      </div>
      <span class="help-shortcut-desc">${item.description}</span>
    </div>
  `).join('');

  const tipsHtml = HELP_CONTENT.tips.map(tip => `
    <div class="help-tip">${tip}</div>
  `).join('');

  return `
    <div class="help-handle"></div>
    <div class="help-header">
      <span class="help-title">QUICK GUIDE</span>
      <button class="help-close" id="helpClose" aria-label="Close help">&times;</button>
    </div>
    <div class="help-tabs">
      <button class="help-tab active" data-tab="controls">CONTROLS</button>
      <button class="help-tab" data-tab="shortcuts">SHORTCUTS</button>
      <button class="help-tab" data-tab="tips">TIPS</button>
    </div>
    <div class="help-content">
      <div class="help-tab-content active" data-tab="controls">
        <div class="help-items">${controlsHtml}</div>
      </div>
      <div class="help-tab-content" data-tab="shortcuts">
        <div class="help-shortcuts">${shortcutsHtml}</div>
      </div>
      <div class="help-tab-content" data-tab="tips">
        <div class="help-tips">${tipsHtml}</div>
      </div>
    </div>
    <button class="help-dismiss" id="helpDismiss">GOT IT</button>
  `;
}

/**
 * Renders a single mixer channel.
 */
export function renderChannel(index, player, stemState, showFxButton) {
  const div = document.createElement('div');
  div.className = 'channel active';
  div.id = `channel-${index}`;
  div.dataset.index = index;
  div.style.setProperty('--channel-color', player.color);

  div.innerHTML = `
    <span class="signal-led" id="led-${index}"></span>
    <div class="channel-name" id="name-${index}">${player.name}</div>
    <div class="stem-waveform"><canvas id="wave-${index}" width="${WAVEFORM_WIDTH}" height="${WAVEFORM_HEIGHT}"></canvas></div>
    <div class="pan-control">
      <input type="range" min="-100" max="100" value="${stemState.fx.pan * 100}" id="pan-${index}" class="pan-slider">
      <div class="pan-label">PAN</div>
    </div>
    <div class="fader-container">
      <div class="meter"><div class="meter-fill" id="meter-${index}"></div></div>
      <div class="fader" id="fader-${index}">
        <div class="fader-fill" style="height:${stemState.volume * 100}%"></div>
        <div class="fader-handle" style="bottom:${stemState.volume * 100}%"></div>
      </div>
    </div>
    <div class="volume-readout" id="readout-${index}">${Math.round(stemState.volume * 100)}%</div>
    <div class="channel-buttons">
      <button id="mute-${index}" class="channel-btn mute ${stemState.muted ? 'active' : ''}">M</button>
      <button id="solo-${index}" class="channel-btn solo ${stemState.solo ? 'active' : ''}">S</button>
    </div>
    ${showFxButton ? `<button class="channel-btn fx-btn" id="fx-btn-${index}">FX</button>` : ''}
  `;

  return div;
}

/**
 * Renders the master channel.
 */
export function renderMasterChannel(masterVolume) {
  const div = document.createElement('div');
  div.className = 'master-channel';

  div.innerHTML = `
    <div class="master-label">MASTER</div>
    <div class="master-fader-container">
      <div class="master-meter">
        <div class="master-meter-fill" id="masterMeterFill"></div>
      </div>
      <div class="master-fader" id="masterFader">
        <div class="fader-fill" style="height: ${Math.round(masterVolume * 100)}%"></div>
        <div class="fader-handle" style="bottom: ${Math.round(masterVolume * 100)}%"></div>
      </div>
    </div>
    <div class="master-volume-readout" id="masterReadout">${Math.round(masterVolume * 100)}%</div>
  `;

  return div;
}

/**
 * Renders the FX modal content.
 */
export function renderFXModal(index, stemName, stemState, activeTab) {
  const fx = stemState.fx;

  return `
    <div class="fx-panel-header">
      <span>${stemName} EFFECTS</span>
      <button class="fx-close" id="fx-modal-close">×</button>
    </div>

    <div class="fx-tabs">
      <button class="fx-tab-btn ${activeTab === 'eq-filter' ? 'active' : ''}" data-tab="eq-filter">EQ / FILTER</button>
      <button class="fx-tab-btn ${activeTab === 'reverb-delay' ? 'active' : ''}" data-tab="reverb-delay">REVERB / DELAY</button>
    </div>

    <div class="fx-tab-content ${activeTab === 'eq-filter' ? 'active' : ''}" data-tab="eq-filter">
      <div class="fx-section">
        <label>EQ</label>
        <div class="fx-control">
          <span class="fx-label">Low</span>
          <input type="range" min="-12" max="12" step="0.1" value="${fx.eq.low}" class="fx-slider" id="eq-low-${index}">
          <span class="fx-value" id="eq-low-val-${index}">${fx.eq.low.toFixed(1)}dB</span>
        </div>
        <div class="fx-control">
          <span class="fx-label">Mid</span>
          <input type="range" min="-12" max="12" step="0.1" value="${fx.eq.mid}" class="fx-slider" id="eq-mid-${index}">
          <span class="fx-value" id="eq-mid-val-${index}">${fx.eq.mid.toFixed(1)}dB</span>
        </div>
        <div class="fx-control">
          <span class="fx-label">High</span>
          <input type="range" min="-12" max="12" step="0.1" value="${fx.eq.high}" class="fx-slider" id="eq-high-${index}">
          <span class="fx-value" id="eq-high-val-${index}">${fx.eq.high.toFixed(1)}dB</span>
        </div>
      </div>

      <div class="fx-section">
        <label>Filter</label>
        <div class="fx-control">
          <span class="fx-label">Type</span>
          <select class="fx-select" id="filter-type-${index}">
            <option value="lowpass" ${fx.filter.type === 'lowpass' ? 'selected' : ''}>Lowpass</option>
            <option value="highpass" ${fx.filter.type === 'highpass' ? 'selected' : ''}>Highpass</option>
            <option value="bandpass" ${fx.filter.type === 'bandpass' ? 'selected' : ''}>Bandpass</option>
          </select>
        </div>
        <div class="fx-control">
          <span class="fx-label">Slope</span>
          <select class="fx-select" id="filter-rolloff-${index}">
            <option value="-12" ${fx.filter.rolloff === -12 ? 'selected' : ''}>-12 dB/oct</option>
            <option value="-24" ${fx.filter.rolloff === -24 ? 'selected' : ''}>-24 dB/oct</option>
          </select>
        </div>
        <div class="fx-control">
          <span class="fx-label">Freq</span>
          <input type="range" min="20" max="20000" step="1" value="${fx.filter.freq}" class="fx-slider" id="filter-freq-${index}">
          <span class="fx-value" id="filter-freq-val-${index}">${Math.round(fx.filter.freq)}Hz</span>
        </div>
        <div class="fx-control">
          <span class="fx-label">Q</span>
          <input type="range" min="0.1" max="10" step="0.1" value="${fx.filter.resonance}" class="fx-slider" id="filter-res-${index}">
          <span class="fx-value" id="filter-res-val-${index}">${fx.filter.resonance.toFixed(1)}</span>
        </div>
      </div>
    </div>

    <div class="fx-tab-content ${activeTab === 'reverb-delay' ? 'active' : ''}" data-tab="reverb-delay">
      <div class="fx-section">
        <label>Reverb</label>
        <div class="fx-control">
          <span class="fx-label">Send</span>
          <input type="range" min="0" max="100" step="1" value="${fx.reverb.send}" class="fx-slider" id="reverb-send-${index}">
          <span class="fx-value" id="reverb-send-val-${index}">${Math.round(fx.reverb.send)}%</span>
        </div>
      </div>

      <div class="fx-section">
        <label>Delay</label>
        <div class="fx-control">
          <span class="fx-label">Time</span>
          <input type="range" min="0.01" max="2" step="0.01" value="${fx.delay.time}" class="fx-slider" id="delay-time-${index}">
          <span class="fx-value" id="delay-time-val-${index}">${fx.delay.time.toFixed(2)}s</span>
        </div>
        <div class="fx-control">
          <span class="fx-label">Feedback</span>
          <input type="range" min="0" max="0.9" step="0.01" value="${fx.delay.feedback}" class="fx-slider" id="delay-fb-${index}">
          <span class="fx-value" id="delay-fb-val-${index}">${Math.round(fx.delay.feedback * 100)}%</span>
        </div>
        <div class="fx-control">
          <span class="fx-label">Mix</span>
          <input type="range" min="0" max="100" step="1" value="${fx.delay.mix}" class="fx-slider" id="delay-mix-${index}">
          <span class="fx-value" id="delay-mix-val-${index}">${Math.round(fx.delay.mix)}%</span>
        </div>
      </div>
    </div>
  `;
}
