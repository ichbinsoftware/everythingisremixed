// ==========================================
// Mixer Constants & Default Configuration
// ==========================================

export const DEFAULT_FX_STATE = {
  eq: { low: 0, mid: 0, high: 0 },
  filter: { freq: 20000, resonance: 1, type: 'lowpass', rolloff: -12 },
  reverb: { send: 0 },
  delay: { time: 0.375, feedback: 0.3, mix: 0 },
  pan: 0
};

// Filter rolloff options (dB/octave)
export const FILTER_ROLLOFFS = [-12, -24];

export const DEFAULT_STEM_STATE = {
  volume: 0.8,
  muted: false,
  solo: false,
  fx: { ...DEFAULT_FX_STATE }
};

export const DEFAULT_MASTER_VOLUME = 0.8;

export const BATCH_SIZE = {
  mobile: 3,
  desktop: 10
};

export const FFT_SIZE = {
  mobile: 64,
  desktop: 128
};

export const WAVEFORM_FFT = {
  mobile: 256,
  desktop: 1024
};

export const HOLOGRAPH_FFT = {
  mobile: 512,
  desktop: 2048
};

export const WAVEFORM_WIDTH = 140;
export const WAVEFORM_HEIGHT = 56;

// Filter type mapping for share URL encoding/decoding
export const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass'];
export const FILTER_TYPE_MAP = { lowpass: 0, highpass: 1, bandpass: 2 };

// EQ frequency values
export const EQ_FREQUENCIES = {
  low: 250,
  mid: 1000,
  high: 4000
};
