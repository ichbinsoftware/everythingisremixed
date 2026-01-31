// ==========================================
// Mixer FX Controller (Modal)
// ==========================================

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

    // Reverb send
    this._bindSlider(content, 'reverb-send', index, val => {
      this.state.updateFX(index, 'reverb', 'send', val);
      player.effects.reverbSend.gain.gain.setTargetAtTime(val / 100, currentTime(), 0.02);
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

  _changeFilterRolloff(index, player, newRolloff) {
    const filter = player.effects.filter;
    const changed = filter.setRolloff(
      newRolloff,
      player.effects.eq.output,
      player.effects.delay.input,
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
    player.effects.reverbSend.gain.gain.setTargetAtTime(fx.reverb.send / 100, currentTime, 0.02);

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

    player.effects.eq.lowShelf.gain.setTargetAtTime(0, currentTime, 0.02);
    player.effects.eq.mid.gain.setTargetAtTime(0, currentTime, 0.02);
    player.effects.eq.highShelf.gain.setTargetAtTime(0, currentTime, 0.02);

    // Reset filter (handle cascaded filters)
    const filter = player.effects.filter;
    if (filter.rolloff !== -12) {
      // Reset to default -12dB rolloff
      this._changeFilterRolloff(index, player, -12);
    }
    if (filter.setType) {
      filter.setType('lowpass');
      filter.setFrequency(20000, currentTime);
      filter.setQ(1, currentTime);
    } else {
      filter.type = 'lowpass';
      filter.frequency.setTargetAtTime(20000, currentTime, 0.02);
      filter.Q.setTargetAtTime(1, currentTime, 0.02);
    }

    player.effects.reverbSend.gain.gain.setTargetAtTime(0, currentTime, 0.02);
    player.effects.delay.delayNode.delayTime.setTargetAtTime(0.375, currentTime, 0.02);
    player.effects.delay.feedback.gain.setTargetAtTime(0.3, currentTime, 0.02);
    player.effects.delay.wet.gain.setTargetAtTime(0, currentTime, 0.02);
    player.effects.panner.pan.setTargetAtTime(0, currentTime, 0.02);
  }

}
