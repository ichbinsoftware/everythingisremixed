// ==========================================
// Mixer FX Controller (Modal)
// ==========================================

import { DEFAULT_FX_STATE } from './mixer-constants.js';
import { renderFXModal } from './mixer-templates.js';

export class FXController {
  constructor(state, audioEngine, onUpdate) {
    this.state = state;
    this.audio = audioEngine;
    this.onUpdate = onUpdate;
    this.players = null;
    this.activeIndex = null;
    this.modal = null;
    this.activeTab = 'eq-filter';
  }

  // Store players reference for modal use
  setPlayers(players) {
    this.players = players;
  }

  // Initialize modal (call once after DOM is ready)
  initModal() {
    if (this.modal) return;

    // Create modal backdrop and container
    const backdrop = document.createElement('div');
    backdrop.className = 'fx-modal-backdrop';
    backdrop.innerHTML = `
      <div class="fx-modal">
        <div class="fx-modal-content"></div>
      </div>
    `;

    document.body.appendChild(backdrop);
    this.modal = backdrop;

    // Close on backdrop click
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        this.closeModal();
      }
    });

    // Close on escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.activeIndex !== null) {
        this.closeModal();
      }
    });
  }

  _buildModalContent(index, stemName) {
    const stemState = this.state.getStem(index);
    return renderFXModal(index, stemName, stemState, this.activeTab);
  }

  _setupModalListeners(index) {
    const content = this.modal.querySelector('.fx-modal-content');
    const player = this.players[index];
    if (!player) return;

    const currentTime = () => this.audio.currentTime;

    // Close button
    content.querySelector('#fx-modal-close').addEventListener('click', () => {
      this.closeModal();
    });

    // Tab switching
    content.querySelectorAll('.fx-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tabName = btn.dataset.tab;
        this.activeTab = tabName;

        content.querySelectorAll('.fx-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        content.querySelectorAll('.fx-tab-content').forEach(c => {
          c.classList.toggle('active', c.dataset.tab === tabName);
        });
      });
    });

    // EQ controls
    this._bindSlider(content, 'eq-low', index, val => {
      this.state.updateFX(index, 'eq', 'low', val);
      player.effects.eq.lowShelf.gain.setTargetAtTime(val, currentTime(), 0.02);
    }, val => `${val.toFixed(1)}dB`);

    this._bindSlider(content, 'eq-mid', index, val => {
      this.state.updateFX(index, 'eq', 'mid', val);
      player.effects.eq.mid.gain.setTargetAtTime(val, currentTime(), 0.02);
    }, val => `${val.toFixed(1)}dB`);

    this._bindSlider(content, 'eq-high', index, val => {
      this.state.updateFX(index, 'eq', 'high', val);
      player.effects.eq.highShelf.gain.setTargetAtTime(val, currentTime(), 0.02);
    }, val => `${val.toFixed(1)}dB`);

    // Filter controls
    content.querySelector(`#filter-type-${index}`).addEventListener('change', e => {
      const value = e.target.value;
      this.state.updateFX(index, 'filter', 'type', value);
      const filter = player.effects.filter;
      if (filter.setType) {
        filter.setType(value);
      } else {
        filter.type = value;
      }
      if (this.onUpdate) this.onUpdate();
    });

    this._bindSlider(content, 'filter-freq', index, val => {
      this.state.updateFX(index, 'filter', 'freq', val);
      const filter = player.effects.filter;
      if (filter.setFrequency) {
        filter.setFrequency(val, currentTime());
      } else {
        filter.frequency.setTargetAtTime(val, currentTime(), 0.02);
      }
    }, val => `${Math.round(val)}Hz`);

    this._bindSlider(content, 'filter-res', index, val => {
      this.state.updateFX(index, 'filter', 'resonance', val);
      const filter = player.effects.filter;
      if (filter.setQ) {
        filter.setQ(val, currentTime());
      } else {
        filter.Q.setTargetAtTime(val, currentTime(), 0.02);
      }
    }, val => val.toFixed(1));

    // Filter rolloff control
    content.querySelector(`#filter-rolloff-${index}`).addEventListener('change', e => {
      const value = parseInt(e.target.value);
      this._changeFilterRolloff(index, player, value);
      if (this.onUpdate) this.onUpdate();
    });

    // Compressor controls (lazy — node created on first interaction)
    this._bindSlider(content, 'comp-thresh', index, val => {
      this.state.updateFX(index, 'compressor', 'threshold', val);
      this._ensureCompressor(player).node.threshold.setTargetAtTime(val, currentTime(), 0.02);
    }, val => `${Math.round(val)}dB`);

    this._bindSlider(content, 'comp-knee', index, val => {
      this.state.updateFX(index, 'compressor', 'knee', val);
      this._ensureCompressor(player).node.knee.setTargetAtTime(val, currentTime(), 0.02);
    }, val => `${Math.round(val)}dB`);

    this._bindSlider(content, 'comp-ratio', index, val => {
      this.state.updateFX(index, 'compressor', 'ratio', val);
      this._ensureCompressor(player).node.ratio.setTargetAtTime(val, currentTime(), 0.02);
    }, val => val.toFixed(1));

    this._bindSlider(content, 'comp-attack', index, val => {
      this.state.updateFX(index, 'compressor', 'attack', val);
      this._ensureCompressor(player).node.attack.setTargetAtTime(val, currentTime(), 0.02);
    }, val => `${val.toFixed(3)}s`);

    this._bindSlider(content, 'comp-release', index, val => {
      this.state.updateFX(index, 'compressor', 'release', val);
      this._ensureCompressor(player).node.release.setTargetAtTime(val, currentTime(), 0.02);
    }, val => `${val.toFixed(2)}s`);

    // Distortion controls (lazy — node created on first interaction)
    this._bindSlider(content, 'dist-drive', index, val => {
      this.state.updateFX(index, 'distortion', 'drive', val);
      const stemState = this.state.getStem(index);
      const dist = this._ensureDistortion(player);
      dist.setCurve(val, stemState.fx.distortion.tone);
    }, val => `${Math.round(val)}`);

    content.querySelector(`#dist-tone-${index}`).addEventListener('change', e => {
      const value = e.target.value;
      this.state.updateFX(index, 'distortion', 'tone', value);
      const stemState = this.state.getStem(index);
      const dist = this._ensureDistortion(player);
      dist.setCurve(stemState.fx.distortion.drive, value);
      if (this.onUpdate) this.onUpdate();
    });

    this._bindSlider(content, 'dist-mix', index, val => {
      this.state.updateFX(index, 'distortion', 'mix', val);
      const dist = this._ensureDistortion(player);
      dist.wet.gain.setTargetAtTime(val / 100, currentTime(), 0.02);
      dist.dry.gain.setTargetAtTime(1 - val / 100, currentTime(), 0.02);
    }, val => `${Math.round(val)}%`);

    // Tremolo controls (lazy — node created on first interaction)
    this._bindSlider(content, 'trem-rate', index, val => {
      this.state.updateFX(index, 'tremolo', 'rate', val);
      this._ensureTremolo(player).setRate(val);
    }, val => `${val.toFixed(1)}Hz`);

    this._bindSlider(content, 'trem-depth', index, val => {
      this.state.updateFX(index, 'tremolo', 'depth', val);
      this._ensureTremolo(player).setDepth(val / 100);
    }, val => `${Math.round(val)}%`);

    content.querySelector(`#trem-shape-${index}`).addEventListener('change', e => {
      const value = e.target.value;
      this.state.updateFX(index, 'tremolo', 'shape', value);
      this._ensureTremolo(player).setShape(value);
      if (this.onUpdate) this.onUpdate();
    });

    // Ring Modulator controls (lazy — node created on first interaction)
    this._bindSlider(content, 'rm-freq', index, val => {
      this.state.updateFX(index, 'ringmod', 'frequency', val);
      this._ensureRingMod(player).setFrequency(val);
    }, val => `${Math.round(val)}Hz`);

    content.querySelector(`#rm-shape-${index}`).addEventListener('change', e => {
      const value = e.target.value;
      this.state.updateFX(index, 'ringmod', 'shape', value);
      this._ensureRingMod(player).setShape(value);
      if (this.onUpdate) this.onUpdate();
    });

    this._bindSlider(content, 'rm-mix', index, val => {
      this.state.updateFX(index, 'ringmod', 'mix', val);
      const rm = this._ensureRingMod(player);
      rm.wet.gain.setTargetAtTime(val / 100, currentTime(), 0.02);
      rm.dry.gain.setTargetAtTime(1 - val / 100, currentTime(), 0.02);
    }, val => `${Math.round(val)}%`);

    // Reverb send
    this._bindSlider(content, 'reverb-send', index, val => {
      this.state.updateFX(index, 'reverb', 'send', val);
      player.effects.reverbSend.gain.setTargetAtTime(val / 100, currentTime(), 0.02);
    }, val => `${Math.round(val)}%`);

    // Delay controls
    this._bindSlider(content, 'delay-time', index, val => {
      this.state.updateFX(index, 'delay', 'time', val);
      player.effects.delay.delayNode.delayTime.setTargetAtTime(val, currentTime(), 0.02);
    }, val => `${val.toFixed(2)}s`);

    this._bindSlider(content, 'delay-fb', index, val => {
      this.state.updateFX(index, 'delay', 'feedback', val);
      player.effects.delay.feedback.gain.setTargetAtTime(val, currentTime(), 0.02);
    }, val => `${Math.round(val * 100)}%`);

    this._bindSlider(content, 'delay-mix', index, val => {
      this.state.updateFX(index, 'delay', 'mix', val);
      player.effects.delay.wet.gain.setTargetAtTime(val / 100, currentTime(), 0.02);
    }, val => `${Math.round(val)}%`);
  }

  _bindSlider(container, idBase, index, updateFn, formatFn) {
    const input = container.querySelector(`#${idBase}-${index}`);
    const label = container.querySelector(`#${idBase}-val-${index}`);

    if (!input) return;

    input.addEventListener('input', e => {
      const value = parseFloat(e.target.value);
      updateFn(value);
      if (label && formatFn) {
        label.textContent = formatFn(value);
      }
      if (this.onUpdate) this.onUpdate();
    });
  }

  togglePanel(index) {
    // If same panel is open, close it
    if (this.activeIndex === index) {
      this.closeModal();
      return;
    }

    // Open modal for this stem
    this.openModal(index);
  }

  openModal(index) {
    if (!this.modal || !this.players) return;

    const player = this.players[index];
    if (!player) return;

    this.activeIndex = index;
    this.activeTab = 'eq-filter'; // Reset to default tab for new channel

    // Populate content
    const content = this.modal.querySelector('.fx-modal-content');
    content.innerHTML = this._buildModalContent(index, player.name);

    // Setup listeners
    this._setupModalListeners(index);

    // Show modal
    this.modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  closeModal() {
    if (!this.modal) return;

    this.modal.classList.remove('active');
    this.activeIndex = null;
    document.body.style.overflow = '';
  }

  // Lazily create compressor and splice into chain: EQ → [Compressor] → [Distortion] → Filter
  _ensureCompressor(player) {
    if (player.effects.compressor) return player.effects.compressor;

    const compressor = this.audio.createCompressor();
    const nextNode = player.effects.distortion
      ? player.effects.distortion.input
      : player.effects.filter.input;

    // Splice into chain: disconnect EQ→next, insert compressor between
    player.effects.eq.output.disconnect(nextNode);
    player.effects.eq.connect(compressor.input);
    compressor.connect(nextNode);

    player.effects.compressor = compressor;
    return compressor;
  }

  // Lazily create distortion and splice into chain: (Compressor||EQ) → [Distortion] → Filter
  _ensureDistortion(player) {
    if (player.effects.distortion) return player.effects.distortion;

    const distortion = this.audio.createDistortion();
    const prevNode = player.effects.compressor
      ? player.effects.compressor.output
      : player.effects.eq.output;

    // Splice into chain: disconnect prev→filter, insert distortion between
    prevNode.disconnect(player.effects.filter.input);
    prevNode.connect(distortion.input);
    distortion.connect(player.effects.filter.input);

    player.effects.distortion = distortion;
    return distortion;
  }

  // Lazily create ring modulator and splice into chain: Filter → [RingMod] → Delay
  _ensureRingMod(player) {
    if (player.effects.ringmod) return player.effects.ringmod;

    const ringmod = this.audio.createRingMod();

    // Splice into chain: disconnect filter.output→delay.input, insert ringmod
    player.effects.filter.output.disconnect(player.effects.delay.input);
    player.effects.filter.connect(ringmod.input);
    ringmod.connect(player.effects.delay.input);

    player.effects.ringmod = ringmod;
    return ringmod;
  }

  // Lazily create tremolo and splice into chain: Delay → [Tremolo] → Panner
  _ensureTremolo(player) {
    if (player.effects.tremolo) return player.effects.tremolo;

    const tremolo = this.audio.createTremolo();

    // Splice into chain: disconnect delay.output→panner, insert tremolo
    player.effects.delay.output.disconnect(player.effects.panner);
    player.effects.delay.connect(tremolo.input);
    tremolo.connect(player.effects.panner);

    player.effects.tremolo = tremolo;
    return tremolo;
  }

  // Returns the node that feeds into the filter
  _filterPrevNode(player) {
    if (player.effects.distortion) return player.effects.distortion.output;
    if (player.effects.compressor) return player.effects.compressor.output;
    return player.effects.eq.output;
  }

  _changeFilterRolloff(index, player, newRolloff) {
    const filter = player.effects.filter;
    const nextNode = player.effects.ringmod
      ? player.effects.ringmod.input
      : player.effects.delay.input;
    const changed = filter.setRolloff(
      newRolloff,
      this._filterPrevNode(player),
      nextNode,
      this.audio.currentTime
    );
    if (changed) {
      this.state.updateFX(index, 'filter', 'rolloff', newRolloff);
    }
  }

  applyToNode(index, player) {
    if (!player || !player.effects) return;

    const stemState = this.state.getStem(index);
    if (!stemState) return;

    const fx = stemState.fx;
    const currentTime = this.audio.currentTime;

    // EQ
    player.effects.eq.lowShelf.gain.setTargetAtTime(fx.eq.low, currentTime, 0.02);
    player.effects.eq.mid.gain.setTargetAtTime(fx.eq.mid, currentTime, 0.02);
    player.effects.eq.highShelf.gain.setTargetAtTime(fx.eq.high, currentTime, 0.02);

    // Compressor — only instantiate if state differs from defaults
    const cd = DEFAULT_FX_STATE.compressor;
    const hasCompressor = player.effects.compressor ||
      fx.compressor.threshold !== cd.threshold ||
      fx.compressor.knee !== cd.knee ||
      fx.compressor.ratio !== cd.ratio ||
      fx.compressor.attack !== cd.attack ||
      fx.compressor.release !== cd.release;

    if (hasCompressor) {
      const comp = this._ensureCompressor(player).node;
      comp.threshold.setTargetAtTime(fx.compressor.threshold, currentTime, 0.02);
      comp.knee.setTargetAtTime(fx.compressor.knee, currentTime, 0.02);
      comp.ratio.setTargetAtTime(fx.compressor.ratio, currentTime, 0.02);
      comp.attack.setTargetAtTime(fx.compressor.attack, currentTime, 0.02);
      comp.release.setTargetAtTime(fx.compressor.release, currentTime, 0.02);
    }

    // Distortion — only instantiate if state differs from defaults
    const dd = DEFAULT_FX_STATE.distortion;
    const hasDistortion = player.effects.distortion ||
      fx.distortion.drive !== dd.drive ||
      fx.distortion.mix !== dd.mix;

    if (hasDistortion) {
      const dist = this._ensureDistortion(player);
      dist.setCurve(fx.distortion.drive, fx.distortion.tone);
      dist.wet.gain.setTargetAtTime(fx.distortion.mix / 100, currentTime, 0.02);
      dist.dry.gain.setTargetAtTime(1 - fx.distortion.mix / 100, currentTime, 0.02);
    }

    // Ring Modulator — only instantiate if mix > 0
    const rd = DEFAULT_FX_STATE.ringmod;
    const hasRingMod = player.effects.ringmod || fx.ringmod.mix !== rd.mix;

    if (hasRingMod) {
      const rm = this._ensureRingMod(player);
      rm.setFrequency(fx.ringmod.frequency);
      rm.setShape(fx.ringmod.shape);
      rm.wet.gain.setTargetAtTime(fx.ringmod.mix / 100, currentTime, 0.02);
      rm.dry.gain.setTargetAtTime(1 - fx.ringmod.mix / 100, currentTime, 0.02);
    }

    // Tremolo — only instantiate if depth > 0
    const td = DEFAULT_FX_STATE.tremolo;
    const hasTremolo = player.effects.tremolo || fx.tremolo.depth !== td.depth;

    if (hasTremolo) {
      const trem = this._ensureTremolo(player);
      trem.setRate(fx.tremolo.rate);
      trem.setDepth(fx.tremolo.depth / 100);
      trem.setShape(fx.tremolo.shape);
    }

    // Filter - check for rolloff change
    if (fx.filter.rolloff && player.effects.filter.rolloff !== fx.filter.rolloff) {
      this._changeFilterRolloff(index, player, fx.filter.rolloff);
    }

    const filter = player.effects.filter;
    if (filter.setType) {
      filter.setType(fx.filter.type);
      filter.setFrequency(fx.filter.freq, currentTime);
      filter.setQ(fx.filter.resonance, currentTime);
    } else {
      filter.type = fx.filter.type;
      filter.frequency.setTargetAtTime(fx.filter.freq, currentTime, 0.02);
      filter.Q.setTargetAtTime(fx.filter.resonance, currentTime, 0.02);
    }

    // Reverb
    player.effects.reverbSend.gain.setTargetAtTime(fx.reverb.send / 100, currentTime, 0.02);

    // Delay
    player.effects.delay.delayNode.delayTime.setTargetAtTime(fx.delay.time, currentTime, 0.02);
    player.effects.delay.feedback.gain.setTargetAtTime(fx.delay.feedback, currentTime, 0.02);
    player.effects.delay.wet.gain.setTargetAtTime(fx.delay.mix / 100, currentTime, 0.02);

    // Panner
    player.effects.panner.pan.setTargetAtTime(fx.pan, currentTime, 0.02);
  }

  applyAll(players) {
    Object.entries(players).forEach(([index, player]) => {
      this.applyToNode(index, player);
    });
  }

  resetNode(index, player) {
    if (!player || !player.effects) return;

    const currentTime = this.audio.currentTime;
    const { eq: ed, compressor: cd, distortion: dd, ringmod: rd, tremolo: td, filter: fd, reverb: rev, delay: dl, pan: defaultPan } = DEFAULT_FX_STATE;

    player.effects.eq.lowShelf.gain.setTargetAtTime(ed.low, currentTime, 0.02);
    player.effects.eq.mid.gain.setTargetAtTime(ed.mid, currentTime, 0.02);
    player.effects.eq.highShelf.gain.setTargetAtTime(ed.high, currentTime, 0.02);

    // Reset compressor (only if it was instantiated)
    if (player.effects.compressor) {
      const comp = player.effects.compressor.node;
      comp.threshold.setTargetAtTime(cd.threshold, currentTime, 0.02);
      comp.knee.setTargetAtTime(cd.knee, currentTime, 0.02);
      comp.ratio.setTargetAtTime(cd.ratio, currentTime, 0.02);
      comp.attack.setTargetAtTime(cd.attack, currentTime, 0.02);
      comp.release.setTargetAtTime(cd.release, currentTime, 0.02);
    }

    // Reset distortion (only if it was instantiated)
    if (player.effects.distortion) {
      const dist = player.effects.distortion;
      dist.setCurve(dd.drive, dd.tone);
      dist.wet.gain.setTargetAtTime(dd.mix / 100, currentTime, 0.02);
      dist.dry.gain.setTargetAtTime(1 - dd.mix / 100, currentTime, 0.02);
    }

    // Reset ring modulator (only if it was instantiated)
    if (player.effects.ringmod) {
      const rm = player.effects.ringmod;
      rm.setFrequency(rd.frequency);
      rm.setShape(rd.shape);
      rm.wet.gain.setTargetAtTime(rd.mix / 100, currentTime, 0.02);
      rm.dry.gain.setTargetAtTime(1 - rd.mix / 100, currentTime, 0.02);
    }

    // Reset tremolo (only if it was instantiated)
    if (player.effects.tremolo) {
      const trem = player.effects.tremolo;
      trem.setRate(td.rate);
      trem.setDepth(td.depth / 100);
      trem.setShape(td.shape);
    }

    // Reset filter (handle cascaded filters)
    const filter = player.effects.filter;
    if (filter.rolloff !== fd.rolloff) {
      this._changeFilterRolloff(index, player, fd.rolloff);
    }
    if (filter.setType) {
      filter.setType(fd.type);
      filter.setFrequency(fd.freq, currentTime);
      filter.setQ(fd.resonance, currentTime);
    } else {
      filter.type = fd.type;
      filter.frequency.setTargetAtTime(fd.freq, currentTime, 0.02);
      filter.Q.setTargetAtTime(fd.resonance, currentTime, 0.02);
    }

    player.effects.reverbSend.gain.setTargetAtTime(rev.send / 100, currentTime, 0.02);
    player.effects.delay.delayNode.delayTime.setTargetAtTime(dl.time, currentTime, 0.02);
    player.effects.delay.feedback.gain.setTargetAtTime(dl.feedback, currentTime, 0.02);
    player.effects.delay.wet.gain.setTargetAtTime(dl.mix / 100, currentTime, 0.02);
    player.effects.panner.pan.setTargetAtTime(defaultPan, currentTime, 0.02);
  }

}
