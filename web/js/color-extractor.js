/**
 * MP3-Aigis — Dynamic Cover Color Extractor & Theme Telemetry Engine
 * Ultra-low resource 32x32 pixel quantization with LRU caching and 7 Thematic HUD Profiles.
 */

class AigisColorAndThemeEngine {
  constructor() {
    this.cache = new Map();
    this.maxCacheSize = 64;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 32;
    this.canvas.height = 32;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

    this.dynamicColorEnabled = true;
    this.currentTheme = localStorage.getItem('aigis_theme') || 'aigis';
    this.currentLayout = localStorage.getItem('aigis_layout') || 'hybrid';
    this.ecoMode = localStorage.getItem('aigis_eco_mode') === 'true';
    this.activePalette = { primary: '#38bdf8', secondary: '#1e40af', accent: '#f59e0b' };

    // Thematic metadata for the 7 requested themes
    this.themes = {
      aigis: {
        id: 'aigis',
        name: 'Aigis (Persona 3)',
        subtitle: '7th Gen Anti-Shadow Weapon // Orgia Mode HUD',
        hudTag: 'AIGIS-OS v7.4 // PAPILLON HEART ONLINE',
        defaultColors: { primary: '#38bdf8', secondary: '#1e40af', accent: '#f59e0b' },
        eqPreset: 'orgia'
      },
      persona3: {
        id: 'persona3',
        name: 'Persona 3 Reload',
        subtitle: 'Dark Hour // Tartarus Midnight Cyan Glass',
        hudTag: 'DARK HOUR 00:00 // FULL MOON PHASE',
        defaultColors: { primary: '#00d4ff', secondary: '#0a192f', accent: '#7dd3fc' },
        eqPreset: 'clear'
      },
      persona5: {
        id: 'persona5',
        name: 'Persona 5 (Phone UI)',
        subtitle: 'Phantom Thieves IM & Metaverse Rebels',
        hudTag: 'METAVERSE NAV // TAKE YOUR HEART',
        defaultColors: { primary: '#e60012', secondary: '#111111', accent: '#ffffff' },
        eqPreset: 'rock'
      },
      sonic: {
        id: 'sonic',
        name: 'Sonic the Hedgehog',
        subtitle: 'Supersonic Cobalt & Golden Ring Boost HUD',
        hudTag: 'MACH 1.0 BOOST // RING ENERGY 100%',
        defaultColors: { primary: '#0066ff', secondary: '#002b80', accent: '#ffd700' },
        eqPreset: 'electronic'
      },
      miku: {
        id: 'miku',
        name: 'Hatsune Miku (CV01)',
        subtitle: 'Vocaloid Cyber-Teal & Synthesizer Matrix',
        hudTag: 'CV01 DIGITAL DIVA // 39.00 Hz SYNC',
        defaultColors: { primary: '#39c5bb', secondary: '#0f292f', accent: '#ff2a85' },
        eqPreset: 'vocaloid'
      },
      godzilla: {
        id: 'godzilla',
        name: 'Godzilla (Kaiju Atomic)',
        subtitle: 'Cherenkov Radiation Blue & Monarch Radar',
        hudTag: 'MONARCH OUTPOST 54 // ATOMIC PULSE DETECTED',
        defaultColors: { primary: '#00f0ff', secondary: '#071318', accent: '#ff9900' },
        eqPreset: 'bass'
      },
      tachyon: {
        id: 'tachyon',
        name: 'Agnes Tachyon',
        subtitle: 'Tachyon Particles // Bioluminescent Lab HUD',
        hudTag: 'LAB EXP #2001 // PLANCK SPEED LIMIT BREAK',
        defaultColors: { primary: '#39ff14', secondary: '#064e3b', accent: '#f59e0b' },
        eqPreset: 'tachyon'
      }
    };
  }

  init() {
    this.setTheme(this.currentTheme, false);
    this.setLayout(this.currentLayout, false);
    this.setEcoMode(this.ecoMode, false);
  }

  setTheme(themeId, persist = true) {
    const theme = this.themes[themeId] || this.themes.aigis;
    this.currentTheme = theme.id;
    document.body.setAttribute('data-theme', theme.id);
    if (persist) {
      localStorage.setItem('aigis_theme', theme.id);
    }

    // Update HUD labels if present
    const hudNodes = document.querySelectorAll('[data-hud-telemetry]');
    hudNodes.forEach(node => {
      node.textContent = theme.hudTag;
    });

    if (!this.dynamicColorEnabled) {
      this.applyPalette(theme.defaultColors);
    }

    window.dispatchEvent(new CustomEvent('aigis:theme-changed', { detail: theme }));
    return theme;
  }

  setLayout(layoutId, persist = true) {
    const valid = ['hybrid', 'ytmusic', 'spotify', 'custom'];
    const target = valid.includes(layoutId) ? layoutId : 'hybrid';
    this.currentLayout = target;
    document.body.setAttribute('data-layout', target);
    if (persist) {
      localStorage.setItem('aigis_layout', target);
    }
    window.dispatchEvent(new CustomEvent('aigis:layout-changed', { detail: { layout: target } }));
    return target;
  }

  setEcoMode(enabled, persist = true) {
    this.ecoMode = Boolean(enabled);
    document.body.classList.toggle('eco-mode', this.ecoMode);
    if (persist) {
      localStorage.setItem('aigis_eco_mode', String(this.ecoMode));
    }
    window.dispatchEvent(new CustomEvent('aigis:eco-changed', { detail: { ecoMode: this.ecoMode } }));
  }

  setDynamicColorEnabled(enabled) {
    this.dynamicColorEnabled = Boolean(enabled);
    document.body.setAttribute('data-dynamic-color', String(this.dynamicColorEnabled));
    if (!this.dynamicColorEnabled) {
      const theme = this.themes[this.currentTheme] || this.themes.aigis;
      this.applyPalette(theme.defaultColors);
    }
  }

  /**
   * Extracts dominant vibrant colors from a track's artwork or falls back to deterministic track colors.
   */
  async extractFromTrack(track) {
    if (!this.dynamicColorEnabled || !track) {
      const theme = this.themes[this.currentTheme] || this.themes.aigis;
      this.applyPalette(theme.defaultColors);
      return theme.defaultColors;
    }

    const cacheKey = track.id || track.cover || track.title;
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      // Refresh LRU order in O(1)
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, cached);
      this.applyPalette(cached);
      return cached;
    }

    // If track carries explicit palette hints from backend or SVG data URI
    if (track.palette && track.palette.primary) {
      this.rememberPalette(cacheKey, track.palette);
      this.applyPalette(track.palette);
      return track.palette;
    }

    if (track.cover) {
      try {
        const palette = await this.sampleImageColors(track.cover);
        this.rememberPalette(cacheKey, palette);
        this.applyPalette(palette);
        return palette;
      } catch (_) {
        // Fallback to deterministic hash palette if CORS blocks raw pixel read
      }
    }

    const fallback = this.generateDeterministicPalette(track.title || track.id || 'aigis');
    this.rememberPalette(cacheKey, fallback);
    this.applyPalette(fallback);
    return fallback;
  }

  sampleImageColors(imageUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      img.onload = () => {
        try {
          this.ctx.clearRect(0, 0, 32, 32);
          this.ctx.drawImage(img, 0, 0, 32, 32);
          const data = this.ctx.getImageData(0, 0, 32, 32).data;

          let rSum = 0, gSum = 0, bSum = 0, count = 0;
          let maxSat = -1;
          let accentR = 56, accentG = 189, accentB = 248;

          for (let i = 0; i < data.length; i += 16) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];
            if (a < 128) continue;

            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const l = (max + min) / 2;
            const sat = max === min ? 0 : (max - min) / (255 - Math.abs(2 * l - 255));

            // Ignore pure black or pure white pixels
            if (l > 20 && l < 240) {
              rSum += r;
              gSum += g;
              bSum += b;
              count++;
              if (sat > maxSat) {
                maxSat = sat;
                accentR = r;
                accentG = g;
                accentB = b;
              }
            }
          }

          if (count === 0) {
            reject(new Error('No vibrant pixels'));
            return;
          }

          const avgR = Math.round(rSum / count);
          const avgG = Math.round(gSum / count);
          const avgB = Math.round(bSum / count);

          resolve({
            primary: this.rgbToHex(accentR, accentG, accentB),
            secondary: this.rgbToHex(Math.round(avgR * 0.45), Math.round(avgG * 0.45), Math.round(avgB * 0.45)),
            accent: this.rgbToHex(
              Math.min(255, Math.round(accentR * 1.15)),
              Math.min(255, Math.round(accentG * 1.15)),
              Math.min(255, Math.round(accentB * 1.15))
            )
          });
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = reject;
      img.src = imageUrl;
    });
  }

  generateDeterministicPalette(seedStr) {
    let hash = 0;
    for (let i = 0; i < seedStr.length; i++) {
      hash = seedStr.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h1 = Math.abs(hash) % 360;
    const h2 = (h1 + 45) % 360;
    return {
      primary: this.hslToHex(h1, 82, 56),
      secondary: this.hslToHex(h1, 65, 18),
      accent: this.hslToHex(h2, 90, 64)
    };
  }

  hslToHex(h, s, l) {
    const sNorm = s / 100;
    const lNorm = l / 100;
    const k = n => (n + h / 30) % 12;
    const a = sNorm * Math.min(lNorm, 1 - lNorm);
    const f = n => lNorm - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return this.rgbToHex(Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4)));
  }

  applyPalette(palette) {
    if (!palette) return;
    this.activePalette = {
      primary: palette.primary || '#38bdf8',
      secondary: palette.secondary || '#1e40af',
      accent: palette.accent || '#f59e0b'
    };
    const root = document.documentElement;
    root.style.setProperty('--song-color-primary', this.activePalette.primary);
    root.style.setProperty('--song-color-secondary', this.activePalette.secondary);
    root.style.setProperty('--song-color-accent', this.activePalette.accent);

    const rgbPrimary = this.hexToRgbString(this.activePalette.primary);
    const rgbSecondary = this.hexToRgbString(this.activePalette.secondary);
    const rgbAccent = this.hexToRgbString(this.activePalette.accent);
    if (rgbPrimary) root.style.setProperty('--song-rgb-primary', rgbPrimary);
    if (rgbSecondary) root.style.setProperty('--song-rgb-secondary', rgbSecondary);
    if (rgbAccent) root.style.setProperty('--song-rgb-accent', rgbAccent);

    window.dispatchEvent(new CustomEvent('aigis:palette-updated', { detail: this.activePalette }));
  }

  rememberPalette(key, palette) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxCacheSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    this.cache.set(key, palette);
  }

  rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('');
  }

  hexToRgbString(hex) {
    if (!hex || !hex.startsWith('#') || (hex.length !== 7 && hex.length !== 4)) return null;
    let c = hex.substring(1);
    if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
    const num = parseInt(c, 16);
    return `${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}`;
  }
}

window.AigisColorAndThemeEngine = AigisColorAndThemeEngine;
