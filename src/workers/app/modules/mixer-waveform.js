// ==========================================
// Mixer Waveform Renderer
// ==========================================

import { WAVEFORM_WIDTH, WAVEFORM_HEIGHT } from './mixer-constants.js';

export class WaveformRenderer {
  constructor() {
    this.cache = {};
  }

  setCache(cache) {
    this.cache = cache;
  }

  drawFromCache(index, color) {
    const canvas = document.getElementById(`wave-${index}`);
    if (!canvas || !this.cache[index]) return;

    const ctx = canvas.getContext('2d');
    const peaks = this.cache[index];
    this._draw(ctx, peaks, color);
  }

  async drawFromBlob(index, blob, color, audioContext) {
    const canvas = document.getElementById(`wave-${index}`);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    // Show loading state
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    ctx.fillStyle = isLight ? '#999' : '#333';
    ctx.fillRect(0, WAVEFORM_HEIGHT / 2 - 1, WAVEFORM_WIDTH, 2);

    try {
      const arrayBuffer = await blob.arrayBuffer();
      if (arrayBuffer.byteLength < 1000) throw new Error('empty');

      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const peaks = this.extractPeaks(audioBuffer);
      this.cache[index] = peaks;
      this._draw(ctx, peaks, color);
    } catch (e) {
      console.error(`Waveform error for index ${index}:`, e);
      ctx.fillStyle = '#ff4444';
      ctx.fillRect(0, WAVEFORM_HEIGHT / 2 - 2, WAVEFORM_WIDTH, 4);
    }
  }

  extractPeaks(audioBuffer) {
    const width = WAVEFORM_WIDTH;
    const data = audioBuffer.getChannelData(0);
    const step = Math.ceil(data.length / width);
    const peaks = [];

    for (let i = 0; i < width; i++) {
      let min = 1, max = -1;
      for (let j = 0; j < step; j++) {
        const value = data[(i * step) + j];
        if (value < min) min = value;
        if (value > max) max = value;
      }
      peaks.push({ min, max });
    }

    return peaks;
  }

  _draw(ctx, peaks, color) {
    const width = WAVEFORM_WIDTH;
    const height = WAVEFORM_HEIGHT;
    const amplitude = height / 2;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = color;

    for (let i = 0; i < peaks.length; i++) {
      const peak = peaks[i];
      ctx.fillRect(i, (1 + peak.min) * amplitude, 1, Math.max(1, (peak.max - peak.min) * amplitude));
    }
  }
}
