// ==========================================
// Mixer Animation & Loop Manager
// Handles throttled updates for UI and visualizers
// ==========================================

export class AnimationManager {
  constructor() {
    this.tasks = new Map();
    this.isRunning = false;
    this.rafId = null;
    this._loop = this._loop.bind(this);
  }

  /**
   * Register a task to run in the loop.
   * @param {string} id - Unique identifier for the task
   * @param {Function} callback - Function to execute
   * @param {number} fps - Target frames per second
   * @param {Function} [condition] - Optional function that must return true for the task to run
   */
  add(id, callback, fps, condition = null) {
    this.tasks.set(id, {
      callback,
      interval: 1000 / fps,
      lastRun: 0,
      condition
    });
  }

  remove(id) {
    this.tasks.delete(id);
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.rafId = requestAnimationFrame(this._loop);
  }

  stop() {
    this.isRunning = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  _loop(now) {
    if (!this.isRunning) return;

    this.tasks.forEach((task) => {
      // Skip if condition exists and returns false
      if (task.condition && !task.condition()) return;

      // Check if enough time has passed for the target FPS
      if (now - task.lastRun >= task.interval) {
        task.callback(now);
        
        // Update lastRun, correcting for drift but capping to current time
        // to prevent "catch-up" bursts if the tab was backgrounded.
        task.lastRun = Math.max(now - task.interval, task.lastRun + task.interval);
      }
    });

    this.rafId = requestAnimationFrame(this._loop);
  }
}
