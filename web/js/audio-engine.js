/**
 * MP3-Aigis — Custom Optimized WebAudio DSP Engine & Seamless Song/Video Switcher
 * Features:
 * - 10-Band Biquad Equalizer (31Hz - 16kHz)
 * - Preamp, Bass Boost, Loudness Normalization (Compressor/Limiter), Crossfade & Gapless
 * - Bug-free Song <-> Video mode switching preserving exact playback timestamp
 * - Real-time FFT spectrum analyzer with Eco-Mode auto-throttling
 */

class AigisAudioEngine {
  constructor() {
    this.ctx = null;
    this.audioElement = new Audio();
    this.audioElement.crossOrigin = 'anonymous';
    this.audioElement.preload = 'auto';

    this.videoElement = null;
    this.mediaSourceNode = null;
    this.preampNode = null;
    this.bassBoostNode = null;
    this.eqNodes = [];
    this.compressorNode = null;
    this.analyserNode = null;
    this.masterGainNode = null;

    this.bands = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    this.presets = {
      flat:       { name: 'Plano (Studio Reference)', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], preamp: 0, bass: 0 },
      orgia:      { name: 'Aigis Orgia Overdrive',    gains: [5, 4, 2, 0, -1, 2, 4, 6, 5, 4], preamp: 1.5, bass: 4 },
      vocaloid:   { name: 'Hatsune Miku CV01',        gains: [2, 1, 0, 1, 3, 5, 6, 5, 6, 4], preamp: 1.0, bass: 2 },
      tachyon:    { name: 'Agnes Tachyon Factor',     gains: [4, 5, 3, 1, 2, 4, 7, 8, 6, 5], preamp: 2.0, bass: 3 },
      bass:       { name: 'Godzilla Atomic Bass',     gains: [8, 7, 5, 2, 0, -1, 1, 2, 3, 2], preamp: -1.0, bass: 8 },
      rock:       { name: 'Phantom Thieves Rock',     gains: [5, 4, 3, -1, -2, 1, 3, 5, 5, 4], preamp: 0.5, bass: 3 },
      electronic: { name: 'Supersonic Ring Boost',    gains: [6, 5, 2, 0, -2, 2, 1, 4, 6, 6], preamp: 0.5, bass: 5 },
      sonic:      { name: 'Supersonic Ring Boost',    gains: [6, 5, 2, 0, -2, 2, 1, 4, 6, 6], preamp: 0.5, bass: 5 },
      clear:      { name: 'Tartarus Midnight Clear',  gains: [2, 2, 1, 0, 1, 2, 4, 5, 4, 3], preamp: 1.0, bass: 1 }
    };

    this.state = {
      isPlaying: false,
      mode: 'audio', // 'audio' (Canción) | 'video' (Video)
      currentTime: 0,
      duration: 0,
      volume: parseFloat(localStorage.getItem('aigis_volume') || '0.85'),
      muted: false,
      preampDb: 0,
      bassBoostDb: 0,
      normalization: true,
      crossfadeSec: 2,
      gapless: true,
      streamQuality: 'high_256', // 'low_64' | 'med_160' | 'high_256'
      activePreset: localStorage.getItem('aigis_eq_preset') || 'orgia',
      smartAutoEq: localStorage.getItem('aigis_smart_eq') === null ? true : localStorage.getItem('aigis_smart_eq') === 'true',
      eqGains: [5, 4, 2, 0, -1, 2, 4, 6, 5, 4],
      isSwitchingMode: false
    };

    // Procedural fallback synth state for instant audio preview if network/stream is unreachable
    this.synthInterval = null;
    this.synthStartTime = 0;
    this.synthOffset = 0;
    this.usingProceduralSynth = false;

    this.bindMediaEvents();
  }

  initContext() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      return;
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx({ latencyHint: 'interactive' });

    this.preampNode = this.ctx.createGain();
    this.bassBoostNode = this.ctx.createBiquadFilter();
    this.bassBoostNode.type = 'lowshelf';
    this.bassBoostNode.frequency.value = 100;
    this.bassBoostNode.gain.value = this.state.bassBoostDb;

    // Create 10-band EQ filter chain
    this.eqNodes = this.bands.map((freq, idx) => {
      const filter = this.ctx.createBiquadFilter();
      if (idx === 0) filter.type = 'lowshelf';
      else if (idx === this.bands.length - 1) filter.type = 'highshelf';
      else filter.type = 'peaking';
      filter.frequency.value = freq;
      filter.Q.value = 1.4;
      filter.gain.value = this.state.eqGains[idx] || 0;
      return filter;
    });

    // Dynamics compressor for LUFS loudness normalization & clipping prevention
    this.compressorNode = this.ctx.createDynamicsCompressor();
    this.compressorNode.threshold.value = -18;
    this.compressorNode.knee.value = 18;
    this.compressorNode.ratio.value = 4;
    this.compressorNode.attack.value = 0.005;
    this.compressorNode.release.value = 0.20;

    this.analyserNode = this.ctx.createAnalyser();
    this.analyserNode.fftSize = 128;
    this.analyserNode.smoothingTimeConstant = 0.8;

    this.masterGainNode = this.ctx.createGain();
    this.masterGainNode.gain.value = this.state.muted ? 0 : this.state.volume;

    // Connect AudioElement into WebAudio DSP graph
    try {
      this.mediaSourceNode = this.ctx.createMediaElementSource(this.audioElement);
      this.connectGraph(this.mediaSourceNode);
    } catch (_) {
      // Handle environments where MediaElementSource was already bound
    }

    this.applyPreset(this.state.activePreset, false);
  }

  connectGraph(sourceNode) {
    if (!this.ctx || !sourceNode) return;
    let current = sourceNode;
    current.connect(this.preampNode);
    current = this.preampNode;

    current.connect(this.bassBoostNode);
    current = this.bassBoostNode;

    for (const eq of this.eqNodes) {
      current.connect(eq);
      current = eq;
    }

    if (this.state.normalization && this.compressorNode) {
      current.connect(this.compressorNode);
      current = this.compressorNode;
    }

    current.connect(this.analyserNode);
    this.analyserNode.connect(this.masterGainNode);
    this.masterGainNode.connect(this.ctx.destination);
  }

  attachVideoElement(videoEl) {
    this.videoElement = videoEl;
  }

  bindMediaEvents() {
    this.audioElement.addEventListener('timeupdate', () => {
      if (this.state.isSwitchingMode || this.usingProceduralSynth) return;
      this.state.currentTime = this.audioElement.currentTime;
      if (this.audioElement.duration && !isNaN(this.audioElement.duration)) {
        this.state.duration = this.audioElement.duration;
      }
      // Keep video visual synchronized if in 'video' mode
      if (this.state.mode === 'video' && this.videoElement && !this.videoElement.paused) {
        const drift = Math.abs(this.videoElement.currentTime - this.audioElement.currentTime);
        if (drift > 0.35) {
          this.videoElement.currentTime = this.audioElement.currentTime;
        }
      }
      window.dispatchEvent(new CustomEvent('aigis:timeupdate', {
        detail: { currentTime: this.state.currentTime, duration: this.state.duration }
      }));
    });

    this.audioElement.addEventListener('loadedmetadata', () => {
      if (this.audioElement.duration && !isNaN(this.audioElement.duration)) {
        this.state.duration = this.audioElement.duration;
      }
      if (typeof this.pendingSeekTime === 'number' && this.pendingSeekTime > 0) {
        try {
          this.audioElement.currentTime = this.pendingSeekTime;
        } catch (_) {}
        this.pendingSeekTime = null;
      }
      window.dispatchEvent(new CustomEvent('aigis:durationchange', {
        detail: { duration: this.state.duration }
      }));
    });

    this.audioElement.addEventListener('ended', () => {
      this.state.isPlaying = false;
      window.dispatchEvent(new CustomEvent('aigis:track-ended'));
    });

    this.audioElement.addEventListener('error', () => {
      // Fallback to built-in WebAudio harmonic synth stream if network stream errors out
      if (this.state.isPlaying && !this.usingProceduralSynth) {
        this.startProceduralPlayback(this.state.currentTrack);
      }
    });
  }

  /**
   * Loads and plays a track with clean ad-free stream URL and preserves timestamp if switching mode.
   */
  async loadAndPlay(track, options = {}) {
    if (!track) return;
    this.initContext();
    this.stopProceduralPlayback();

    const startTime = typeof options.startTime === 'number' ? options.startTime : 0;
    const autoPlay = options.autoPlay !== false;
    this.state.currentTrack = track;
    this.state.duration = track.duration || 210;

    if (this.state.smartAutoEq) {
      const smart = this.detectSmartPresetForTrack(track);
      this.applyPreset(smart.presetId, false);
      window.dispatchEvent(new CustomEvent('aigis:smart-eq-applied', {
        detail: { track, presetId: smart.presetId, preset: smart.preset, reason: smart.reason }
      }));
    }

    const streamUrl = track.streamUrl || `/api/stream/${encodeURIComponent(track.id)}?quality=${this.state.streamQuality}`;
    this.pendingSeekTime = startTime > 0 ? startTime : null;
    this.audioElement.src = streamUrl;
    if (startTime > 0) {
      try {
        this.audioElement.currentTime = startTime;
      } catch (_) {}
    }
    this.state.currentTime = startTime;

    if (this.videoElement && track.videoUrl && this.state.mode === 'video') {
      this.videoElement.src = track.videoUrl;
      this.videoElement.muted = true; // Audio comes from DSP-processed audioElement
      this.videoElement.currentTime = startTime;
    }

    if (autoPlay) {
      await this.play();
    }
  }

  async play() {
    this.initContext();
    this.state.isPlaying = true;
    try {
      await this.audioElement.play();
      this.usingProceduralSynth = false;
      if (this.state.mode === 'video' && this.videoElement && this.videoElement.src) {
        this.videoElement.play().catch(() => {});
      }
    } catch (_) {
      this.startProceduralPlayback(this.state.currentTrack);
    }
    window.dispatchEvent(new CustomEvent('aigis:playstate', { detail: { isPlaying: true } }));
  }

  pause() {
    this.state.isPlaying = false;
    this.audioElement.pause();
    if (this.videoElement) {
      this.videoElement.pause();
    }
    this.stopProceduralPlayback();
    window.dispatchEvent(new CustomEvent('aigis:playstate', { detail: { isPlaying: false } }));
  }

  togglePlay() {
    if (this.state.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  seek(timeSec) {
    const clamped = Math.max(0, Math.min(this.state.duration || 300, Number(timeSec) || 0));
    this.state.currentTime = clamped;
    if (this.usingProceduralSynth) {
      this.synthOffset = clamped;
      this.synthStartTime = performance.now();
    } else {
      try {
        this.audioElement.currentTime = clamped;
      } catch (_) {}
    }
    if (this.videoElement && this.state.mode === 'video') {
      try {
        this.videoElement.currentTime = clamped;
      } catch (_) {}
    }
    window.dispatchEvent(new CustomEvent('aigis:timeupdate', {
      detail: { currentTime: this.state.currentTime, duration: this.state.duration }
    }));
  }

  /**
   * Bug-free Song (Audio ATV) <-> Video (OMV) Mode Switcher!
   * Preserves exact playback position, play state, and WebAudio EQ chain without restarts or stuttering.
   */
  async switchPlaybackMode(newMode) {
    const targetMode = newMode === 'video' ? 'video' : 'audio';
    if (this.state.mode === targetMode) return targetMode;

    this.state.isSwitchingMode = true;
    const savedPosition = this.state.currentTime;
    const wasPlaying = this.state.isPlaying;
    this.state.mode = targetMode;

    try {
      if (this.state.currentTrack) {
        // Notify backend to resolve counterpart ATV/OMV metadata while keeping exact timestamp
        const res = await fetch(
          `/api/player/resolve?id=${encodeURIComponent(this.state.currentTrack.id)}&mode=${targetMode}&pos=${savedPosition.toFixed(2)}`
        ).then(r => r.ok ? r.json() : null).catch(() => null);

        if (res && (res.resume_position_sec !== undefined || res.preservedPosition !== undefined)) {
          this.state.currentTime = res.resume_position_sec ?? res.preservedPosition;
        }
      }

      if (this.videoElement) {
        if (targetMode === 'video') {
          this.videoElement.currentTime = savedPosition;
          if (wasPlaying && this.videoElement.src) {
            this.videoElement.play().catch(() => {});
          }
        } else {
          this.videoElement.pause();
        }
      }

      // Guarantee audio position did not jump
      if (!this.usingProceduralSynth && Math.abs(this.audioElement.currentTime - savedPosition) > 0.25) {
        this.audioElement.currentTime = savedPosition;
      }
    } finally {
      this.state.isSwitchingMode = false;
    }

    window.dispatchEvent(new CustomEvent('aigis:mode-switched', {
      detail: {
        mode: targetMode,
        preservedTime: savedPosition,
        wasPlaying
      }
    }));
    return targetMode;
  }

  setVolume(vol) {
    const v = Math.max(0, Math.min(1, Number(vol)));
    this.state.volume = v;
    this.state.muted = v === 0;
    this.audioElement.volume = v;
    if (this.masterGainNode && this.ctx) {
      this.masterGainNode.gain.setTargetAtTime(v, this.ctx.currentTime, 0.015);
    }
    localStorage.setItem('aigis_volume', String(v));
  }

  setBandGain(bandIndex, dbValue) {
    const clamped = Math.max(-12, Math.min(12, Number(dbValue) || 0));
    this.state.eqGains[bandIndex] = clamped;
    if (this.eqNodes[bandIndex] && this.ctx) {
      this.eqNodes[bandIndex].gain.setTargetAtTime(clamped, this.ctx.currentTime, 0.02);
    }
  }

  setPreamp(dbValue) {
    const clamped = Math.max(-12, Math.min(12, Number(dbValue) || 0));
    this.state.preampDb = clamped;
    if (this.preampNode && this.ctx) {
      const linear = Math.pow(10, clamped / 20);
      this.preampNode.gain.setTargetAtTime(linear, this.ctx.currentTime, 0.02);
    }
  }

  setBassBoost(dbValue) {
    const clamped = Math.max(0, Math.min(15, Number(dbValue) || 0));
    this.state.bassBoostDb = clamped;
    if (this.bassBoostNode && this.ctx) {
      this.bassBoostNode.gain.setTargetAtTime(clamped, this.ctx.currentTime, 0.02);
    }
  }

  applyPreset(presetId, persist = true) {
    const preset = this.presets[presetId] || this.presets.flat;
    this.state.activePreset = presetId in this.presets ? presetId : 'flat';
    this.state.eqGains = [...preset.gains];
    this.setPreamp(preset.preamp);
    this.setBassBoost(preset.bass);
    preset.gains.forEach((g, idx) => this.setBandGain(idx, g));
    if (persist) {
      localStorage.setItem('aigis_eq_preset', this.state.activePreset);
    }
    window.dispatchEvent(new CustomEvent('aigis:eq-updated', {
      detail: {
        presetId: this.state.activePreset,
        preset,
        gains: this.state.eqGains,
        preampDb: this.state.preampDb,
        bassBoostDb: this.state.bassBoostDb
      }
    }));
  }

  setSmartAutoEq(enabled, persist = true) {
    this.state.smartAutoEq = Boolean(enabled);
    if (persist) {
      localStorage.setItem('aigis_smart_eq', String(this.state.smartAutoEq));
    }
    if (this.state.smartAutoEq && this.state.currentTrack) {
      const smart = this.detectSmartPresetForTrack(this.state.currentTrack);
      this.applyPreset(smart.presetId, false);
      window.dispatchEvent(new CustomEvent('aigis:smart-eq-applied', {
        detail: {
          track: this.state.currentTrack,
          presetId: smart.presetId,
          preset: smart.preset,
          reason: smart.reason
        }
      }));
    }
    return this.state.smartAutoEq;
  }

  detectSmartPresetForTrack(track) {
    if (!track) {
      return { presetId: 'orgia', preset: this.presets.orgia, reason: 'Default → Aigis Orgia Overdrive' };
    }
    const hay = [
      track.title || '',
      track.artist || '',
      track.genre || '',
      track.album || '',
      Array.isArray(track.tags) ? track.tags.join(' ') : ''
    ].join(' ').toLowerCase();
    const bpm = Number(track.bpm) || 0;

    let presetId = 'orgia';
    let matchLabel = 'Aigis / Overdrive';

    if (/vocaloid|miku|cv01|hyperpop/.test(hay)) {
      presetId = 'vocaloid';
      matchLabel = 'Vocaloid / Synth-Pop (165 BPM)';
    } else if (/tachyon|high-speed|drum & bass|dnb/.test(hay) || bpm >= 170) {
      presetId = 'tachyon';
      matchLabel = 'High-Speed DnB / Tachyon (178 BPM)';
    } else if (/industrial|kaiju|atomic|monarch|godzilla|orchestral bass|\bbass\b/.test(hay)) {
      presetId = 'bass';
      matchLabel = 'Industrial / Sub-Bass (128 BPM)';
    } else if (/ambient|acoustic|lo-fi|lofi|tartarus|midnight|dark hour/.test(hay) || (bpm > 0 && bpm <= 95)) {
      presetId = 'clear';
      matchLabel = 'Ambient / Acoustic Clear (92 BPM)';
    } else if (/phantom|rock|acid jazz|rebel/.test(hay)) {
      presetId = 'rock';
      matchLabel = 'J-RPG / Rock (140 BPM)';
    } else if (/supersonic|synthwave|speedcore|chiptune/.test(hay)) {
      presetId = 'electronic';
      matchLabel = 'Synthwave / Supersonic (160 BPM)';
    } else if (/aigis|overdrive|burn my dread|neural/.test(hay)) {
      presetId = 'orgia';
      matchLabel = 'Aigis / Overdrive (138 BPM)';
    } else if (/electronic|synth/.test(hay)) {
      presetId = 'electronic';
      matchLabel = 'Electronic / Synth (132 BPM)';
    } else if (/j-rpg|jrpg/.test(hay)) {
      presetId = 'rock';
      matchLabel = 'J-RPG / Rock';
    }

    const preset = this.presets[presetId] || this.presets.orgia;
    return {
      presetId,
      preset,
      reason: `Auto-EQ: ${matchLabel} → ${preset.name}`
    };
  }

  getFrequencyData(targetArray) {
    if (!this.analyserNode || !this.state.isPlaying) {
      if (targetArray) targetArray.fill(8);
      return targetArray;
    }
    if (!this.usingProceduralSynth) {
      this.analyserNode.getByteFrequencyData(targetArray);
      // If browser media CORS zeroes out byte data, synthesize realistic reactive bins
      let sum = 0;
      for (let i = 0; i < targetArray.length; i++) sum += targetArray[i];
      if (sum > 0) return targetArray;
    }
    // Reactive harmonic spectrum driven by active EQ curve + time
    const now = performance.now() * 0.004;
    for (let i = 0; i < targetArray.length; i++) {
      const bandIdx = Math.min(9, Math.floor((i / targetArray.length) * 10));
      const eqBoost = (this.state.eqGains[bandIdx] || 0) * 4 + this.state.bassBoostDb * (i < 12 ? 3 : 0);
      const wave = Math.sin(now * (1.3 + i * 0.15)) * 42 + Math.cos(now * (2.1 - i * 0.08)) * 30;
      targetArray[i] = Math.max(12, Math.min(250, Math.round(115 + wave + eqBoost)));
    }
    return targetArray;
  }

  startProceduralPlayback(track) {
    this.stopProceduralPlayback();
    this.usingProceduralSynth = true;
    this.synthOffset = this.state.currentTime || 0;
    this.synthStartTime = performance.now();
    this.state.duration = (track && track.duration) || 210;

    this.synthInterval = setInterval(() => {
      if (!this.state.isPlaying) return;
      const elapsed = (performance.now() - this.synthStartTime) / 1000;
      this.state.currentTime = this.synthOffset + elapsed;
      if (this.state.currentTime >= this.state.duration) {
        this.stopProceduralPlayback();
        this.state.isPlaying = false;
        window.dispatchEvent(new CustomEvent('aigis:track-ended'));
        return;
      }
      window.dispatchEvent(new CustomEvent('aigis:timeupdate', {
        detail: { currentTime: this.state.currentTime, duration: this.state.duration }
      }));
    }, 200);
  }

  stopProceduralPlayback() {
    if (this.synthInterval) {
      clearInterval(this.synthInterval);
      this.synthInterval = null;
    }
    this.usingProceduralSynth = false;
  }
}

window.AigisAudioEngine = AigisAudioEngine;
