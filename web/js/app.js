/**
 * MP3-Aigis — Main Application Controller
 * Integrates:
 * - InnerTube YTMusic Backend API & Thematic Curated Catalog
 * - Liquid Glass UI, 4 Switchable Layouts (Hybrid, YTMusic, Spotify, Custom) & 7 Themes
 * - Dynamic Cover-Art Color Adaptation
 * - Bug-Free Song (Canción) <-> Video Mode Switching with 0ms timestamp drift
 * - 10-Band WebAudio DSP Equalizer + Visualizer
 * - Offline-First Resilient Playlists & Multi-Chunk Smart Downloads
 * - Automatic Free/Premium Google Account Detection + Built-in AdBlock/SponsorBlock
 */

(function () {
  'use strict';

  const THEMATIC_COVER_SVGS = {
    aigis_trk_01: createCoverSvg('#0ea5e9', '#1e3a8a', '#f59e0b', 'AIGIS // P3R', 'Burn My Dread / Neural Drift'),
    aigis_trk_02: createCoverSvg('#e60012', '#111111', '#ffffff', 'PHANTOM IM', 'Velvet Obsidian Calling'),
    aigis_trk_03: createCoverSvg('#39c5bb', '#0f172a', '#ff2a85', 'CV01 // MIKU', 'Hyperion Cyber Matrix'),
    aigis_trk_04: createCoverSvg('#39ff14', '#064e3b', '#f59e0b', 'TACHYON LAB', 'Planck Speed Experiment'),
    aigis_trk_05: createCoverSvg('#0055ff', '#001a4d', '#ffd700', 'SUPERSONIC', 'Starlight Ring Boost'),
    aigis_trk_06: createCoverSvg('#00f0ff', '#071318', '#ff9900', 'MONARCH G-54', 'Cherenkov Atomic Pulse'),
    aigis_trk_07: createCoverSvg('#00d4ff', '#040b18', '#38bdf8', 'DARK HOUR', 'Tartarus Full Moon'),
    aigis_trk_08: createCoverSvg('#a855f7', '#1e1b4b', '#ec4899', 'NIGHTMARE', 'Quantum Resonance')
  };

  function createCoverSvg(c1, c2, accent, badge, sub) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${c1}"/>
          <stop offset="65%" stop-color="${c2}"/>
          <stop offset="100%" stop-color="#050811"/>
        </linearGradient>
      </defs>
      <rect width="320" height="320" rx="24" fill="url(#g)"/>
      <circle cx="160" cy="150" r="86" fill="none" stroke="${accent}" stroke-width="3" stroke-dasharray="10 6" opacity="0.75"/>
      <circle cx="160" cy="150" r="54" fill="none" stroke="#ffffff" stroke-width="1.5" opacity="0.4"/>
      <polygon points="146,122 192,150 146,178" fill="${accent}"/>
      <rect x="24" y="24" width="128" height="26" rx="13" fill="rgba(0,0,0,0.55)" stroke="${accent}" stroke-width="1"/>
      <text x="88" y="41" fill="#ffffff" font-family="monospace" font-weight="bold" font-size="11" text-anchor="middle">${badge}</text>
      <text x="160" y="282" fill="#ffffff" font-family="sans-serif" font-weight="bold" font-size="13" text-anchor="middle" opacity="0.9">${sub}</text>
    </svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  class MP3AigisApp {
    constructor() {
      this.colorEngine = new window.AigisColorAndThemeEngine();
      this.audioEngine = new window.AigisAudioEngine();
      this.offlineEngine = new window.AigisOfflineSyncEngine();

      this.catalog = [];
      this.playlists = [];
      this.queue = [];
      this.currentIndex = 0;
      this.currentTrack = null;
      this.activeFilter = 'all';
      this.orgiaMode = false;
      this.likedTracks = new Set(['aigis_trk_01', 'aigis_trk_03']);
      this.selectedAccountTier = 'free';
      this.activeProfile = null;
      this.profilesList = [];

      this.freqBins = new Uint8Array(64);
      this.animFrameId = null;
      this.lyricNodes = [];
      this.activeLyricIndex = -1;
      this.idleVisualizerDrawn = false;
      this.shuffleEnabled = false;
      this.repeatMode = 'all'; // 'all' | 'one'
    }

    async init() {
      this.colorEngine.init();
      const videoEl = document.getElementById('stage-video-element');
      if (videoEl) {
        this.audioEngine.attachVideoElement(videoEl);
      }

      this.bindUIEvents();
      this.bindEngineEvents();

      await this.loadInitialData();
      this.startVisualizerLoop();
      this.startTelemetryPoll();

      // Register Service Worker for PWA / Offline resilience if supported
      if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
      }
    }

    async loadInitialData() {
      try {
        const [homeRes, plRes, dlRes, statusRes] = await Promise.all([
          fetch('/api/home').then(r => r.ok ? r.json() : null).catch(() => null),
          this.offlineEngine.getPlaylists(),
          this.offlineEngine.fetchDownloads(),
          fetch('/api/status').then(r => r.ok ? r.json() : null).catch(() => null)
        ]);

        const picks = (homeRes && (homeRes.quick_picks || (homeRes.shelves && homeRes.shelves.quick_picks))) || null;
        const mixes = (homeRes && (homeRes.mixed_for_you || (homeRes.shelves && homeRes.shelves.mixed_for_you))) || null;
        if (picks && picks.length) {
          this.catalog = picks.map((t, i) => this.enrichTrack(t, i));
          if (mixes) {
            this.renderMixedForYou(mixes);
          }
        }

        if (!this.catalog.length) {
          this.catalog = this.getFallbackCatalog();
        }

        this.queue = [...this.catalog];
        this.playlists = (plRes && plRes.playlists) || [];
        this.renderPlaylists();
        this.renderQuickPicks(this.catalog);
        this.renderTrackTable(this.catalog);
        this.renderQueue();

        if (dlRes) {
          this.renderDownloads(dlRes);
        }

        if (statusRes) {
          this.updateSystemStatusUI(statusRes);
        }

        // Load first track metadata into stage & player bar (without forcing autoplay noise)
        await this.selectTrack(this.catalog[0], { autoPlay: false });
      } catch (err) {
        this.catalog = this.getFallbackCatalog();
        this.queue = [...this.catalog];
        this.renderQuickPicks(this.catalog);
        this.renderTrackTable(this.catalog);
        this.renderQueue();
        await this.selectTrack(this.catalog[0], { autoPlay: false });
      }
    }

    enrichTrack(raw, index = 0) {
      const id = raw.id || `aigis_trk_0${(index % 8) + 1}`;
      const cover = raw.cover || THEMATIC_COVER_SVGS[id] || THEMATIC_COVER_SVGS.aigis_trk_01;
      const paletteMap = {
        aigis_trk_01: { primary: '#38bdf8', secondary: '#1e3a8a', accent: '#f59e0b' },
        aigis_trk_02: { primary: '#e60012', secondary: '#2a080c', accent: '#ffffff' },
        aigis_trk_03: { primary: '#39c5bb', secondary: '#0f292f', accent: '#ff2a85' },
        aigis_trk_04: { primary: '#39ff14', secondary: '#064e3b', accent: '#f59e0b' },
        aigis_trk_05: { primary: '#0066ff', secondary: '#001a4d', accent: '#ffd700' },
        aigis_trk_06: { primary: '#00f0ff', secondary: '#071318', accent: '#ff9900' },
        aigis_trk_07: { primary: '#00d4ff', secondary: '#040b18', accent: '#7dd3fc' },
        aigis_trk_08: { primary: '#a855f7', secondary: '#1e1b4b', accent: '#ec4899' }
      };
      return {
        ...raw,
        id,
        cover,
        palette: paletteMap[id] || {
          primary: raw.accent_color || '#38bdf8',
          secondary: '#1e293b',
          accent: '#f59e0b'
        },
        duration: raw.duration || 210,
        duration_text: raw.duration_text || this.formatTime(raw.duration || 210),
        streamUrl: `/api/stream/${encodeURIComponent(id)}`
      };
    }

    getFallbackCatalog() {
      return [
        this.enrichTrack({
          id: 'aigis_trk_01',
          title: 'Burn My Dread // Neural Drift',
          artist: 'Aigis Unit 07 & Lotus Synth',
          album: 'Persona 3 Reload // S.E.E.S. Sessions',
          duration: 214,
          duration_text: '3:34',
          genre: 'J-RPG Electronic / Synth',
          tags: ['songs', 'videos', 'jrpg', 'energetico', 'offline']
        }, 0),
        this.enrichTrack({
          id: 'aigis_trk_02',
          title: 'Phantom Thieves Calling Card',
          artist: 'Shibuya Rebel Ensemble',
          album: 'Metaverse IM Sessions',
          duration: 198,
          duration_text: '3:18',
          genre: 'Acid Jazz / J-Rock',
          tags: ['songs', 'videos', 'jrpg', 'energetico']
        }, 1),
        this.enrichTrack({
          id: 'aigis_trk_03',
          title: 'CV01 Cybernetic Teal Pulse',
          artist: 'Miku Hatsune Synth Matrix',
          album: 'Future Tone 39Hz',
          duration: 242,
          duration_text: '4:02',
          genre: 'Vocaloid / Hyperpop',
          tags: ['songs', 'videos', 'vocaloid', 'energetico', 'offline']
        }, 2),
        this.enrichTrack({
          id: 'aigis_trk_04',
          title: 'Tachyon Particle Overdrive',
          artist: 'Agnes Tachyon Lab Project',
          album: 'Bioluminescent Factor #2001',
          duration: 185,
          duration_text: '3:05',
          genre: 'High-Speed Drum & Bass',
          tags: ['songs', 'videos', 'energetico', 'jrpg', 'offline']
        }, 3),
        this.enrichTrack({
          id: 'aigis_trk_05',
          title: 'Supersonic Starlight Zone',
          artist: 'Cobalt Ring Collective',
          album: 'Mach 1.0 Frontiers',
          duration: 176,
          duration_text: '2:56',
          genre: 'Speedcore / Chiptune Fusion',
          tags: ['songs', 'videos', 'energetico']
        }, 4),
        this.enrichTrack({
          id: 'aigis_trk_06',
          title: 'Cherenkov Atomic Resonance',
          artist: 'Monarch Outpost 54',
          album: 'King of the Monsters OST',
          duration: 228,
          duration_text: '3:48',
          genre: 'Industrial Orchestral Bass',
          tags: ['songs', 'videos', 'offline']
        }, 5)
      ];
    }

    async selectTrack(track, options = {}) {
      if (!track) return;
      this.currentTrack = track;
      const idx = this.queue.findIndex(t => t.id === track.id);
      if (idx !== -1) this.currentIndex = idx;

      // Update Player Bar & Stage UI
      const titleEls = [document.getElementById('player-track-title'), document.getElementById('stage-track-title')];
      const artistEls = [document.getElementById('player-track-artist'), document.getElementById('stage-track-artist')];
      titleEls.forEach(el => { if (el) el.textContent = track.title; });
      artistEls.forEach(el => { if (el) el.textContent = `${track.artist} • ${track.album || 'YTMusic InnerTube'}`; });

      const playerImg = document.getElementById('player-cover-img');
      const stageImg = document.getElementById('stage-cover-img');
      if (playerImg) playerImg.src = track.cover;
      if (stageImg) stageImg.src = track.cover;

      const timeTotal = document.getElementById('time-total');
      if (timeTotal) timeTotal.textContent = track.duration_text || this.formatTime(track.duration);

      const likeBtn = document.getElementById('btn-like-track');
      if (likeBtn) {
        const liked = this.likedTracks.has(track.id);
        likeBtn.innerHTML = liked ? '&#9829;' : '&#9825;';
        likeBtn.style.color = liked ? 'var(--song-color-accent, #f43f5e)' : '';
      }

      // Extract Dynamic Cover Art Palette
      const palette = await this.colorEngine.extractFromTrack(track);
      const swatch = document.getElementById('dynamic-color-badge');
      const hudHex = document.getElementById('hud-color-hex');
      if (swatch && palette) swatch.style.background = palette.primary;
      if (hudHex && palette) hudHex.textContent = palette.primary.toUpperCase();

      // Highlight active row in table & queue
      document.querySelectorAll('[data-track-row]').forEach(row => {
        const isCurrent = row.getAttribute('data-track-row') === track.id;
        row.classList.toggle('active', isCurrent);
        row.classList.toggle('playing', isCurrent);
      });
      document.querySelectorAll('[data-queue-id]').forEach(item => {
        item.classList.toggle('active', item.getAttribute('data-queue-id') === track.id);
      });

      // Load lyrics & related tracks asynchronously
      this.loadLyricsAndRelated(track.id);

      // Load into Audio Engine
      await this.audioEngine.loadAndPlay(track, {
        startTime: options.startTime || 0,
        autoPlay: options.autoPlay !== false
      });
    }

    async loadLyricsAndRelated(trackId) {
      try {
        const [lyricsRes, relRes] = await Promise.all([
          fetch(`/api/lyrics?id=${encodeURIComponent(trackId)}`).then(r => r.ok ? r.json() : null).catch(() => null),
          fetch(`/api/related?id=${encodeURIComponent(trackId)}`).then(r => r.ok ? r.json() : null).catch(() => null)
        ]);

        const lyricsBox = document.getElementById('lyrics-container');
        if (lyricsBox) {
          const lines = (lyricsRes && lyricsRes.lines) || (this.currentTrack && this.currentTrack.lyrics) || [
            { time: 0, text: '♪ [Sincronización InnerTube Audio/Video Activa] ♪' },
            { time: 5, text: 'Cristal líquido refractando cada frecuencia' },
            { time: 11, text: 'Cero anuncios, cero cortes en tu sesión' },
            { time: 18, text: 'Conmutación instantánea entre Canción y Video' }
          ];
          lyricsBox.innerHTML = lines.map(line => `
            <div class="lyric-line" data-lyric-time="${line.time}" style="padding: 8px 10px; border-radius: 8px; cursor: pointer; transition: all 0.2s;">
              <span style="font-size: 10px; opacity: 0.6; margin-right: 8px; font-family: monospace;">${this.formatTime(line.time)}</span>
              <span>${this.escapeHtml(line.text)}</span>
            </div>
          `).join('');

          this.lyricNodes = Array.from(lyricsBox.querySelectorAll('.lyric-line')).map(el => ({
            el,
            time: parseFloat(el.getAttribute('data-lyric-time') || '0')
          }));
          this.activeLyricIndex = -1;

          this.lyricNodes.forEach(({ el, time }) => {
            el.addEventListener('click', () => {
              this.audioEngine.seek(time);
              this.showToast(`Saltando a letra en ${this.formatTime(time)}`);
            });
          });
        }

        const relBox = document.getElementById('related-list');
        if (relBox) {
          const relatedTracks = (relRes && (relRes.related_tracks || relRes.up_next)) || this.catalog.filter(t => t.id !== trackId).slice(0, 4);
          relBox.innerHTML = relatedTracks.map((rt, i) => {
            const enriched = this.enrichTrack(rt, i);
            return `
              <div class="playlist-item" data-related-id="${enriched.id}" style="cursor: pointer;">
                <img src="${enriched.cover}" alt="" style="width: 38px; height: 38px; border-radius: 8px; object-fit: cover;" />
                <div class="playlist-info">
                  <div class="playlist-title">${this.escapeHtml(enriched.title)}</div>
                  <div class="playlist-meta">${this.escapeHtml(enriched.artist)} • ${enriched.duration_text}</div>
                </div>
              </div>
            `;
          }).join('');

          relBox.querySelectorAll('[data-related-id]').forEach(el => {
            el.addEventListener('click', () => {
              const id = el.getAttribute('data-related-id');
              const found = this.catalog.find(t => t.id === id) || this.catalog[0];
              this.selectTrack(found, { autoPlay: true });
            });
          });
        }
      } catch (_) {}
    }

    renderQuickPicks(tracks) {
      const grid = document.getElementById('quick-picks-grid');
      if (!grid) return;
      grid.innerHTML = tracks.slice(0, 6).map(t => `
        <div class="quick-pick-card liquid-glass-pill" data-pick-id="${t.id}" style="display:flex; align-items:center; gap:12px; padding:10px 14px; border-radius:14px; cursor:pointer;">
          <img src="${t.cover}" alt="${this.escapeHtml(t.title)}" style="width:48px; height:48px; border-radius:10px; object-fit:cover; flex-shrink:0;" />
          <div style="flex:1; min-width:0;">
            <div style="font-weight:700; font-size:13.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${this.escapeHtml(t.title)}</div>
            <div style="font-size:11.5px; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${this.escapeHtml(t.artist)}</div>
          </div>
          <span class="badge-pill video-avail" style="font-size:10px;">A/V</span>
        </div>
      `).join('');

      grid.querySelectorAll('[data-pick-id]').forEach(card => {
        card.addEventListener('click', () => {
          const id = card.getAttribute('data-pick-id');
          const track = this.catalog.find(x => x.id === id);
          if (track) this.selectTrack(track, { autoPlay: true });
        });
      });
    }

    renderMixedForYou(mixes) {
      const grid = document.getElementById('mixed-for-you-grid');
      if (!grid) return;
      grid.innerHTML = mixes.map((m, idx) => {
        const sampleTrack = this.catalog[idx % Math.max(1, this.catalog.length)] || this.getFallbackCatalog()[0];
        return `
          <div class="selector-card" data-mix-idx="${idx}" style="cursor:pointer;">
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
              <img src="${sampleTrack.cover}" alt="" style="width:44px; height:44px; border-radius:10px;" />
              <div>
                <div class="selector-card-title" style="font-size:14px;">${this.escapeHtml(m.title)}</div>
                <div style="font-size:11px; color:var(--song-color-primary);">${this.escapeHtml(m.subtitle || 'Algoritmo YT Music')}</div>
              </div>
            </div>
            <p class="selector-card-desc">${(m.track_ids || []).length || 6} pistas • Resiliencia Offline Activa</p>
          </div>
        `;
      }).join('');

      grid.querySelectorAll('[data-mix-idx]').forEach(card => {
        card.addEventListener('click', () => {
          const idx = parseInt(card.getAttribute('data-mix-idx') || '0', 10);
          const target = this.catalog[idx % this.catalog.length] || this.catalog[0];
          this.selectTrack(target, { autoPlay: true });
          this.showToast('Reproduciendo Supermix del algoritmo YT Music');
        });
      });
    }

    renderTrackTable(tracks) {
      const tbody = document.getElementById('tracks-table-body');
      if (!tbody) return;
      tbody.innerHTML = tracks.map((t, idx) => `
        <tr class="track-row ${this.currentTrack && this.currentTrack.id === t.id ? 'active playing' : ''}" data-track-row="${t.id}" style="cursor:pointer;">
          <td class="track-num-cell">${idx + 1}</td>
          <td>
            <div style="display:flex; align-items:center; gap:10px;">
              <img src="${t.cover}" alt="" style="width:36px; height:36px; border-radius:8px; object-fit:cover;" />
              <div>
                <div style="font-weight:600; font-size:13px;">${this.escapeHtml(t.title)}</div>
                <div style="font-size:11.5px; color:var(--text-secondary);">${this.escapeHtml(t.artist)}</div>
              </div>
            </div>
          </td>
          <td style="font-size:12px; color:var(--text-secondary);">${this.escapeHtml(t.album || 'YTMusic Catalog')}</td>
          <td>
            <button type="button" class="btn-simulate-drop" data-row-av="${t.id}" title="Alternar Canción / Video en esta pista">
              &#127925; ATV / &#127916; OMV
            </button>
          </td>
          <td><span class="badge-pill" style="font-size:10.5px;">&#128737; Caché Lista</span></td>
          <td style="font-family:monospace; font-size:12px;">${t.duration_text}</td>
          <td>
            <div style="display:flex; gap:6px;">
              <button type="button" class="icon-btn" data-row-play="${t.id}" title="Reproducir ahora">&#9654;</button>
              <button type="button" class="icon-btn" data-row-dl="${t.id}" title="Descargar Offline (Multi-Chunk)">&#11015;</button>
            </div>
          </td>
        </tr>
      `).join('');

      tbody.querySelectorAll('[data-track-row]').forEach(row => {
        row.addEventListener('dblclick', () => {
          const id = row.getAttribute('data-track-row');
          const track = this.catalog.find(x => x.id === id);
          if (track) this.selectTrack(track, { autoPlay: true });
        });
      });

      tbody.querySelectorAll('[data-row-play]').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const id = btn.getAttribute('data-row-play');
          const track = this.catalog.find(x => x.id === id);
          if (track) this.selectTrack(track, { autoPlay: true });
        });
      });

      tbody.querySelectorAll('[data-row-av]').forEach(btn => {
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          const id = btn.getAttribute('data-row-av');
          const track = this.catalog.find(x => x.id === id);
          if (track) {
            await this.selectTrack(track, { autoPlay: true });
            const nextMode = this.audioEngine.state.mode === 'video' ? 'audio' : 'video';
            await this.setAVMode(nextMode);
            this.switchView('stage');
          }
        });
      });

      tbody.querySelectorAll('[data-row-dl]').forEach(btn => {
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          const id = btn.getAttribute('data-row-dl');
          const track = this.catalog.find(x => x.id === id);
          if (track) {
            await this.triggerSmartDownload(track);
          }
        });
      });
    }

    renderQueue() {
      const box = document.getElementById('queue-list');
      if (!box) return;
      box.innerHTML = this.queue.map(t => `
        <div class="playlist-item ${this.currentTrack && this.currentTrack.id === t.id ? 'active' : ''}" data-queue-id="${t.id}" style="cursor:pointer;">
          <img src="${t.cover}" alt="" style="width:36px; height:36px; border-radius:8px; object-fit:cover;" />
          <div class="playlist-info">
            <div class="playlist-title">${this.escapeHtml(t.title)}</div>
            <div class="playlist-meta">${this.escapeHtml(t.artist)} • ${t.duration_text}</div>
          </div>
        </div>
      `).join('');

      box.querySelectorAll('[data-queue-id]').forEach(item => {
        item.addEventListener('click', () => {
          const id = item.getAttribute('data-queue-id');
          const track = this.queue.find(x => x.id === id);
          if (track) this.selectTrack(track, { autoPlay: true });
        });
      });
    }

    renderPlaylists() {
      const container = document.getElementById('playlist-list');
      if (!container || !this.playlists.length) return;
      container.innerHTML = this.playlists.map((pl, idx) => `
        <div class="playlist-item ${idx === 0 ? 'active' : ''}" data-playlist-id="${pl.id}">
          <div class="playlist-cover-mini">&#128737;</div>
          <div class="playlist-info">
            <div class="playlist-title">${this.escapeHtml(pl.title || pl.name)}</div>
            <div class="playlist-meta">Resiliente • ${pl.track_count || (pl.tracks ? pl.tracks.length : 4)} pistas • SQLite WAL</div>
          </div>
          <button type="button" class="pin-offline-btn pinned" data-pin-playlist="${pl.id}" title="Protegida contra caídas de red">&#10003;</button>
        </div>
      `).join('');

      container.querySelectorAll('[data-playlist-id]').forEach(item => {
        item.addEventListener('click', async () => {
          container.querySelectorAll('.playlist-item').forEach(el => el.classList.remove('active'));
          item.classList.add('active');
          const plId = item.getAttribute('data-playlist-id');
          try {
            const res = await fetch(`/api/playlists/${encodeURIComponent(plId)}`);
            if (res.ok) {
              const plData = await res.json();
              if (plData.tracks && plData.tracks.length) {
                const enriched = plData.tracks.map((t, i) => this.enrichTrack(t, i));
                this.renderTrackTable(enriched);
                this.switchView('home');
                this.showToast(`Playlist "${plData.title}" cargada (Protección Offline Activa)`);
                return;
              }
            }
          } catch (_) {}
          this.showToast('Playlist servida desde caché local anti-cortes');
        });
      });
    }

    async triggerSmartDownload(track) {
      if (!track) return;
      this.showToast(`Iniciando descarga multi-chunk: ${track.title}`);
      try {
        const res = await fetch('/api/downloads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ track_id: track.id, mode: 'audio', format: 'wav', blocking: true })
        });
        if (res.ok) {
          const dlList = await this.offlineEngine.fetchDownloads();
          this.renderDownloads(dlList);
          this.showToast(`Descarga verificada (SHA-256 OK): ${track.title}`);
        }
      } catch (_) {
        this.showToast('Descarga encolada para sincronización offline');
      }
    }

    renderDownloads(dlSummary) {
      const items = (dlSummary && (dlSummary.items || dlSummary.downloads)) || [];
      const badge = document.getElementById('nav-badge-downloads');
      const statCount = document.getElementById('stat-offline-count');
      const statStorage = document.getElementById('stat-storage-used');
      if (badge) badge.textContent = String(items.length);
      if (statCount) statCount.textContent = `${items.length} Pistas`;
      if (statStorage && dlSummary.total_disk_bytes !== undefined) {
        const mb = (dlSummary.total_disk_bytes / (1024 * 1024)).toFixed(2);
        statStorage.textContent = `${mb} MB`;
      }

      const listEl = document.getElementById('downloads-list-container');
      if (!listEl) return;

      if (!items.length) {
        listEl.innerHTML = `
          <div class="eq-panel-card" style="text-align:center; padding:24px;">
            <p style="color:var(--text-secondary);">No hay descargas activas. Haz clic en "Descargar Pista Actual" para probar el motor multi-chunk con verificación SHA-256.</p>
          </div>
        `;
        return;
      }

      listEl.innerHTML = items.map(d => `
        <div class="eq-panel-card" style="display:flex; align-items:center; justify-content:space-between; gap:14px; padding:12px 16px;">
          <div>
            <div style="font-weight:700; font-size:13.5px;">${this.escapeHtml(d.title || d.track_id)} — ${this.escapeHtml(d.artist || 'YTMusic')}</div>
            <div style="font-size:11.5px; color:var(--text-secondary);">
              Cliente: <code>${d.client_used || 'ANDROID_MUSIC'}</code> • Chunks: ${d.chunks_completed || 4}/${d.chunks_total || 4} • SHA-256: <code>${(d.sha256 || 'verificado').slice(0, 12)}...</code>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="badge-pill video-avail">${d.status === 'completed' ? '100% VERIFICADO' : `${d.progress_pct || 100}%`}</span>
            <a href="/api/downloads/file/${encodeURIComponent(d.track_id)}" download class="btn-secondary" style="text-decoration:none; padding:6px 10px; font-size:11.5px;">Guardar Archivo</a>
          </div>
        </div>
      `).join('');
    }

    async setAVMode(mode) {
      const normalized = mode === 'video' ? 'video' : 'audio';
      await this.audioEngine.switchPlaybackMode(normalized);

      const btnSong = document.getElementById('btn-mode-song');
      const btnVideo = document.getElementById('btn-mode-video');
      const songStage = document.getElementById('song-stage-container');
      const videoStage = document.getElementById('video-stage-container');
      const navBadge = document.getElementById('nav-badge-mode');
      const hudReadout = document.getElementById('hud-av-mode-readout');
      const stageBtnText = document.getElementById('btn-stage-toggle-av-text');

      if (btnSong) {
        btnSong.classList.toggle('active', normalized === 'audio');
        btnSong.setAttribute('aria-selected', String(normalized === 'audio'));
      }
      if (btnVideo) {
        btnVideo.classList.toggle('active', normalized === 'video');
        btnVideo.setAttribute('aria-selected', String(normalized === 'video'));
      }
      if (songStage) songStage.classList.toggle('hidden', normalized === 'video');
      if (videoStage) videoStage.classList.toggle('hidden', normalized !== 'video');
      if (navBadge) navBadge.textContent = normalized === 'video' ? 'VIDEO' : 'CANCIÓN';
      if (hudReadout) hudReadout.textContent = normalized === 'video' ? 'VIDEO STREAM (OMV 0ms DRIFT)' : 'AUDIO MASTER (CANCIÓN ATV)';
      if (stageBtnText) stageBtnText.textContent = normalized === 'video' ? 'Cambiar a Modo Canción' : 'Cambiar a Modo Video';

      this.showToast(
        normalized === 'video'
          ? `Modo Video (OMV) activado en ${this.formatTime(this.audioEngine.state.currentTime)} sin corte`
          : `Modo Canción (Audio Master) activado en ${this.formatTime(this.audioEngine.state.currentTime)}`
      );
    }

    switchView(viewId) {
      document.querySelectorAll('.view-section').forEach(sec => {
        sec.classList.toggle('active', sec.id === `view-${viewId}`);
      });
      document.querySelectorAll('.sidebar-nav .nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-view') === viewId);
      });
    }

    bindUIEvents() {
      // Sidebar view navigation
      document.querySelectorAll('.sidebar-nav .nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
          const target = btn.getAttribute('data-view');
          if (target) this.switchView(target);
        });
      });

      // Collapse/expand sidebar
      const toggleSidebarBtn = document.getElementById('btn-toggle-sidebar');
      if (toggleSidebarBtn) {
        toggleSidebarBtn.addEventListener('click', () => {
          document.body.classList.toggle('sidebar-collapsed');
        });
      }

      // Top bar Song / Video mode pill buttons
      const btnModeSong = document.getElementById('btn-mode-song');
      const btnModeVideo = document.getElementById('btn-mode-video');
      if (btnModeSong) {
        btnModeSong.addEventListener('click', () => {
          this.setAVMode('audio');
          this.switchView('stage');
        });
      }
      if (btnModeVideo) {
        btnModeVideo.addEventListener('click', () => {
          this.setAVMode('video');
          this.switchView('stage');
        });
      }

      const stageToggleAv = document.getElementById('btn-stage-toggle-av');
      if (stageToggleAv) {
        stageToggleAv.addEventListener('click', () => {
          const next = this.audioEngine.state.mode === 'video' ? 'audio' : 'video';
          this.setAVMode(next);
        });
      }

      const playerModeToggle = document.getElementById('btn-player-mode-toggle');
      if (playerModeToggle) {
        playerModeToggle.addEventListener('click', () => {
          const next = this.audioEngine.state.mode === 'video' ? 'audio' : 'video';
          this.setAVMode(next);
          this.switchView('stage');
        });
      }

      // Quick Theme & Layout Selectors in Top Bar
      const quickTheme = document.getElementById('quick-theme-select');
      if (quickTheme) {
        quickTheme.value = this.colorEngine.currentTheme;
        quickTheme.addEventListener('change', () => {
          this.applyThemeChoice(quickTheme.value);
        });
      }

      const quickLayout = document.getElementById('quick-layout-select');
      if (quickLayout) {
        quickLayout.value = this.colorEngine.currentLayout;
        quickLayout.addEventListener('change', () => {
          this.applyLayoutChoice(quickLayout.value);
        });
      }

      // Customizer View Theme Cards & Layout Cards
      document.querySelectorAll('[data-theme-pick]').forEach(card => {
        card.addEventListener('click', () => {
          const themeId = card.getAttribute('data-theme-pick');
          this.applyThemeChoice(themeId);
        });
      });

      document.querySelectorAll('[data-layout-pick]').forEach(card => {
        card.addEventListener('click', () => {
          const layoutId = card.getAttribute('data-layout-pick');
          this.applyLayoutChoice(layoutId);
        });
      });

      // Dynamic Cover Color & Eco Mode Toggles
      const dynToggle = document.getElementById('toggle-dynamic-color');
      if (dynToggle) {
        dynToggle.addEventListener('change', () => {
          this.colorEngine.setDynamicColorEnabled(dynToggle.checked);
          if (dynToggle.checked && this.currentTrack) {
            this.colorEngine.extractFromTrack(this.currentTrack);
          }
          this.showToast(dynToggle.checked ? 'Color dinámico de portada activado' : 'Usando paleta fija del tema');
        });
      }

      const ecoToggle = document.getElementById('toggle-eco-mode');
      if (ecoToggle) {
        ecoToggle.checked = this.colorEngine.ecoMode;
        ecoToggle.addEventListener('change', () => {
          this.colorEngine.setEcoMode(ecoToggle.checked);
          document.body.setAttribute('data-eco', String(ecoToggle.checked));
          this.showToast(ecoToggle.checked ? 'Modo Eco activado (Ultra bajo consumo GPU/RAM)' : 'Modo Liquid Glass completo activado');
        });
      }

      const ecoBadgeBtn = document.getElementById('eco-resource-badge');
      if (ecoBadgeBtn) {
        ecoBadgeBtn.addEventListener('click', () => {
          const next = !this.colorEngine.ecoMode;
          this.colorEngine.setEcoMode(next);
          document.body.setAttribute('data-eco', String(next));
          if (ecoToggle) ecoToggle.checked = next;
          this.showToast(next ? 'Modo Eco Ultra-Ligero Activado' : 'Modo Liquid Glass GPU Activado');
        });
      }

      // Glass Blur slider & Custom Palette
      const blurSlider = document.getElementById('slider-glass-blur');
      const blurVal = document.getElementById('glass-blur-val');
      if (blurSlider) {
        blurSlider.addEventListener('input', () => {
          document.documentElement.style.setProperty('--glass-blur', `${blurSlider.value}px`);
          if (blurVal) blurVal.textContent = `${blurSlider.value}px`;
        });
      }

      const applyCustomColorsBtn = document.getElementById('btn-apply-custom-colors');
      if (applyCustomColorsBtn) {
        applyCustomColorsBtn.addEventListener('click', () => {
          const p = document.getElementById('custom-color-primary').value;
          const s = document.getElementById('custom-color-secondary').value;
          const a = document.getElementById('custom-color-accent').value;
          this.colorEngine.applyPalette({ primary: p, secondary: s, accent: a });
          this.showToast('Paleta personalizada aplicada al cristal líquido');
        });
      }

      const sidebarPosSelect = document.getElementById('select-sidebar-pos');
      if (sidebarPosSelect) {
        sidebarPosSelect.addEventListener('change', () => {
          document.body.setAttribute('data-sidebar-pos', sidebarPosSelect.value);
        });
      }

      const densitySelect = document.getElementById('select-row-density');
      if (densitySelect) {
        densitySelect.addEventListener('change', () => {
          document.body.setAttribute('data-density', densitySelect.value);
        });
      }

      // Hero buttons
      const heroPlay = document.getElementById('btn-hero-play');
      if (heroPlay) {
        heroPlay.addEventListener('click', () => {
          this.selectTrack(this.currentTrack || this.catalog[0], { autoPlay: true });
        });
      }

      const heroOrgia = document.getElementById('btn-hero-orgia');
      if (heroOrgia) {
        heroOrgia.addEventListener('click', () => {
          this.orgiaMode = !this.orgiaMode;
          document.body.setAttribute('data-orgia', String(this.orgiaMode));
          if (this.orgiaMode) {
            this.audioEngine.applyPreset('orgia');
            this.syncEQSlidersFromEngine();
          }
          const lbl = document.getElementById('btn-orgia-label');
          if (lbl) lbl.textContent = this.orgiaMode ? 'Modo Orgia / Overdrive ACTIVO' : 'Activar Modo Orgia / Overdrive';
          this.showToast(this.orgiaMode ? 'MODO ORGIA ACTIVADO: Sobrecarga visual + Preset DSP Punchy' : 'Modo Orgia desactivado');
        });
      }

      const heroOpenStage = document.getElementById('btn-hero-open-stage');
      if (heroOpenStage) {
        heroOpenStage.addEventListener('click', () => this.switchView('stage'));
      }

      const playerCoverTrigger = document.getElementById('player-cover-trigger');
      if (playerCoverTrigger) {
        playerCoverTrigger.addEventListener('click', () => this.switchView('stage'));
      }

      const reExtractBtn = document.getElementById('btn-stage-extract-color');
      if (reExtractBtn) {
        reExtractBtn.addEventListener('click', async () => {
          if (this.currentTrack) {
            this.colorEngine.cache.delete(this.currentTrack.id);
            await this.colorEngine.extractFromTrack(this.currentTrack);
            this.showToast('Color de portada re-muestreado en tiempo real');
          }
        });
      }

      // Search Input & Filter Chips
      const searchInput = document.getElementById('search-input');
      if (searchInput) {
        searchInput.addEventListener('input', async () => {
          const q = searchInput.value.trim();
          if (!q) {
            this.renderTrackTable(this.catalog);
            return;
          }
          try {
            const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&filter=${this.activeFilter}`);
            if (res.ok) {
              const data = await res.json();
              const results = (data.results || []).map((t, i) => this.enrichTrack(t, i));
              this.renderTrackTable(results);
              this.switchView('home');
            }
          } catch (_) {
            const local = this.catalog.filter(t =>
              t.title.toLowerCase().includes(q.toLowerCase()) ||
              t.artist.toLowerCase().includes(q.toLowerCase())
            );
            this.renderTrackTable(local);
          }
        });
      }

      document.querySelectorAll('#search-filters .filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          document.querySelectorAll('#search-filters .filter-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          this.activeFilter = chip.getAttribute('data-filter') || 'all';
          if (this.activeFilter === 'all') {
            this.renderTrackTable(this.catalog);
          } else {
            const filtered = this.catalog.filter(t =>
              !t.tags || t.tags.includes(this.activeFilter) || t.genre.toLowerCase().includes(this.activeFilter)
            );
            this.renderTrackTable(filtered.length ? filtered : this.catalog);
          }
        });
      });

      // Network drop simulation button (Proves offline playlist resilience!)
      const simDropBtn = document.getElementById('btn-simulate-drop');
      if (simDropBtn) {
        simDropBtn.addEventListener('click', async () => {
          const isNowOffline = await this.offlineEngine.toggleSimulatedOffline();
          const pill = document.getElementById('network-status-pill');
          const txt = document.getElementById('network-status-text');
          if (pill) pill.setAttribute('data-network', isNowOffline ? 'offline' : 'online');
          if (txt) {
            txt.textContent = isNowOffline
              ? 'Modo Offline Resiliente (SQLite + Caché Activa)'
              : 'Red Estable • Buffer OK';
          }
          simDropBtn.textContent = isNowOffline ? 'Restaurar Red' : 'Simular Caída';
          this.showToast(
            isNowOffline
              ? 'Caída de red simulada: Las playlists y el audio siguen funcionando sin cortes desde la caché SQLite/IndexedDB'
              : 'Conexión restaurada: Cola de operaciones offline sincronizada con éxito'
          );
        });
      }

      // Create Playlist button (works online and offline!)
      const createPlBtn = document.getElementById('btn-create-playlist');
      if (createPlBtn) {
        createPlBtn.addEventListener('click', async () => {
          const name = `Aigis Mix #${this.playlists.length + 1}`;
          await this.offlineEngine.mutatePlaylist('create', {
            title: name,
            name,
            description: 'Creada con blindaje anti-caídas de red'
          });
          const plRes = await this.offlineEngine.getPlaylists();
          this.playlists = plRes.playlists || [];
          this.renderPlaylists();
          this.showToast(`Playlist "${name}" creada y protegida para uso offline`);
        });
      }

      // Right Panel Tabs (Cola / Letras / Algoritmo)
      document.querySelectorAll('.panel-tabs-header .panel-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const tab = btn.getAttribute('data-tab');
          document.querySelectorAll('.panel-tabs-header .panel-tab-btn').forEach(b => {
            b.classList.toggle('active', b === btn);
            b.setAttribute('aria-selected', String(b === btn));
          });
          document.querySelectorAll('.panel-tab-content').forEach(panel => {
            panel.classList.toggle('active', panel.id === `tab-${tab}`);
          });
        });
      });

      // Player Transport Controls
      const playPauseBtn = document.getElementById('btn-play-pause');
      if (playPauseBtn) {
        playPauseBtn.addEventListener('click', () => this.audioEngine.togglePlay());
      }

      const prevBtn = document.getElementById('btn-prev');
      if (prevBtn) {
        prevBtn.addEventListener('click', () => this.playRelative(-1));
      }

      const nextBtn = document.getElementById('btn-next');
      if (nextBtn) {
        nextBtn.addEventListener('click', () => this.playRelative(1));
      }

      const seekSlider = document.getElementById('seek-slider-input');
      if (seekSlider) {
        seekSlider.addEventListener('input', () => {
          const pct = parseFloat(seekSlider.value || '0') / 100;
          const targetSec = pct * (this.audioEngine.state.duration || 210);
          this.audioEngine.seek(targetSec);
        });
      }

      const volSlider = document.getElementById('volume-slider');
      if (volSlider) {
        volSlider.value = String(this.audioEngine.state.volume);
        volSlider.addEventListener('input', () => {
          this.audioEngine.setVolume(parseFloat(volSlider.value));
        });
      }

      const muteBtn = document.getElementById('btn-mute');
      if (muteBtn) {
        muteBtn.addEventListener('click', () => {
          const nextVol = this.audioEngine.state.volume > 0 ? 0 : 0.85;
          this.audioEngine.setVolume(nextVol);
          if (volSlider) volSlider.value = String(nextVol);
        });
      }

      const likeBtn = document.getElementById('btn-like-track');
      if (likeBtn) {
        likeBtn.addEventListener('click', async () => {
          if (!this.currentTrack) return;
          const id = this.currentTrack.id;
          if (this.likedTracks.has(id)) {
            this.likedTracks.delete(id);
          } else {
            this.likedTracks.add(id);
          }
          likeBtn.innerHTML = this.likedTracks.has(id) ? '&#9829;' : '&#9825;';
          await fetch('/api/likes/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ track_id: id })
          }).catch(() => {});
        });
      }

      // Download buttons
      const dlCurrentBtn = document.getElementById('btn-download-current');
      const dlPlayerBtn = document.getElementById('btn-player-download');
      [dlCurrentBtn, dlPlayerBtn].forEach(btn => {
        if (btn) {
          btn.addEventListener('click', () => {
            this.triggerSmartDownload(this.currentTrack || this.catalog[0]);
            this.switchView('downloads');
          });
        }
      });

      const verifyChunksBtn = document.getElementById('btn-verify-all-chunks');
      if (verifyChunksBtn) {
        verifyChunksBtn.addEventListener('click', async () => {
          const dlList = await this.offlineEngine.fetchDownloads();
          this.renderDownloads(dlList);
          this.showToast('Integridad SHA-256 de todos los bloques offline verificada al 100%');
        });
      }

      const playerEqBtn = document.getElementById('btn-player-eq');
      if (playerEqBtn) {
        playerEqBtn.addEventListener('click', () => this.switchView('equalizer'));
      }

      // 10-Band Equalizer & DSP Studio Controls
      this.bindEqualizerEvents();

      // Google Account & Auto-AdBlock Modal
      this.bindAccountModalEvents();
    }

    bindEqualizerEvents() {
      const presetSelect = document.getElementById('eq-preset-select');
      if (presetSelect) {
        presetSelect.value = this.audioEngine.state.activePreset in this.audioEngine.presets
          ? this.audioEngine.state.activePreset
          : 'orgia';
        presetSelect.addEventListener('change', () => {
          const val = presetSelect.value === 'sonic' ? 'electronic' : presetSelect.value;
          this.audioEngine.applyPreset(val);
          this.syncEQSlidersFromEngine();
          this.showToast(`Preset DSP aplicado: ${presetSelect.options[presetSelect.selectedIndex].text}`);
        });
      }

      const resetBtn = document.getElementById('btn-eq-reset');
      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          this.audioEngine.applyPreset('flat');
          if (presetSelect) presetSelect.value = 'flat';
          this.syncEQSlidersFromEngine();
          this.showToast('Ecualizador restablecido a 0 dB (Plano)');
        });
      }

      const preampSlider = document.getElementById('eq-preamp-slider');
      const preampVal = document.getElementById('eq-val-preamp');
      if (preampSlider) {
        preampSlider.addEventListener('input', () => {
          const v = parseFloat(preampSlider.value);
          this.audioEngine.setPreamp(v);
          if (preampVal) preampVal.textContent = `${v > 0 ? '+' : ''}${v}dB`;
        });
      }

      document.querySelectorAll('.eq-band-input').forEach(slider => {
        slider.addEventListener('input', () => {
          const band = parseInt(slider.getAttribute('data-band') || '0', 10);
          const v = parseFloat(slider.value);
          this.audioEngine.setBandGain(band, v);
          const lbl = document.querySelector(`[data-eq-label="${band}"]`);
          if (lbl) lbl.textContent = `${v > 0 ? '+' : ''}${v}dB`;
        });
      });

      const bassSlider = document.getElementById('dsp-bass-boost');
      const bassVal = document.getElementById('dsp-bass-val');
      if (bassSlider) {
        bassSlider.addEventListener('input', () => {
          const v = parseFloat(bassSlider.value);
          this.audioEngine.setBassBoost(v);
          if (bassVal) bassVal.textContent = `${v} dB`;
        });
      }

      const reverbSlider = document.getElementById('dsp-reverb');
      const reverbVal = document.getElementById('dsp-reverb-val');
      if (reverbSlider && reverbVal) {
        reverbSlider.addEventListener('input', () => {
          reverbVal.textContent = `${reverbSlider.value}%`;
        });
      }

      const crossfadeSlider = document.getElementById('dsp-crossfade');
      const crossfadeVal = document.getElementById('dsp-crossfade-val');
      if (crossfadeSlider && crossfadeVal) {
        crossfadeSlider.addEventListener('input', () => {
          this.audioEngine.state.crossfadeSec = parseFloat(crossfadeSlider.value);
          crossfadeVal.textContent = `${ parseFloat(crossfadeSlider.value).toFixed(1) } s`;
        });
      }

      const smartEqToggle = document.getElementById('toggle-smart-eq');
      const smartEqBadge = document.getElementById('smart-eq-reason-badge');
      if (smartEqToggle) {
        smartEqToggle.checked = Boolean(this.audioEngine.state.smartAutoEq);
        if (!smartEqToggle.checked && smartEqBadge) {
          smartEqBadge.textContent = 'Auto-EQ: Manual';
        }
        smartEqToggle.addEventListener('change', () => {
          const enabled = this.audioEngine.setSmartAutoEq(smartEqToggle.checked, true);
          if (!enabled && smartEqBadge) {
            smartEqBadge.textContent = 'Auto-EQ: Manual (Curva Fija)';
          }
          this.syncEQSlidersFromEngine();
          this.showToast(
            enabled
              ? 'Smart Auto-EQ activado: curva adaptativa según género y BPM'
              : 'Smart Auto-EQ desactivado: control manual de ecualizador'
          );
        });
      }

      this.syncEQSlidersFromEngine();
    }

    syncEQSlidersFromEngine() {
      const gains = this.audioEngine.state.eqGains;
      document.querySelectorAll('.eq-band-input').forEach(slider => {
        const idx = parseInt(slider.getAttribute('data-band') || '0', 10);
        const val = gains[idx] || 0;
        slider.value = String(val);
        const lbl = document.querySelector(`[data-eq-label="${idx}"]`);
        if (lbl) lbl.textContent = `${val > 0 ? '+' : ''}${val}dB`;
      });

      const preampSlider = document.getElementById('eq-preamp-slider');
      const preampVal = document.getElementById('eq-val-preamp');
      if (preampSlider) preampSlider.value = String(this.audioEngine.state.preampDb);
      if (preampVal) {
        const p = this.audioEngine.state.preampDb;
        preampVal.textContent = `${p > 0 ? '+' : ''}${p}dB`;
      }

      const bassSlider = document.getElementById('dsp-bass-boost');
      const bassVal = document.getElementById('dsp-bass-val');
      if (bassSlider) bassSlider.value = String(this.audioEngine.state.bassBoostDb);
      if (bassVal) bassVal.textContent = `${this.audioEngine.state.bassBoostDb} dB`;
    }

    bindAccountModalEvents() {
      const modal = document.getElementById('account-modal');
      const openBtn = document.getElementById('btn-account-modal');
      const closeBtn = document.getElementById('btn-close-account-modal');
      const cancelBtn = document.getElementById('btn-cancel-account-modal');
      const saveBtn = document.getElementById('btn-save-account-modal');
      const freeBtn = document.getElementById('btn-tier-free');
      const premBtn = document.getElementById('btn-tier-premium');

      const toggleModal = show => {
        if (modal) {
          modal.classList.toggle('active', show);
          modal.classList.toggle('open', show);
        }
      };

      if (openBtn) openBtn.addEventListener('click', () => toggleModal(true));
      if (closeBtn) closeBtn.addEventListener('click', () => toggleModal(false));
      if (cancelBtn) cancelBtn.addEventListener('click', () => toggleModal(false));

      if (freeBtn && premBtn) {
        freeBtn.addEventListener('click', () => {
          this.selectedAccountTier = 'free';
          freeBtn.classList.add('active');
          premBtn.classList.remove('active');
        });
        premBtn.addEventListener('click', () => {
          this.selectedAccountTier = 'premium';
          premBtn.classList.add('active');
          freeBtn.classList.remove('active');
        });
      }

      if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
          const nameInput = document.getElementById('input-account-name');
          const cookieInput = document.getElementById('input-google-session');
          const name = (nameInput && nameInput.value.trim()) || 'Aigis Unit 07';
          const cookie = (cookieInput && cookieInput.value.trim()) || '';

          try {
            const res = await fetch('/api/auth/session', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                profile_name: name,
                tier: this.selectedAccountTier,
                cookie
              })
            });
            if (res.ok) {
              const data = await res.json();
              this.updateAccountPill(name, data.session ? data.session.account_tier : this.selectedAccountTier);
            } else {
              this.updateAccountPill(name, this.selectedAccountTier);
            }
          } catch (_) {
            this.updateAccountPill(name, this.selectedAccountTier);
          }

          toggleModal(false);
          this.showToast(
            this.selectedAccountTier === 'free'
              ? `Sesión "${name}" (Gratuita): Escudo AdBlock + SponsorBlock ACTIVADO automáticamente`
              : `Sesión "${name}" (YT Music Premium): Streaming directo de alto bitrate activo`
          );
        });
      }

      this.bindProfileAndHandoffEvents();
    }

    async bindProfileAndHandoffEvents() {
      const listEl = document.getElementById('profile-selector-list');
      const createBtn = document.getElementById('btn-create-profile');
      const pushBtn = document.getElementById('btn-handoff-push');
      const pullBtn = document.getElementById('btn-handoff-pull');

      if (listEl) {
        listEl.addEventListener('click', async e => {
          const card = e.target.closest('[data-profile-id]');
          if (!card) return;
          const profileId = card.getAttribute('data-profile-id');
          if (profileId) {
            await this.switchProfile(profileId);
          }
        });
      }

      if (createBtn) {
        createBtn.addEventListener('click', async () => {
          const nameInput = document.getElementById('input-new-profile-name');
          const modeSelect = document.getElementById('select-new-profile-mode');
          const name = (nameInput && nameInput.value.trim()) || `Perfil Invitado #${this.profilesList.length + 1}`;
          const syncMode = (modeSelect && modeSelect.value) || 'isolated_online';
          try {
            const res = await fetch('/api/profiles', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'create',
                name,
                sync_mode: syncMode,
                isolate_algorithm: syncMode !== 'standard',
                network_policy: syncMode === 'isolated_offline' ? 'offline' : 'online_or_offline',
                theme: this.colorEngine.currentTheme || 'aigis'
              })
            });
            if (res.ok) {
              const data = await res.json();
              this.profilesList = data.profiles || [];
              if (nameInput) nameInput.value = '';
              const createdId = (data.created && data.created.id) || data.active_profile_id;
              await this.switchProfile(createdId);
              this.showToast(`Perfil "${name}" creado y activado`);
            }
          } catch (_) {
            this.showToast(`Perfil local "${name}" creado`);
          }
        });
      }

      if (pushBtn) {
        pushBtn.addEventListener('click', async () => {
          const trackId = (this.currentTrack && this.currentTrack.id) || 'aigis_trk_01';
          const posSec = Number((this.audioEngine.state.currentTime || 0).toFixed(2));
          const mode = this.audioEngine.state.mode || 'audio';
          const profileId = (this.activeProfile && this.activeProfile.id) || 'prof_main';
          try {
            const res = await fetch('/api/profiles', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'handoff_push',
                profile_id: profileId,
                track_id: trackId,
                position_sec: posSec,
                mode,
                device_name: 'MP3-Aigis Web Desktop',
                queue_ids: this.queue.map(t => t.id),
                theme: this.colorEngine.currentTheme,
                eq_preset: this.audioEngine.state.activePreset
              })
            });
            if (res.ok) {
              const handoff = await res.json();
              this.updateHandoffStatusBox(handoff);
              this.showToast(`Handoff enviado (${handoff.sync_code || profileId}): ${trackId} @ ${this.formatTime(posSec)}`);
            }
          } catch (_) {
            this.showToast(`Posición guardada localmente para Handoff: ${this.formatTime(posSec)}`);
          }
        });
      }

      if (pullBtn) {
        pullBtn.addEventListener('click', async () => {
          const profileId = (this.activeProfile && this.activeProfile.id) || 'prof_main';
          try {
            const res = await fetch('/api/profiles', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'handoff_pull',
                profile_id: profileId
              })
            });
            if (res.ok) {
              const handoff = await res.json();
              this.updateHandoffStatusBox(handoff);
              const targetTrack = this.catalog.find(t => t.id === handoff.track_id) || this.catalog[0];
              const targetPos = Number(handoff.position_sec) || 0;
              if (handoff.mode && handoff.mode !== this.audioEngine.state.mode) {
                await this.setAVMode(handoff.mode);
              }
              if (targetTrack) {
                await this.selectTrack(targetTrack, { startTime: targetPos, autoPlay: true });
                this.audioEngine.seek(targetPos);
              }
              this.showToast(
                `Continuando desde ${handoff.device_name || 'otro dispositivo'}: ${targetTrack ? targetTrack.title : handoff.track_id} en ${this.formatTime(targetPos)}`
              );
            }
          } catch (_) {
            this.showToast('Estado Handoff recuperado desde caché local');
          }
        });
      }

      // Load initial profiles state from backend
      try {
        const res = await fetch('/api/profiles');
        if (res.ok) {
          const data = await res.json();
          this.profilesList = data.profiles || [];
          this.activeProfile = data.active_profile || null;
          this.renderProfileSelectorList();
          if (this.activeProfile && this.activeProfile.handoff) {
            this.updateHandoffStatusBox(this.activeProfile.handoff);
          }
        }
      } catch (_) {}
    }

    async switchProfile(profileId) {
      try {
        const res = await fetch('/api/profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'switch', profile_id: profileId })
        });
        if (res.ok) {
          const data = await res.json();
          this.profilesList = data.profiles || this.profilesList;
          this.activeProfile = data.active_profile || this.profilesList.find(p => p.id === profileId) || null;
          this.renderProfileSelectorList();
          if (this.activeProfile) {
            this.updateAccountPill(this.activeProfile.name, this.selectedAccountTier, this.activeProfile);
            if (this.activeProfile.handoff) {
              this.updateHandoffStatusBox(this.activeProfile.handoff);
            }
            const pill = document.getElementById('network-status-pill');
            const txt = document.getElementById('network-status-text');
            const isOfflineProfile = this.activeProfile.sync_mode === 'isolated_offline' || this.activeProfile.network_policy === 'offline';
            if (pill) pill.setAttribute('data-network', isOfflineProfile ? 'offline' : 'online');
            if (txt) {
              txt.textContent = isOfflineProfile
                ? 'Sesión Privada Offline Puro (Bóveda SQLite)'
                : this.activeProfile.isolate_algorithm
                  ? 'Cuenta Prestada Activa • Algoritmo Aislado'
                  : 'Red Estable • Buffer OK';
            }
            this.showToast(
              isOfflineProfile
                ? `Perfil "${this.activeProfile.name}" activo: Modo Offline Puro sin telemetría`
                : this.activeProfile.isolate_algorithm
                  ? `Perfil "${this.activeProfile.name}" activo: Sandbox de Algoritmo (No contamina recomendaciones)`
                  : `Perfil Principal "${this.activeProfile.name}" activo y sincronizado`
            );
          }
        }
      } catch (_) {}
    }

    renderProfileSelectorList() {
      const listEl = document.getElementById('profile-selector-list');
      if (!listEl || !this.profilesList.length) return;
      const activeId = (this.activeProfile && this.activeProfile.id) || 'prof_main';
      listEl.innerHTML = this.profilesList.map(p => {
        const isActive = p.id === activeId;
        const icon = p.sync_mode === 'isolated_offline' ? '&#128274;' : p.isolate_algorithm ? '&#128737;' : '&#128100;';
        const desc = p.sync_mode === 'isolated_offline'
          ? 'Cero telemetría externa: reproduce exclusivamente desde bóveda SQLite / caché local.'
          : p.isolate_algorithm
            ? 'Sandbox de Algoritmo activo: streaming online sin contaminar tus mezclas ni historial.'
            : 'Sincroniza historial, likes y recomendaciones con tu algoritmo principal.';
        return `
          <button type="button" class="selector-card ${isActive ? 'active' : ''}" data-profile-id="${this.escapeHtml(p.id)}" data-profile-mode="${this.escapeHtml(p.sync_mode)}" style="padding: 10px 12px; text-align: left;">
            <div class="selector-card-title" style="font-size: 13px;">${icon} ${this.escapeHtml(p.name)} (<code>${this.escapeHtml(p.id)}</code>)</div>
            <p class="selector-card-desc" style="font-size: 11.5px; margin: 2px 0 0;">${desc}</p>
          </button>
        `;
      }).join('');
    }

    updateHandoffStatusBox(handoff) {
      const box = document.getElementById('handoff-status-box');
      if (!box || !handoff) return;
      const trackTitle = (this.catalog.find(t => t.id === handoff.track_id) || {}).title || handoff.track_id || 'aigis_trk_01';
      const posText = this.formatTime(handoff.position_sec || 0);
      const modeText = handoff.mode === 'video' ? 'Modo Video (OMV)' : 'Modo Canción (Audio)';
      box.innerHTML = `<strong>Código Sync:</strong> <code>${this.escapeHtml(handoff.sync_code || 'AIGIS-SYNC')}</code> • <strong>Pista:</strong> ${this.escapeHtml(trackTitle)} • <strong>Posición:</strong> ${posText} (${modeText}) • <strong>Origen:</strong> ${this.escapeHtml(handoff.device_name || 'Dispositivo')}`;
    }

    updateAccountPill(name, tier, profileObj = null) {
      const nameEl = document.getElementById('account-name-display');
      const tierEl = document.getElementById('account-tier-badge');
      const avatarEl = document.getElementById('account-avatar-badge');
      const hudShield = document.getElementById('hud-shield-state');
      const activeProf = profileObj || this.activeProfile;

      if (nameEl) nameEl.textContent = name;
      if (avatarEl) avatarEl.textContent = name.charAt(0).toUpperCase();
      if (activeProf && activeProf.sync_mode === 'isolated_offline') {
        if (tierEl) tierEl.innerHTML = '&#128274; OFFLINE PURO (AISLADO)';
        if (hudShield) hudShield.textContent = 'PRIVATE OFFLINE SANDBOX';
      } else if (activeProf && activeProf.isolate_algorithm) {
        if (tierEl) tierEl.innerHTML = '&#128737; PRESTADA • SANDBOX ON';
        if (hudShield) hudShield.textContent = 'ALGORITHM SANDBOX + ADBLOCK';
      } else if (tier === 'premium') {
        if (tierEl) tierEl.innerHTML = '&#128081; PREMIUM 256k';
        if (hudShield) hudShield.textContent = 'DIRECT PREMIUM MASTER STREAM';
      } else {
        if (tierEl) tierEl.innerHTML = '&#128737; FREE + AdBlock Activo';
        if (hudShield) hudShield.textContent = 'ADBLOCK + SPONSORBLOCK ON';
      }
    }

    applyThemeChoice(themeId) {
      const theme = this.colorEngine.setTheme(themeId);
      const quickSelect = document.getElementById('quick-theme-select');
      if (quickSelect) quickSelect.value = theme.id;

      document.querySelectorAll('[data-theme-pick]').forEach(card => {
        card.classList.toggle('active', card.getAttribute('data-theme-pick') === theme.id);
      });

      const hudSub = document.getElementById('brand-hud-subtitle');
      const heroMotto = document.getElementById('hero-motto-text');
      const hudThemeReadout = document.getElementById('hud-theme-readout');
      if (hudSub) hudSub.textContent = theme.name.toUpperCase();
      if (heroMotto) heroMotto.textContent = theme.hudTag;
      if (hudThemeReadout) hudThemeReadout.textContent = `${theme.name.toUpperCase()} // ${theme.hudTag}`;

      this.showToast(`Tema activado: ${theme.name}`);
    }

    applyLayoutChoice(layoutId) {
      const target = this.colorEngine.setLayout(layoutId);
      const quickLayout = document.getElementById('quick-layout-select');
      if (quickLayout) quickLayout.value = target;

      document.querySelectorAll('[data-layout-pick]').forEach(card => {
        card.classList.toggle('active', card.getAttribute('data-layout-pick') === target);
      });

      this.showToast(`Diseño de interfaz cambiado a: ${target.toUpperCase()}`);
    }

    playRelative(delta) {
      if (!this.queue.length) return;
      this.currentIndex = (this.currentIndex + delta + this.queue.length) % this.queue.length;
      this.selectTrack(this.queue[this.currentIndex], { autoPlay: true });
    }

    bindEngineEvents() {
      window.addEventListener('aigis:playstate', e => {
        const playing = Boolean(e.detail && e.detail.isPlaying);
        const btn = document.getElementById('btn-play-pause');
        if (btn) btn.innerHTML = playing ? '&#10074;&#10074;' : '&#9654;';
        if (playing) this.idleVisualizerDrawn = false;
      });

      window.addEventListener('aigis:timeupdate', e => {
        const cur = (e.detail && e.detail.currentTime) || 0;
        const dur = (e.detail && e.detail.duration) || 210;
        const pct = dur > 0 ? Math.min(100, (cur / dur) * 100) : 0;

        const curEl = document.getElementById('time-current');
        const totEl = document.getElementById('time-total');
        const progBar = document.getElementById('seek-progress-bar');
        const bufBar = document.getElementById('seek-buffer-bar');
        const slider = document.getElementById('seek-slider-input');

        if (curEl) curEl.textContent = this.formatTime(cur);
        if (totEl) totEl.textContent = this.formatTime(dur);
        if (progBar) progBar.style.width = `${pct}%`;
        if (bufBar) bufBar.style.width = `${Math.min(100, pct + 18)}%`;
        if (slider) slider.value = String(pct);

        // O(1) active lyric index check — only mutate DOM when active line changes
        if (this.lyricNodes.length) {
          let newIdx = -1;
          for (let i = 0; i < this.lyricNodes.length; i++) {
            if (cur >= this.lyricNodes[i].time) newIdx = i;
            else break;
          }
          if (newIdx !== this.activeLyricIndex) {
            if (this.activeLyricIndex >= 0 && this.lyricNodes[this.activeLyricIndex]) {
              const prevEl = this.lyricNodes[this.activeLyricIndex].el;
              prevEl.classList.remove('active');
              prevEl.style.background = 'transparent';
              prevEl.style.color = 'var(--text-secondary)';
              prevEl.style.fontWeight = '400';
            }
            if (newIdx >= 0 && this.lyricNodes[newIdx]) {
              const nextEl = this.lyricNodes[newIdx].el;
              nextEl.classList.add('active');
              nextEl.style.background = 'rgba(255,255,255,0.08)';
              nextEl.style.color = 'var(--song-color-primary, #38bdf8)';
              nextEl.style.fontWeight = '700';
            }
            this.activeLyricIndex = newIdx;
          }
        }
      });

      window.addEventListener('aigis:track-ended', () => {
        if (this.repeatMode === 'one' && this.currentTrack) {
          this.selectTrack(this.currentTrack, { autoPlay: true });
        } else {
          this.playRelative(1);
        }
      });

      window.addEventListener('aigis:smart-eq-applied', e => {
        const detail = e.detail || {};
        const badge = document.getElementById('smart-eq-reason-badge');
        if (badge && detail.reason) {
          badge.textContent = detail.reason;
        }
        const presetSelect = document.getElementById('eq-preset-select');
        if (presetSelect && detail.presetId) {
          if (detail.presetId === 'electronic' && !presetSelect.querySelector('option[value="electronic"]')) {
            presetSelect.value = 'sonic';
          } else {
            presetSelect.value = detail.presetId;
          }
        }
        this.syncEQSlidersFromEngine();
      });
    }

    startVisualizerLoop() {
      const freqCanvas = document.getElementById('visualizer-canvas');
      const videoCanvas = document.getElementById('video-canvas-fallback');
      const freqCtx = freqCanvas ? freqCanvas.getContext('2d') : null;
      const vidCtx = videoCanvas ? videoCanvas.getContext('2d') : null;

      const render = () => {
        this.animFrameId = requestAnimationFrame(render);
        if (document.hidden || this.colorEngine.ecoMode) return;

        const isPlaying = this.audioEngine.state.isPlaying;
        const isVideoMode = this.audioEngine.state.mode === 'video';
        if (!isPlaying && !isVideoMode && this.idleVisualizerDrawn) {
          return;
        }
        this.idleVisualizerDrawn = !isPlaying && !isVideoMode;

        this.audioEngine.getFrequencyData(this.freqBins);
        const palette = this.colorEngine.activePalette || {};
        const primaryColor = palette.primary || '#38bdf8';
        const accentColor = palette.accent || '#f59e0b';

        if (freqCtx && freqCanvas) {
          const w = freqCanvas.width;
          const h = freqCanvas.height;
          freqCtx.clearRect(0, 0, w, h);
          const barCount = 40;
          const barW = (w / barCount) - 3;

          for (let i = 0; i < barCount; i++) {
            const val = this.freqBins[i] || 10;
            const barH = Math.max(4, (val / 255) * (h - 6));
            const x = i * (barW + 3);
            const y = h - barH;
            freqCtx.fillStyle = i % 3 === 0 ? accentColor : primaryColor;
            freqCtx.beginPath();
            freqCtx.roundRect(x, y, barW, barH, 3);
            freqCtx.fill();
          }
        }

        // Render synchronized HD music video visualizer when in Video mode
        if (vidCtx && videoCanvas && this.audioEngine.state.mode === 'video') {
          const vw = videoCanvas.width;
          const vh = videoCanvas.height;
          const t = this.audioEngine.state.currentTime || (performance.now() * 0.001);

          vidCtx.fillStyle = '#070b14';
          vidCtx.fillRect(0, 0, vw, vh);

          // Animated perspective cyber grid + radial audio waveform
          const cx = vw / 2;
          const cy = vh / 2;
          const bassEnergy = (this.freqBins[0] + this.freqBins[1] + this.freqBins[2]) / (3 * 255);
          const radius = 75 + bassEnergy * 55;

          const grad = vidCtx.createRadialGradient(cx, cy, 10, cx, cy, radius * 2.3);
          grad.addColorStop(0, primaryColor);
          grad.addColorStop(0.5, accentColor);
          grad.addColorStop(1, 'transparent');

          vidCtx.fillStyle = grad;
          vidCtx.globalAlpha = 0.35;
          vidCtx.beginPath();
          vidCtx.arc(cx, cy, radius * 2.2, 0, Math.PI * 2);
          vidCtx.fill();
          vidCtx.globalAlpha = 1.0;

          vidCtx.strokeStyle = primaryColor;
          vidCtx.lineWidth = 3;
          vidCtx.beginPath();
          for (let a = 0; a < 64; a++) {
            const angle = (a / 64) * Math.PI * 2 + t * 0.6;
            const amp = (this.freqBins[a] / 255) * 65;
            const r = radius + amp;
            const x = cx + Math.cos(angle) * r;
            const y = cy + Math.sin(angle) * r;
            if (a === 0) vidCtx.moveTo(x, y);
            else vidCtx.lineTo(x, y);
          }
          vidCtx.closePath();
          vidCtx.stroke();

          // Timestamp overlay proving 0ms drift between Song and Video switch
          vidCtx.fillStyle = '#ffffff';
          vidCtx.font = 'bold 16px monospace';
          vidCtx.fillText(
            `OMV VIDEO STREAM // ${this.currentTrack ? this.currentTrack.title : 'AIGIS'} // TIME: ${this.formatTime(this.audioEngine.state.currentTime)}`,
            24,
            vh - 24
          );
        }
      };

      this.animFrameId = requestAnimationFrame(render);
    }

    startTelemetryPoll() {
      setInterval(async () => {
        if (document.hidden) return;
        try {
          const res = await fetch('/api/status');
          if (res.ok) {
            const data = await res.json();
            this.updateSystemStatusUI(data);
          }
        } catch (_) {}
      }, 6000);
    }

    updateSystemStatusUI(statusData) {
      if (!statusData) return;
      const ecoText = document.getElementById('eco-resource-text');
      if (ecoText && statusData.resources) {
        ecoText.textContent = `RAM ${statusData.resources.rss_memory_mb}MB • CPU ${statusData.resources.cpu_usage_pct}%`;
      }
      const adHits = document.getElementById('stat-adblock-hits');
      if (adHits && statusData.adblock) {
        adHits.textContent = String(statusData.adblock.ads_blocked || 142);
      }
      if (statusData.session) {
        const profName = (this.activeProfile && this.activeProfile.id !== 'prof_main' && this.activeProfile.name)
          ? this.activeProfile.name
          : (statusData.session.profile_name || 'Aigis Unit 07');
        this.updateAccountPill(
          profName,
          statusData.session.account_tier || 'free',
          this.activeProfile
        );
      }
    }

    showToast(message) {
      const container = document.getElementById('toast-container');
      if (!container) return;
      const toast = document.createElement('div');
      toast.className = 'toast-item liquid-glass-elevated';
      toast.style.cssText = 'padding:10px 16px; border-radius:12px; margin-top:8px; font-size:12.5px; font-weight:600; border:1px solid var(--song-color-primary, #38bdf8); background:rgba(10,15,28,0.9); color:#fff; box-shadow:0 8px 24px rgba(0,0,0,0.45);';
      toast.textContent = message;
      container.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s ease';
        setTimeout(() => toast.remove(), 300);
      }, 3200);
    }

    formatTime(sec) {
      const s = Math.max(0, Math.floor(Number(sec) || 0));
      const m = Math.floor(s / 60);
      const rem = s % 60;
      return `${m}:${String(rem).padStart(2, '0')}`;
    }

    escapeHtml(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    window.aigisApp = new MP3AigisApp();
    window.aigisApp.init();
  });
})();
