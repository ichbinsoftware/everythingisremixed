// ==========================================
// Mixer Stem Loader
// ==========================================

import { BATCH_SIZE } from './mixer-constants.js';

export class StemLoader {
  constructor(audioEngine, mixerState, isMobile) {
    this.audioEngine = audioEngine;
    this.mixerState = mixerState;
    this.isMobile = isMobile;
  }

  async loadStems(stemConfig, trackConfig, callbacks = {}) {
    const { onProgress, onPlayerLoaded } = callbacks;
    const players = {};
    const meters = {};
    
    if (!trackConfig || !stemConfig.length) return { players, meters };

    let totalDownloaded = 0;
    let totalSize = 0;

    const batchSize = this.isMobile ? BATCH_SIZE.mobile : BATCH_SIZE.desktop;

    for (let i = 0; i < stemConfig.length; i += batchSize) {
      const batch = stemConfig.slice(i, i + batchSize);

      await Promise.all(batch.map(async (stem, batchIndex) => {
        const index = i + batchIndex;
        let filename = stem.filename;
        if (this.isMobile) filename = filename.replace(/\.m4a$/i, '_mobile.m4a');
        const url = `/${trackConfig.id}/${encodeURIComponent(filename)}?v=2`;

        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error('Network response was not ok');

          const contentLength = response.headers.get('content-length');
          const stemSize = contentLength ? parseInt(contentLength, 10) : 0;
          totalSize += stemSize;

          const reader = response.body.getReader();
          const chunks = [];
          let receivedBytes = 0;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            chunks.push(value);
            receivedBytes += value.length;
            totalDownloaded += value.length;

            if (onProgress) {
              onProgress({
                stemName: stem.name,
                receivedBytes,
                stemSize,
                totalDownloaded,
                totalSize
              });
            }
          }

          const blob = new Blob(chunks);
          const blobUrl = URL.createObjectURL(blob);

          // Create audio element
          const audioEl = document.createElement('audio');
          audioEl.crossOrigin = 'anonymous';
          audioEl.preload = 'auto';
          audioEl.loop = false;
          audioEl.preservesPitch = true; // Prevent pitch shift during playback rate nudging
          if (this.isMobile) {
            audioEl.setAttribute('playsinline', '');
            audioEl.setAttribute('webkit-playsinline', '');
          }

          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject('timeout'), 45000);
            const onReady = () => { clearTimeout(timeout); resolve(); };
            audioEl.addEventListener('canplaythrough', onReady, { once: true });
            audioEl.addEventListener('error', () => reject('error'), { once: true });
            audioEl.src = blobUrl;
            audioEl.load();
          });

          // Decoder warm-up: Seek to middle of file then back to start
          // Forces browser to prepare AAC decoder, avoiding stalls when
          // stems with leading silence start playing
          if (!this.isMobile) {
            const warmupTime = audioEl.duration / 2;
            audioEl.currentTime = warmupTime;
            await new Promise(r => setTimeout(r, 50));
            audioEl.currentTime = 0;
          }

          // Create audio nodes
          const source = this.audioEngine.context.createMediaElementSource(audioEl);
          const gainNode = this.audioEngine.context.createGain();
          gainNode.gain.value = this.mixerState.getStem(index).volume;

          const eq = this.audioEngine.createEQ();
          const filter = this.audioEngine.createFilter(); // Default -12dB rolloff
          const delay = this.audioEngine.createDelay();
          const panner = this.audioEngine.createPanner();

          // Reverb send: Simple gain node to shared master reverb
          // Performance: Previous design had predelay + lowcut + highcut per stem
          // (4 nodes each). Simplified to 1 node for better CPU usage.
          const reverbSendGain = this.audioEngine.context.createGain();
          reverbSendGain.gain.value = 0; // Default: no reverb
          reverbSendGain.connect(this.audioEngine.masterReverb.input);

          const reverbSend = { gain: reverbSendGain };

          source.connect(eq.input);
          eq.connect(filter.input);
          filter.connect(delay.input);
          delay.connect(panner);
          panner.connect(gainNode);
          panner.connect(reverbSend.gain);
          gainNode.connect(this.audioEngine.analyser);

          // Create meter
          const meter = this.audioEngine.createMeter();
          gainNode.connect(meter);
          meters[index] = meter;

          const player = {
            audioElement: audioEl,
            blob: blob,
            blobUrl: blobUrl,
            source: source,
            gainNode: gainNode,
            effects: { eq, filter, delay, panner, reverbSend },
            loaded: true,
            name: stem.name,
            color: stem.color
          };

          players[index] = player;
          
          if (onPlayerLoaded) {
            onPlayerLoaded(index, player, meters[index]);
          }

        } catch (e) {
          console.error(`Error loading stem ${stem.name}:`, e);
        }
      }));

      // Small delay between batches to allow UI updates
      await new Promise(r => setTimeout(r, this.isMobile ? 500 : 50));
    }

    return { players, meters };
  }
}
