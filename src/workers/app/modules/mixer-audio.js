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

  createCompressor() {
    const comp = this.context.createDynamicsCompressor();
    comp.threshold.value = -24;
    comp.knee.value = 30;
    comp.ratio.value = 12;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;

    return {
      node: comp,
      input: comp,
      output: comp,
      connect: (dest) => comp.connect(dest)
    };
  }

  createDistortion() {
    const ctx = this.context;
    const input = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const output = ctx.createGain();

    shaper.oversample = 'none';
    dry.gain.value = 1;
    wet.gain.value = 0;

    // Clean path: input → dry → output
    input.connect(dry);
    dry.connect(output);

    // Distorted path: input → shaper → wet → output
    input.connect(shaper);
    shaper.connect(wet);
    wet.connect(output);

    const setCurve = (drive, tone) => {
      const samples = 44100;
      const curve = new Float32Array(samples);
      const amount = 1 + drive * 0.5;
      const DEG = Math.PI / 180;

      for (let i = 0; i < samples; i++) {
        const x = (i * 2) / samples - 1;
        switch (tone) {
          case 'warm':
            curve[i] = Math.tanh(x * amount);
            break;
          case 'crunch': {
            const k = amount * 50;
            curve[i] = ((3 + k) * x * DEG) / (Math.PI + k * Math.abs(x));
            break;
          }
          case 'fuzz':
            curve[i] = x > 0
              ? 1 - Math.exp(-x * amount)
              : -(1 - Math.exp(x * amount));
            break;
          case 'hard-clip':
            curve[i] = Math.max(-1, Math.min(1, x * amount));
            break;
          default:
            curve[i] = Math.tanh(x * amount);
        }
      }
      shaper.curve = curve;
    };

    // Initialize with default curve
    setCurve(0, 'warm');

    return {
      input,
      shaper,
      dry,
      wet,
      output,
      setCurve,
      connect: (dest) => output.connect(dest)
    };
  }

  createTremolo() {
    const ctx = this.context;

    // Signal path: input → signalGain → output
    // LFO modulates signalGain.gain around 1.0
    const signalGain = ctx.createGain();
    signalGain.gain.value = 0; // overridden by bias

    // Bias: constant 1 → signalGain.gain (DC offset)
    const bias = ctx.createConstantSource();
    bias.offset.value = 1;
    bias.connect(signalGain.gain);
    bias.start();

    // LFO: osc → depthGain → signalGain.gain
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 4;
    const depthGain = ctx.createGain();
    depthGain.gain.value = 0; // depth 0 = no modulation
    osc.connect(depthGain);
    depthGain.connect(signalGain.gain);
    osc.start();

    return {
      input: signalGain,
      output: signalGain,
      setRate(v) { osc.frequency.value = v; },
      setDepth(v) {
        // Keep peak gain at 1.0: bias = 1 - v/2, amplitude = v/2
        // At full depth: gain oscillates [0, 1]; at zero depth: constant 1.0
        bias.offset.value = 1 - v * 0.5;
        depthGain.gain.value = v * 0.5;
      },
      setShape(v) { osc.type = v; },
      connect(dest) { signalGain.connect(dest); }
    };
  }

  createRingMod() {
    const ctx = this.context;
    const input = ctx.createGain();
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const output = ctx.createGain();

    dry.gain.value = 1;
    wet.gain.value = 0;

    // Clean path: input → dry → output
    input.connect(dry);
    dry.connect(output);

    // Ring mod path: input → modGain → wet → output
    const modGain = ctx.createGain();
    modGain.gain.value = 0; // carrier osc drives this
    input.connect(modGain);
    modGain.connect(wet);
    wet.connect(output);

    // Carrier oscillator → modGain.gain
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 440;
    osc.connect(modGain.gain);
    osc.start();

    return {
      input,
      output,
      dry,
      wet,
      setFrequency(v) { osc.frequency.value = v; },
      setShape(v) { osc.type = v; },
      connect(dest) { output.connect(dest); }
    };
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
