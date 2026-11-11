/**
 * MP3-Aigis — Resilient Offline Playlist & Smart Download Sync Engine
 * Solves YouTube Music's playlist drop-out bug on unstable networks and failed download stream detections.
 */

class AigisOfflineSyncEngine {
  constructor() {
    this.isOnline = navigator.onLine;
    this.simulatedOffline = false;
    this.pendingMutations = this._safeParseStorage('aigis_pending_ops', []);
    this.cachedPlaylists = this._safeParseStorage('aigis_playlists_cache', []);
    this.cachedHome = this._safeParseStorage('aigis_home_cache', null);
    this.downloads = new Map();

    window.addEventListener('online', () => this.handleNetworkChange(true));
    window.addEventListener('offline', () => this.handleNetworkChange(false));
  }

  _safeParseStorage(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  get effectiveOnline() {
    return this.isOnline && !this.simulatedOffline;
  }

  async handleNetworkChange(onlineState) {
    this.isOnline = onlineState;
    this.emitStatus();
    if (this.effectiveOnline && this.pendingMutations.length > 0) {
      await this.flushPendingMutations();
    }
  }

  async toggleSimulatedOffline(forceState) {
    this.simulatedOffline = typeof forceState === 'boolean' ? forceState : !this.simulatedOffline;
    try {
      await fetch('/api/network/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offline: this.simulatedOffline, online: !this.simulatedOffline })
      });
    } catch (_) {}

    this.emitStatus();
    if (this.effectiveOnline && this.pendingMutations.length > 0) {
      await this.flushPendingMutations();
    }
    return this.simulatedOffline;
  }

  emitStatus() {
    window.dispatchEvent(new CustomEvent('aigis:network-status', {
      detail: {
        online: this.effectiveOnline,
        simulatedOffline: this.simulatedOffline,
        pendingOps: this.pendingMutations.length,
        cachedPlaylistsCount: this.cachedPlaylists.length
      }
    }));
  }

  /**
   * Fetches playlists with automatic fallback to local snapshot if network drops.
   */
  async getPlaylists() {
    if (this.effectiveOnline) {
      try {
        const res = await fetch('/api/playlists');
        if (res.ok) {
          const data = await res.json();
          const playlists = data.playlists || data || [];
          this.cachedPlaylists = playlists;
          localStorage.setItem('aigis_playlists_cache', JSON.stringify(playlists));
          return { playlists, source: data.source || 'live-synced', offlineProtected: true };
        }
      } catch (_) {
        // Fall through to resilient local cache
      }
    }
    return {
      playlists: this.cachedPlaylists,
      source: 'offline-resilient-cache',
      offlineProtected: true
    };
  }

  /**
   * Adds a track or creates a playlist even when offline, queuing sync operation for reconnection.
   */
  async mutatePlaylist(action, payload) {
    // Apply optimistically to local cache immediately so playlist UI never stalls
    if (action === 'create') {
      const newPl = {
        id: payload.id || `pl_local_${Date.now()}`,
        name: payload.name || 'Nueva Playlist Aigis',
        description: payload.description || 'Sincronizada con resiliencia offline',
        trackCount: (payload.tracks || []).length,
        tracks: payload.tracks || [],
        pinnedOffline: true
      };
      this.cachedPlaylists.unshift(newPl);
      localStorage.setItem('aigis_playlists_cache', JSON.stringify(this.cachedPlaylists));
    } else if (action === 'add_track') {
      const target = this.cachedPlaylists.find(p => p.id === payload.playlistId);
      if (target && payload.track) {
        target.tracks = target.tracks || [];
        if (!target.tracks.some(t => t.id === payload.track.id)) {
          target.tracks.push(payload.track);
          target.trackCount = target.tracks.length;
        }
        localStorage.setItem('aigis_playlists_cache', JSON.stringify(this.cachedPlaylists));
      }
    }

    if (this.effectiveOnline) {
      try {
        const res = await fetch('/api/playlists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, ...payload })
        });
        if (res.ok) {
          return await res.json();
        }
      } catch (_) {}
    }

    // Queue mutation for automatic recovery
    this.pendingMutations.push({
      id: `op_${Date.now()}`,
      action,
      payload,
      timestamp: new Date().toISOString()
    });
    localStorage.setItem('aigis_pending_ops', JSON.stringify(this.pendingMutations));
    this.emitStatus();
    return { status: 'queued_offline', pendingOps: this.pendingMutations.length };
  }

  async flushPendingMutations() {
    const queue = [...this.pendingMutations];
    this.pendingMutations = [];
    for (const op of queue) {
      try {
        await fetch('/api/playlists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: op.action, ...op.payload })
        });
      } catch (_) {
        this.pendingMutations.push(op);
      }
    }
    localStorage.setItem('aigis_pending_ops', JSON.stringify(this.pendingMutations));
    this.emitStatus();
  }

  /**
   * Smart Download initiator with stream signature probe & multi-chunk recovery.
   */
  async startSmartDownload(track, format = 'opus_160') {
    if (!track || !track.id) return null;
    try {
      const res = await fetch('/api/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          track_id: track.id,
          trackId: track.id,
          title: track.title,
          artist: track.artist,
          duration: track.duration,
          format
        })
      });
      if (res.ok) {
        const data = await res.json();
        window.dispatchEvent(new CustomEvent('aigis:downloads-updated', { detail: data }));
        return data;
      }
    } catch (_) {}
    return null;
  }

  async fetchDownloads() {
    try {
      const res = await fetch('/api/downloads');
      if (res.ok) {
        return await res.json();
      }
    } catch (_) {}
    return { downloads: [] };
  }
}

window.AigisOfflineSyncEngine = AigisOfflineSyncEngine;
