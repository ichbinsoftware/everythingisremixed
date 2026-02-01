// ==========================================
// Mixer Holographic Visualizer (Main Thread Bridge)
// ==========================================
//
// This class bridges the main thread and the holographic Web Worker.
// It transfers the canvas to the worker using OffscreenCanvas and
// sends frequency data from the Web Audio analyser on each update.
//
// Flow:
// 1. Constructor transfers canvas control to worker
// 2. update() reads frequency data and sends to worker
// 3. Worker renders 3D "City Landscape" visualization off-main-thread
// ==========================================

export class Holograph {
  constructor(canvas, analyser, themeColor) {
    this.canvas = canvas;
    this.analyser = analyser;
    // Buffer for frequency data (~1KB, reused each frame)
    this.dataBuffer = new Uint8Array(analyser.frequencyBinCount);

    // Check for OffscreenCanvas support
    if (!canvas.transferControlToOffscreen) {
      console.warn('OffscreenCanvas not supported. Visualizer disabled.');
      return;
    }

    try {
      const offscreen = canvas.transferControlToOffscreen();

      // Initialize Worker
      this.worker = new Worker('/assets/app/modules/mixer-holographic-worker.js', { type: 'module' });

      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      this.worker.postMessage({
        type: 'init',
        payload: { canvas: offscreen, themeColor, isLight }
      }, [offscreen]);

      this.pixelRatio = window.devicePixelRatio || 1;
      this.width = 0;
      this.height = 0;

      this.resize();
    } catch (e) {
      console.error('Failed to initialize Holograph Worker:', e);
    }
  }

  resize() {
    if (!this.worker) return;

    const rect = this.canvas.getBoundingClientRect();
    const newWidth = Math.floor(rect.width * this.pixelRatio);
    const newHeight = Math.floor(rect.height * this.pixelRatio);

    if (newWidth !== this.width || newHeight !== this.height) {
      this.width = newWidth;
      this.height = newHeight;

      this.worker.postMessage({
        type: 'resize',
        payload: { width: this.width, height: this.height }
      });
    }
  }

  update() {
    if (!this.analyser || !this.worker) return;

    // Get latest audio data
    this.analyser.getByteFrequencyData(this.dataBuffer);

    // Simple postMessage (buffer is small ~1KB, copy overhead negligible at 30fps)
    this.worker.postMessage({
      type: 'draw',
      payload: { frequency: this.dataBuffer }
    });
  }

  setTheme(isLight) {
    if (!this.worker) return;
    this.worker.postMessage({
      type: 'theme',
      payload: { isLight }
    });
  }

  dispose() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
