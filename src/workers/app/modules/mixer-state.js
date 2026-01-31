// ==========================================
// Mixer State Management
// ==========================================

import {
  DEFAULT_FX_STATE,
  DEFAULT_STEM_STATE,
  DEFAULT_MASTER_VOLUME,
  FILTER_TYPES,
  FILTER_TYPE_MAP
} from './mixer-constants.js';

export class MixerState {
  constructor(stemConfig) {
    this.stems = {};
    this.masterVolume = DEFAULT_MASTER_VOLUME;

    stemConfig.forEach((stem, index) => {
      this.stems[index] = this._createDefaultStemState();
    });
  }

  _createDefaultStemState() {
    return {
      volume: DEFAULT_STEM_STATE.volume,
      muted: DEFAULT_STEM_STATE.muted,
      solo: DEFAULT_STEM_STATE.solo,
      fx: {
        eq: { ...DEFAULT_FX_STATE.eq },
        filter: { ...DEFAULT_FX_STATE.filter },
        reverb: { ...DEFAULT_FX_STATE.reverb },
        delay: { ...DEFAULT_FX_STATE.delay },
        pan: DEFAULT_FX_STATE.pan
      }
    };
  }

  getStem(index) {
    return this.stems[index];
  }

  updateStemVolume(index, value) {
    if (this.stems[index]) {
      this.stems[index].volume = value;
    }
  }

  toggleMute(index) {
    if (this.stems[index]) {
      this.stems[index].muted = !this.stems[index].muted;
    }
  }

  toggleSolo(index) {
    if (this.stems[index]) {
      this.stems[index].solo = !this.stems[index].solo;
    }
  }

  updateFX(index, fxType, param, value) {
    if (!this.stems[index]) return;

    const fx = this.stems[index].fx;
    if (typeof param === 'string') {
      fx[fxType][param] = value;
    } else {
      fx[fxType] = value;
    }
  }

  hasSolo() {
    return Object.values(this.stems).some(s => s.solo);
  }

  isStemActive(index, hasSolo = null) {
    const stem = this.stems[index];
    if (!stem) return false;
    if (stem.muted) return false;
    // Use passed value if available, otherwise compute (allows caller to cache)
    const soloActive = hasSolo !== null ? hasSolo : this.hasSolo();
    if (soloActive && !stem.solo) return false;
    return true;
  }

  reset() {
    Object.keys(this.stems).forEach(index => {
      this.stems[index] = this._createDefaultStemState();
    });
    this.masterVolume = DEFAULT_MASTER_VOLUME;
  }

  applyFromUrl(mixString) {
    if (!mixString) return;

    mixString.split(',').forEach(part => {
      const values = part.split(':');
      const index = parseInt(values[0]);

      if (!this.stems[index]) return;

      const stem = this.stems[index];

      // Basic values
      if (values[1] !== undefined) stem.volume = parseFloat(values[1]) / 100;
      if (values[2] !== undefined) stem.muted = values[2] === '1';
      if (values[3] !== undefined) stem.solo = values[3] === '1';

      // FX values
      if (values[4] !== undefined) stem.fx.pan = parseFloat(values[4]) / 100;
      if (values[5] !== undefined) stem.fx.eq.low = parseFloat(values[5]) / 10;
      if (values[6] !== undefined) stem.fx.eq.mid = parseFloat(values[6]) / 10;
      if (values[7] !== undefined) stem.fx.eq.high = parseFloat(values[7]) / 10;
      if (values[8] !== undefined) stem.fx.filter.type = FILTER_TYPES[parseInt(values[8])] || 'lowpass';
      if (values[9] !== undefined) stem.fx.filter.freq = parseFloat(values[9]);
      if (values[10] !== undefined) stem.fx.filter.resonance = parseFloat(values[10]) / 10;
      if (values[11] !== undefined) stem.fx.reverb.send = parseFloat(values[11]);
      if (values[12] !== undefined) stem.fx.delay.time = parseFloat(values[12]) / 100;
      if (values[13] !== undefined) stem.fx.delay.feedback = parseFloat(values[13]) / 100;
      if (values[14] !== undefined) stem.fx.delay.mix = parseFloat(values[14]);
      if (values[15] !== undefined) stem.fx.filter.rolloff = parseInt(values[15]);
    });
  }

  toShareUrl(baseUrl) {
    const mixParts = Object.entries(this.stems).map(([index, stem]) => {
      const fx = stem.fx;
      return [
        index,
        Math.round(stem.volume * 100),
        stem.muted ? 1 : 0,
        stem.solo ? 1 : 0,
        Math.round(fx.pan * 100),
        Math.round(fx.eq.low * 10),
        Math.round(fx.eq.mid * 10),
        Math.round(fx.eq.high * 10),
        FILTER_TYPE_MAP[fx.filter.type] || 0,
        Math.round(fx.filter.freq),
        Math.round(fx.filter.resonance * 10),
        Math.round(fx.reverb.send),
        Math.round(fx.delay.time * 100),
        Math.round(fx.delay.feedback * 100),
        Math.round(fx.delay.mix),
        fx.filter.rolloff || -12
      ].join(':');
    }).join(',');

    return `${baseUrl}?mix=${mixParts}&master=${Math.round(this.masterVolume * 100)}`;
  }

  get stemCount() {
    return Object.keys(this.stems).length;
  }
}
