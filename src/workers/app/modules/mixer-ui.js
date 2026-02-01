// ==========================================
// Mixer UI Builder
// ==========================================

import { WAVEFORM_WIDTH, WAVEFORM_HEIGHT } from './mixer-constants.js';
import { WaveformRenderer } from './mixer-waveform.js';
import { renderChannel, renderMasterChannel } from './mixer-templates.js';

export class UIBuilder {
  constructor(container, state) {
    this.container = container;
    this.state = state;
    this.waveformRenderer = new WaveformRenderer();
    this.activeFader = null;
    this.callbacks = null;

    // Cached DOM references (avoid lookups in animation loop)
    this.meterElements = {};
    this.signalLedElements = {};
    this.channelElements = {};
    this.masterMeterElement = null;
    this.lastMeterLevels = {};

    // Visibility Tracking (Virtualization)
    this.visibleIndices = new Set();
    this.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const index = entry.target.dataset.index;
        if (index === undefined) return;

        if (entry.isIntersecting) {
          this.visibleIndices.add(index);
        } else {
          this.visibleIndices.delete(index);
        }
      });
    }, { root: null, rootMargin: '0px', threshold: 0 });

    // Bound event handlers (global)
    this._onMouseMove = null;
    this._onMouseUp = null;
    this._onTouchMove = null;
    this._onTouchEnd = null;

    // Bound event handlers (delegated on container)
    this._onContainerClick = null;
    this._onContainerInput = null;
    this._onFaderStart = null;

    this._setupGlobalFaderListeners();
    this._setupDelegatedListeners();
  }

  get waveformCache() {
    return this.waveformRenderer.cache;
  }

  _setupGlobalFaderListeners() {
    this._onMouseMove = e => { if (this.activeFader) this.activeFader(e); };
    this._onMouseUp = () => { this.activeFader = null; };
    this._onTouchMove = e => {
      if (this.activeFader) {
        e.preventDefault();
        this.activeFader(e);
      }
    };
    this._onTouchEnd = () => { this.activeFader = null; };

    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('touchmove', this._onTouchMove, { passive: false });
    window.addEventListener('touchend', this._onTouchEnd);
  }

  // Shared fader handler factory - eliminates duplicate logic for stem/master faders
  _createFaderHandler(fader, fill, handle, readout, callback) {
    return (evt) => {
      const rect = fader.getBoundingClientRect();
      const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
      const y = clientY - rect.top;
      const value = Math.max(0, Math.min(1, 1 - y / rect.height));

      fill.style.height = `${value * 100}%`;
      handle.style.bottom = `${value * 100}%`;
      if (readout) readout.textContent = `${Math.round(value * 100)}%`;

      callback(value);
    };
  }

  _setupDelegatedListeners() {
    // Mute/Solo/FX buttons
    this._onContainerClick = e => {
      if (!this.callbacks) return;
      const target = e.target;
      if (target.tagName === 'BUTTON') {
        const id = target.id;
        if (id.startsWith('mute-')) {
          this.callbacks.onMute(id.split('-')[1]);
        } else if (id.startsWith('solo-')) {
          this.callbacks.onSolo(id.split('-')[1]);
        } else if (id.startsWith('fx-btn-')) {
          this.callbacks.onFXToggle(id.split('fx-btn-')[1]);
        }
      }
    };

    // Pan slider
    this._onContainerInput = e => {
      if (!this.callbacks) return;
      const target = e.target;
      if (target.classList.contains('pan-slider')) {
        const index = target.id.split('-')[1];
        this.callbacks.onPan(index, target.value / 100);
      }
    };

    // Fader interaction (master fader handled separately in _setupMasterFaderControls)
    this._onFaderStart = e => {
      const fader = e.target.closest('.fader');
      if (!fader || fader.id === 'masterFader') return;

      const index = fader.id.split('-')[1];
      const updateFader = this._createFaderHandler(
        fader,
        fader.querySelector('.fader-fill'),
        fader.querySelector('.fader-handle'),
        document.getElementById(`readout-${index}`),
        (value) => { if (this.callbacks) this.callbacks.onFader(index, value); }
      );

      this.activeFader = updateFader;
      updateFader(e);
    };

    this.container.addEventListener('click', this._onContainerClick);
    this.container.addEventListener('input', this._onContainerInput);
    this.container.addEventListener('mousedown', this._onFaderStart);
    this.container.addEventListener('touchstart', this._onFaderStart);
  }

  dispose() {
    // Remove global listeners
    if (this._onMouseMove) window.removeEventListener('mousemove', this._onMouseMove);
    if (this._onMouseUp) window.removeEventListener('mouseup', this._onMouseUp);
    if (this._onTouchMove) window.removeEventListener('touchmove', this._onTouchMove);
    if (this._onTouchEnd) window.removeEventListener('touchend', this._onTouchEnd);

    // Remove delegated listeners
    if (this._onContainerClick) this.container.removeEventListener('click', this._onContainerClick);
    if (this._onContainerInput) this.container.removeEventListener('input', this._onContainerInput);
    if (this._onFaderStart) {
      this.container.removeEventListener('mousedown', this._onFaderStart);
      this.container.removeEventListener('touchstart', this._onFaderStart);
    }

    this.observer.disconnect();
    this.visibleIndices.clear();

    this._onMouseMove = null;
    this._onMouseUp = null;
    this._onTouchMove = null;
    this._onTouchEnd = null;
    this._onContainerClick = null;
    this._onContainerInput = null;
    this._onFaderStart = null;
    this.meterElements = {};
    this.signalLedElements = {};
    this.channelElements = {};
    this.masterMeterElement = null;
    this.activeFader = null;
    this.callbacks = null;
  }

  buildChannels(players, callbacks, onChannelCreated) {
    this.container.innerHTML = '';
    this.callbacks = callbacks;
    
    this.observer.disconnect();
    this.visibleIndices.clear();

    Object.entries(players).forEach(([index, player]) => {
      const stemState = this.state.getStem(index);
      const channel = this._createChannelElement(index, player, stemState);
      this.container.appendChild(channel);
      this.observer.observe(channel);

      if (onChannelCreated) {
        onChannelCreated(index, channel);
      }
    });

    const masterChannel = this._createMasterChannel(callbacks);
    this.container.appendChild(masterChannel);

    this._cacheMeterElements(players);
  }

  _cacheMeterElements(players) {
    this.meterElements = {};
    this.signalLedElements = {};
    this.channelElements = {};
    Object.keys(players).forEach(index => {
      this.meterElements[index] = document.getElementById(`meter-${index}`);
      this.signalLedElements[index] = document.getElementById(`led-${index}`);
      this.channelElements[index] = document.getElementById(`channel-${index}`);
    });
    this.masterMeterElement = document.getElementById('masterMeterFill');
  }

  _createChannelElement(index, player, stemState) {
    return renderChannel(index, player, stemState, true);
  }

  _createMasterChannel(callbacks) {
    const div = renderMasterChannel(this.state.masterVolume);
    this._setupMasterFaderControls(div, callbacks);
    return div;
  }

  _setupMasterFaderControls(element, callbacks) {
    const fader = element.querySelector('#masterFader');
    if (!fader) return;

    const updateFader = this._createFaderHandler(
      fader,
      fader.querySelector('.fader-fill'),
      fader.querySelector('.fader-handle'),
      element.querySelector('#masterReadout'),
      callbacks.onMasterFader
    );

    const startDrag = (e) => {
      this.activeFader = updateFader;
      updateFader(e);
    };

    fader.addEventListener('mousedown', startDrag);
    fader.addEventListener('touchstart', startDrag);
  }

  // Note: Updates DOM even for invisible channels since classList toggles are cheap.
  // Only meter updates (in animation loop) are skipped for invisible channels.
  updateChannelState(index, isActive, isMuted, isSolo) {
    const channel = document.getElementById(`channel-${index}`);
    if (!channel) return;

    channel.classList.toggle('active', isActive);
    channel.classList.toggle('inactive', !isActive);

    const muteBtn = channel.querySelector(`#mute-${index}`);
    const soloBtn = channel.querySelector(`#solo-${index}`);

    if (muteBtn) muteBtn.classList.toggle('active', isMuted);
    if (soloBtn) soloBtn.classList.toggle('active', isSolo);
  }

  updateMeter(index, level) {
    // Dirty check: Only update if value changed significantly
    if (Math.abs((this.lastMeterLevels[index] || 0) - level) < 0.01) return;
    this.lastMeterLevels[index] = level;

    const el = this.meterElements[index];
    if (el) {
      el.style.transform = `scaleY(${level})`;
    }
  }

  updateMasterMeter(level) {
    if (this.masterMeterElement) {
      this.masterMeterElement.style.transform = `scaleY(${level})`;
    }
  }

  setChannelSignal(index, hasSignal) {
    const channel = this.channelElements[index];
    if (channel) {
      channel.classList.toggle('has-signal', hasSignal);
    }
  }

  isChannelVisible(index) {
    return this.visibleIndices.has(index.toString());
  }

  // Waveform methods
  setWaveformCache(cache) {
    this.waveformRenderer.setCache(cache);
  }

  drawWaveformFromCache(index, color) {
    this.waveformRenderer.drawFromCache(index, color);
  }

  async drawWaveformFromBlob(index, blob, color, audioContext) {
    await this.waveformRenderer.drawFromBlob(index, blob, color, audioContext);
  }

  // Progress bar
  updateProgress(currentTime, duration) {
    const progressFill = document.getElementById('progressFill');
    const currentTimeEl = document.getElementById('currentTime');

    if (progressFill && duration > 0) {
      progressFill.style.width = `${(currentTime / duration) * 100}%`;
    }

    if (currentTimeEl) {
      const mins = Math.floor(currentTime / 60);
      const secs = Math.floor(currentTime % 60).toString().padStart(2, '0');
      currentTimeEl.textContent = `${mins}:${secs}`;
    }
  }

  setDuration(duration) {
    const durationEl = document.getElementById('duration');
    if (durationEl) {
      const mins = Math.floor(duration / 60);
      const secs = Math.floor(duration % 60).toString().padStart(2, '0');
      durationEl.textContent = `${mins}:${secs}`;
    }
  }
}
