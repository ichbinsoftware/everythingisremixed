// ==========================================
// Mixer Audio Engine
// ==========================================

import { FFT_SIZE, WAVEFORM_FFT, HOLOGRAPH_FFT, EQ_FREQUENCIES } from './mixer-constants.js';

export class AudioEngine {
  constructor(isMobile) {
    this.isMobile = isMobile;
    this.context = null;
    this.masterGain = null;
    this.masterMeter = null;
    this.analyser = null;
    this.holographAnalyser = null;
    this.masterReverb = null;
  }

  async init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.context = new AC();
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }

    this._setupMasterChannel();
    this._setupReverb();
  }

  _setupMasterChannel() {
    // Create master gain
    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = 0.8;

    // Create master meter analyser
    this.masterMeter = this.context.createAnalyser();
    this.masterMeter.fftSize = this.isMobile ? FFT_SIZE.mobile : FFT_SIZE.desktop;

    // Create main analyser (for time-domain waveform)
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = this.isMobile ? WAVEFORM_FFT.mobile : WAVEFORM_FFT.desktop;

    // Create high-res analyser for holograph visualizer
    this.holographAnalyser = this.context.createAnalyser();
    this.holographAnalyser.fftSize = this.isMobile ? HOLOGRAPH_FFT.mobile : HOLOGRAPH_FFT.desktop;
    this.holographAnalyser.smoothingTimeConstant = 0.2; // Lower = snappier response

    // Signal flow: stems → analyser → masterGain → masterMeter → destination
    // Stems also connect to holograph analyser via masterGain
    this.analyser.connect(this.masterGain);
    this.masterGain.connect(this.masterMeter);
    this.masterGain.connect(this.holographAnalyser);
    this.masterMeter.connect(this.context.destination);
  }

  _setupReverb() {
    // Master reverb - shared by all stems via simple send gains
    // Uses ConvolverNode with synthetic impulse response
    // Performance: Shorter IR reduces CPU load significantly
    const conv = this.context.createConvolver();
    const revGain = this.context.createGain();
    const duration = this.isMobile ? 0.5 : 1; // Mobile: 0.5s, Desktop: 1s
    conv.buffer = this.generateImpulseResponse(duration, 2);
    conv.connect(revGain);
    revGain.connect(this.analyser);
    this.masterReverb = { input: conv, output: revGain };
  }

  createEQ() {
    const lowShelf = this.context.createBiquadFilter();
    const mid = this.context.createBiquadFilter();
    const highShelf = this.context.createBiquadFilter();

    lowShelf.type = 'lowshelf';
    lowShelf.frequency.value = EQ_FREQUENCIES.low;

    mid.type = 'peaking';
    mid.frequency.value = EQ_FREQUENCIES.mid;

    highShelf.type = 'highshelf';
    highShelf.frequency.value = EQ_FREQUENCIES.high;

    lowShelf.connect(mid);
    mid.connect(highShelf);

    return {
      lowShelf,
      mid,
      highShelf,
      input: lowShelf,
      output: highShelf,
      connect: (dest) => highShelf.connect(dest)
    };
  }

  createFilter(rolloff = -12) {
    const ctx = this.context;

    // Factory to create filter stages
    const createStages = (numStages) => {
      const filters = [];
      for (let i = 0; i < numStages; i++) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 20000;
        if (i > 0) filters[i - 1].connect(f);
        filters.push(f);
      }
      return filters;
    };

    const stages = Math.abs(rolloff) / 12;
    let filters = createStages(stages);
    let currentRolloff = rolloff;

    // Unified filter wrapper with setRolloff() for hot-swapping
    const wrapper = {
      get filters() { return filters; },
      get input() { return filters[0]; },
      get output() { return filters[filters.length - 1]; },
      get type() { return filters[0].type; },
      set type(t) { filters.forEach(f => f.type = t); },
      get frequency() { return filters[0].frequency; },
      get Q() { return filters[0].Q; },
      get rolloff() { return currentRolloff; },

      setType(t) { filters.forEach(f => f.type = t); },
      setFrequency(v, time, tc = 0.02) {
        filters.forEach(f => f.frequency.setTargetAtTime(v, time, tc));
      },
      setQ(v, time, tc = 0.02) {
        filters.forEach(f => f.Q.setTargetAtTime(v, time, tc));
      },
      connect(dest) { filters[filters.length - 1].connect(dest); },
      disconnect() { filters.forEach(f => f.disconnect()); },

      // Hot-swap rolloff: recreates internal stages, reconnects to chain
      setRolloff(newRolloff, prevNode, nextNode, time = 0) {
        if (newRolloff === currentRolloff) return false;

        // Store current settings
        const type = filters[0].type;
        const freq = filters[0].frequency.value;
        const q = filters[0].Q.value;

        // Disconnect old chain
        prevNode.disconnect();
        filters.forEach(f => f.disconnect());

        // Create new stages
        const newStages = Math.abs(newRolloff) / 12;
        filters = createStages(newStages);
        currentRolloff = newRolloff;

        // Apply stored settings
        filters.forEach(f => {
          f.type = type;
          f.frequency.value = freq;
          f.Q.value = q;
        });

        // Reconnect chain
        prevNode.connect(filters[0]);
        filters[filters.length - 1].connect(nextNode);

        return true;
      }
    };

    return wrapper;
  }

  createDelay() {
    const delayNode = this.context.createDelay(5);
    const feedback = this.context.createGain();
    const dry = this.context.createGain();
    const wet = this.context.createGain();
    const merger = this.context.createGain();

    delayNode.delayTime.value = 0.375;
    feedback.gain.value = 0.3;
    dry.gain.value = 1;
    wet.gain.value = 0;
    merger.gain.value = 1;

    dry.connect(delayNode);
    dry.connect(merger);
    delayNode.connect(feedback);
    feedback.connect(delayNode);
    delayNode.connect(wet);
    wet.connect(merger);

    return {
      delayNode,
      feedback,
      dry,
      wet,
      input: dry,
      output: merger,
      connect: (dest) => merger.connect(dest)
    };
  }

  createPanner() {
    const panner = this.context.createStereoPanner();
    panner.pan.value = 0;
    return panner;
  }

  createMeter() {
    const meter = this.context.createAnalyser();
    meter.fftSize = this.isMobile ? FFT_SIZE.mobile : FFT_SIZE.desktop;
    return meter;
  }

  generateImpulseResponse(duration, decay) {
    const length = this.context.sampleRate * duration;
    const buffer = this.context.createBuffer(2, length, this.context.sampleRate);

    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }

    return buffer;
  }

  setMasterVolume(value) {
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(value, this.context.currentTime, 0.01);
    }
  }

  async resume() {
    if (this.context && this.context.state === 'suspended') {
      await this.context.resume();
    }
  }

  get currentTime() {
    return this.context?.currentTime || 0;
  }
}
