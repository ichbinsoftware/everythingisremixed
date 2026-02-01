// ==========================================
// Mixer Transport Controller (Synchronized)
// ==========================================

// Helpers for float comparison
const RATE_EPSILON = 0.0001;
const isRateNormal = (rate) => Math.abs(rate - 1.0) < RATE_EPSILON;
const ratesEqual = (a, b) => Math.abs(a - b) < RATE_EPSILON;

export class TransportController {
  constructor(audioEngine) {
    this.audio = audioEngine;
    this.players = {};
    this.isPlaying = false;
    this.pauseTime = 0;
    this.duration = 0;
    this.onStateChange = null;
    this.onProgress = null;
    this.cachedLeader = null;
    this.nudgingStems = new Set();
  }

  setPlayers(players) {
    this.players = players;
    this.cachedLeader = null; // Invalidate leader cache
    this.nudgingStems.clear();
    this.duration = 0;

    Object.values(players).forEach(p => {
      if (p.audioElement && p.audioElement.duration > this.duration) {
        this.duration = p.audioElement.duration;
      }
    });
  }

  // Cached leader getter
  get leader() {
    if (!this.cachedLeader) {
      this.cachedLeader = this.getLeader();
    }
    return this.cachedLeader;
  }

  // Identify the best "Master Clock" stem based on rhythm priority
  getLeader() {
    const players = Object.values(this.players);
    if (!players.length) return null;

    let bestCandidate = players[0];
    let bestScore = -1;

    // Regex patterns for rhythm detection (Higher score = Better timekeeper)
    const patterns = [
      { regex: /kick/i, score: 100 },
      { regex: /main.*drums|drums.*main/i, score: 90 },
      { regex: /drums/i, score: 80 },
      { regex: /beat/i, score: 70 },
      { regex: /perc|prc/i, score: 60 },
      { regex: /hh|hats|hihat/i, score: 50 },
      { regex: /clap|snare/i, score: 40 },
      { regex: /bass/i, score: 20 }
    ];

    players.forEach(p => {
      let score = 0;
      for (const pattern of patterns) {
        if (pattern.regex.test(p.name)) {
          score = Math.max(score, pattern.score);
        }
      }
      
      // Tie-breaker: Prefer lower index (usually main stems are exported first)
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = p;
      }
    });

    return bestCandidate;
  }

  async play() {
    const players = Object.values(this.players);
    if (!players.length) return;

    // 1. Resume Audio Context (Critical for iOS)
    await this.audio.resume();

    // 2. Optimistic Start: Fire all immediately
    players.forEach(p => {
      // Ensure we start from the correct pause time
      if (Math.abs(p.audioElement.currentTime - this.pauseTime) > 0.1) {
        p.audioElement.currentTime = this.pauseTime;
      }
      
      p.audioElement.play().catch(e => {
        if (e.name !== 'AbortError') console.warn(e);
      });
    });

    this.isPlaying = true;
    // Sync is now handled by animation loop in mixer-app.js

    if (this.onStateChange) this.onStateChange('playing');
  }

  pause() {
    // 1. Reset playback rates and clear nudging state
    this.resetPlaybackRates();

    // 2. Pause all immediately
    Object.values(this.players).forEach(p => {
      p.audioElement.pause();
    });

    // 3. Capture accurate pause time from Leader
    const leader = this.leader;
    if (leader) {
      this.pauseTime = leader.audioElement.currentTime;
    } else if (Object.keys(this.players).length > 0) {
      this.pauseTime = Object.values(this.players)[0].audioElement.currentTime;
    }

    this.isPlaying = false;
    if (this.onStateChange) this.onStateChange('paused');
  }

  stop() {
    this.resetPlaybackRates();

    Object.values(this.players).forEach(p => {
      p.audioElement.pause();
      p.audioElement.currentTime = 0;
    });

    this.pauseTime = 0;
    this.isPlaying = false;
    if (this.onStateChange) this.onStateChange('stopped');
  }

  async seek(time) {
    this.pauseTime = Math.max(0, Math.min(time, this.duration));
    const wasPlaying = this.isPlaying;

    if (wasPlaying) {
      this.resetPlaybackRates(); // Reset rates while seeking
      Object.values(this.players).forEach(p => p.audioElement.pause());
    }

    // Set time on all players
    Object.values(this.players).forEach(p => {
      p.audioElement.currentTime = this.pauseTime;
    });

    if (wasPlaying) {
      await this.play();
    }

    if (this.onProgress) this.onProgress(this.pauseTime, this.duration);
  }

  skipBack(seconds = 10) {
    this.seek(this.getCurrentTime() - seconds);
  }

  skipForward(seconds = 10) {
    this.seek(this.getCurrentTime() + seconds);
  }

  restart() {
    this.seek(0);
    if (!this.isPlaying) this.play();
  }

  getCurrentTime() {
    if (this.isPlaying && Object.keys(this.players).length > 0) {
      return this.leader?.audioElement?.currentTime || this.pauseTime;
    }
    return this.pauseTime;
  }

  getProgress() {
    if (this.duration === 0) return 0;
    return this.getCurrentTime() / this.duration;
  }

  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  }

  getFormattedCurrentTime() {
    return this.formatTime(this.getCurrentTime());
  }

  getFormattedDuration() {
    return this.formatTime(this.duration);
  }

  // ==========================================
  // Sync Management (Playback Rate Nudging)
  // ==========================================

  // Reset all playback rates to normal and clear nudging state
  resetPlaybackRates() {
    this.nudgingStems.clear();
    Object.values(this.players).forEach(p => {
      if (p.audioElement && !isRateNormal(p.audioElement.playbackRate)) {
        p.audioElement.playbackRate = 1.0;
      }
    });
  }

  // Called from animation loop in mixer-app.js
  syncCheck() {
    if (!this.isPlaying) return;

    const leader = this.leader;
    if (!leader) return;

    const leaderTime = leader.audioElement.currentTime;

    // Thresholds (with hysteresis to prevent oscillation)
    const EXIT_THRESHOLD = 0.005;   // 5ms - stop nudging when this close
    const ENTER_THRESHOLD = 0.020;  // 20ms - start nudging when this far
    const HARD_SYNC_THRESHOLD = 0.5; // 500ms - hard resync if this far

    Object.values(this.players).forEach(p => {
      if (p === leader) {
        // Ensure leader runs at normal speed
        if (!isRateNormal(p.audioElement.playbackRate)) {
          p.audioElement.playbackRate = 1.0;
        }
        return;
      }

      const diff = p.audioElement.currentTime - leaderTime;
      const absDiff = Math.abs(diff);

      // Extreme drift - hard resync (likely a stall/buffer issue)
      if (absDiff > HARD_SYNC_THRESHOLD) {
        p.audioElement.currentTime = leaderTime;
        p.audioElement.playbackRate = 1.0;
        this.nudgingStems.delete(p);
        return;
      }

      const isNudging = this.nudgingStems.has(p);

      if (isNudging && absDiff < EXIT_THRESHOLD) {
        // Close enough - stop nudging
        p.audioElement.playbackRate = 1.0;
        this.nudgingStems.delete(p);
      } else if (absDiff > ENTER_THRESHOLD || isNudging) {
        // Apply nudge (two-tier: 0.2% for small drift, 0.5% for larger)
        const newRate = diff < 0
          ? (absDiff > 0.05 ? 1.005 : 1.002)  // Behind - speed up
          : (absDiff > 0.05 ? 0.995 : 0.998); // Ahead - slow down

        if (!ratesEqual(p.audioElement.playbackRate, newRate)) {
          p.audioElement.playbackRate = newRate;
          this.nudgingStems.add(p);
        }
      }
      // else: in dead zone (5-20ms) - do nothing
    });
  }

}
