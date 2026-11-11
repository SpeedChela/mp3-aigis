"""
ResilientPlaylistCache (SQLite WAL Offline-First Engine)
Prevents playlist playback or mutation failures when network drops or times out.
All playlists, tracks, likes, and queue states are persisted locally in SQLite,
and mutations made while offline are journaled in `pending_sync_ops` and automatically
reconciled when connectivity is restored.
"""

from __future__ import annotations

import contextlib
import json
import os
import sqlite3
import threading
import time
import uuid
from typing import Any, Dict, Iterator, List, Optional

from backend.ytmusic_engine import CATALOG_TRACKS


DEFAULT_DB_PATH = "/home/speedchela/Proyectos/mp3-aigis/data/aigis_cache.db"


class ResilientPlaylistCache:
    """
    Offline-resilient SQLite store for playlists, tracks, likes, and sync journaling.
    Thread-safe and tuned for minimal memory consumption using SQLite WAL mode.
    """

    def __init__(self, db_path: str = DEFAULT_DB_PATH) -> None:
        self.db_path = db_path
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        self._lock = threading.RLock()
        self.network_online: bool = True
        self.last_reconciled_at: Optional[float] = time.time()
        self.total_reconciled_ops: int = 0
        self._init_schema()
        self._seed_defaults_if_empty()

    @contextlib.contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path, timeout=10.0, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        conn.execute("PRAGMA temp_store=MEMORY;")
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def _init_schema(self) -> None:
        with self._lock, self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS playlists (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    description TEXT DEFAULT '',
                    cover_gradient TEXT DEFAULT '',
                    is_system INTEGER DEFAULT 0,
                    sync_state TEXT DEFAULT 'synced',
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS playlist_tracks (
                    playlist_id TEXT NOT NULL,
                    track_id TEXT NOT NULL,
                    position INTEGER NOT NULL,
                    track_json TEXT NOT NULL,
                    added_at REAL NOT NULL,
                    PRIMARY KEY (playlist_id, track_id, position)
                );

                CREATE TABLE IF NOT EXISTS liked_tracks (
                    track_id TEXT PRIMARY KEY,
                    liked_at REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS pending_sync_ops (
                    op_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    op_type TEXT NOT NULL,
                    entity_id TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    status TEXT DEFAULT 'pending',
                    created_at REAL NOT NULL,
                    synced_at REAL
                );
                """
            )

    def _seed_defaults_if_empty(self) -> None:
        with self._lock, self._connect() as conn:
            row = conn.execute("SELECT COUNT(*) AS cnt FROM playlists").fetchone()
            if row and row["cnt"] > 0:
                return

            now = time.time()
            by_id = {t["id"]: t for t in CATALOG_TRACKS}

            default_playlists = [
                {
                    "id": "pl_cyber_flow",
                    "title": "Cyberpunk Coding Flow",
                    "description": "Zero-latency synthwave & darksynth cached for uninterrupted deep work.",
                    "cover_gradient": "linear-gradient(135deg, #0ea5e9 0%, #6366f1 60%, #0f172a 100%)",
                    "is_system": 1,
                    "track_ids": ["aigis_trk_01", "aigis_trk_03", "aigis_trk_07", "aigis_trk_05"],
                },
                {
                    "id": "pl_lofi_vault",
                    "title": "Late Night Lo-Fi & Jazz Vault",
                    "description": "Offline-pinned chill beats and acoustic sessions that never buffer.",
                    "cover_gradient": "linear-gradient(135deg, #f43f5e 0%, #881337 60%, #111827 100%)",
                    "is_system": 1,
                    "track_ids": ["aigis_trk_02", "aigis_trk_04", "aigis_trk_06", "aigis_trk_08"],
                },
                {
                    "id": "pl_commute_shield",
                    "title": "Subway Dead-Zone Shield",
                    "description": "Resilient SQLite playlist designed to survive complete network blackouts.",
                    "cover_gradient": "linear-gradient(135deg, #10b981 0%, #047857 60%, #064e3b 100%)",
                    "is_system": 0,
                    "track_ids": ["aigis_trk_01", "aigis_trk_02", "aigis_trk_05", "aigis_trk_06", "aigis_trk_08"],
                },
            ]

            for pl in default_playlists:
                conn.execute(
                    """
                    INSERT INTO playlists (id, title, description, cover_gradient, is_system, sync_state, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, 'synced', ?, ?)
                    """,
                    (pl["id"], pl["title"], pl["description"], pl["cover_gradient"], pl["is_system"], now, now),
                )
                for idx, tid in enumerate(pl["track_ids"]):
                    track = by_id.get(tid)
                    if track:
                        conn.execute(
                            """
                            INSERT INTO playlist_tracks (playlist_id, track_id, position, track_json, added_at)
                            VALUES (?, ?, ?, ?, ?)
                            """,
                            (pl["id"], tid, idx, json.dumps(self._strip_heavy_fields(track)), now),
                        )

            # Seed initial liked tracks
            for tid in ("aigis_trk_01", "aigis_trk_02", "aigis_trk_06"):
                conn.execute(
                    "INSERT OR IGNORE INTO liked_tracks (track_id, liked_at) VALUES (?, ?)",
                    (tid, now),
                )

    @staticmethod
    def _strip_heavy_fields(track: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": track["id"],
            "video_id": track.get("video_id", track["id"]),
            "atv_id": track.get("atv_id", f"ATV_{track['id']}"),
            "omv_id": track.get("omv_id", f"OMV_{track['id']}"),
            "title": track["title"],
            "artist": track["artist"],
            "album": track.get("album", ""),
            "duration": track.get("duration", 200),
            "duration_text": track.get("duration_text", "3:20"),
            "genre": track.get("genre", "Electronic"),
            "bpm": track.get("bpm", 110),
            "cover_gradient": track.get(
                "cover_gradient", "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)"
            ),
            "accent_color": track.get("accent_color", "#38bdf8"),
            "video_resolution": track.get("video_resolution", "1080p60"),
            "has_video": True,
        }

    # ------------------------------------------------------------------
    # Network Simulation & Offline Sync Reconciliation
    # ------------------------------------------------------------------
    def set_network_state(self, online: bool) -> Dict[str, Any]:
        """
        Toggle network state (or simulated drop). When transitioning from offline -> online,
        automatically reconcile all pending mutations in `pending_sync_ops`.
        """
        with self._lock:
            was_offline = not self.network_online
            self.network_online = bool(online)
            reconciled = 0
            if self.network_online and was_offline:
                reconciled = self.reconcile_pending_ops()

            return {
                "network_online": self.network_online,
                "reconciled_now": reconciled,
                "pending_ops_count": self.get_pending_ops_count(),
                "total_reconciled_ops": self.total_reconciled_ops,
                "last_reconciled_at": self.last_reconciled_at,
                "resilience_mode": (
                    "ONLINE — Real-time InnerTube + SQLite Write-Through"
                    if self.network_online
                    else "OFFLINE SHIELD ACTIVE — Serving Local SQLite Snapshot & Journaling Mutations"
                ),
            }

    def _record_sync_op(self, conn: sqlite3.Connection, op_type: str, entity_id: str, payload: Dict[str, Any]) -> str:
        now = time.time()
        status = "synced" if self.network_online else "pending"
        synced_at = now if self.network_online else None
        conn.execute(
            """
            INSERT INTO pending_sync_ops (op_type, entity_id, payload_json, status, created_at, synced_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (op_type, entity_id, json.dumps(payload), status, now, synced_at),
        )
        return status

    def reconcile_pending_ops(self) -> int:
        """Flush all pending offline playlist/library mutations to synced state."""
        with self._lock, self._connect() as conn:
            now = time.time()
            cur = conn.execute(
                "UPDATE pending_sync_ops SET status = 'synced', synced_at = ? WHERE status = 'pending'",
                (now,),
            )
            count = cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
            conn.execute("UPDATE playlists SET sync_state = 'synced' WHERE sync_state != 'synced'")
            if count > 0:
                self.total_reconciled_ops += count
                self.last_reconciled_at = now
            return count

    def get_pending_ops_count(self) -> int:
        with self._lock, self._connect() as conn:
            row = conn.execute("SELECT COUNT(*) AS cnt FROM pending_sync_ops WHERE status = 'pending'").fetchone()
            return int(row["cnt"]) if row else 0

    def get_sync_journal(self, limit: int = 15) -> List[Dict[str, Any]]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                """
                SELECT op_id, op_type, entity_id, payload_json, status, created_at, synced_at
                FROM pending_sync_ops
                ORDER BY op_id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
            return [
                {
                    "op_id": r["op_id"],
                    "op_type": r["op_type"],
                    "entity_id": r["entity_id"],
                    "payload": json.loads(r["payload_json"]),
                    "status": r["status"],
                    "created_at": r["created_at"],
                    "synced_at": r["synced_at"],
                }
                for r in rows
            ]

    # ------------------------------------------------------------------
    # Playlist CRUD & Resilient Offline Operations
    # ------------------------------------------------------------------
    def list_playlists(self) -> Dict[str, Any]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM playlists ORDER BY is_system DESC, updated_at DESC"
            ).fetchall()
            playlists: List[Dict[str, Any]] = []
            for r in rows:
                t_rows = conn.execute(
                    "SELECT track_json FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC",
                    (r["id"],),
                ).fetchall()
                tracks = [json.loads(tr["track_json"]) for tr in t_rows]
                total_sec = sum(int(t.get("duration", 0)) for t in tracks)
                playlists.append(
                    {
                        "id": r["id"],
                        "title": r["title"],
                        "description": r["description"],
                        "cover_gradient": r["cover_gradient"],
                        "is_system": bool(r["is_system"]),
                        "sync_state": r["sync_state"],
                        "track_count": len(tracks),
                        "total_duration_sec": total_sec,
                        "tracks": tracks,
                        "updated_at": r["updated_at"],
                    }
                )

            liked_rows = conn.execute("SELECT track_id FROM liked_tracks").fetchall()
            liked_ids = [lr["track_id"] for lr in liked_rows]

            return {
                "network_online": self.network_online,
                "served_from": "sqlite_wal_cache",
                "pending_sync_ops": self.get_pending_ops_count(),
                "liked_track_ids": liked_ids,
                "playlists": playlists,
                "journal": self.get_sync_journal(10),
            }

    def get_playlist(self, playlist_id: str) -> Optional[Dict[str, Any]]:
        with self._lock, self._connect() as conn:
            r = conn.execute("SELECT * FROM playlists WHERE id = ?", (playlist_id,)).fetchone()
            if not r:
                return None
            t_rows = conn.execute(
                "SELECT track_json, position, added_at FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC",
                (playlist_id,),
            ).fetchall()
            tracks = []
            for tr in t_rows:
                item = json.loads(tr["track_json"])
                item["position"] = tr["position"]
                item["added_at"] = tr["added_at"]
                tracks.append(item)
            return {
                "id": r["id"],
                "title": r["title"],
                "description": r["description"],
                "cover_gradient": r["cover_gradient"],
                "is_system": bool(r["is_system"]),
                "sync_state": r["sync_state"],
                "track_count": len(tracks),
                "tracks": tracks,
                "network_online": self.network_online,
                "offline_ready": True,
            }

    def create_playlist(
        self,
        title: str,
        description: str = "",
        track_ids: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        clean_title = (title or "New Offline Playlist").strip()
        pl_id = "pl_" + uuid.uuid4().hex[:8]
        now = time.time()
        gradients = [
            "linear-gradient(135deg, #3b82f6 0%, #8b5cf6 60%, #0f172a 100%)",
            "linear-gradient(135deg, #14b8a6 0%, #0f766e 60%, #042f2e 100%)",
            "linear-gradient(135deg, #f97316 0%, #be123c 60%, #111827 100%)",
        ]
        gradient = gradients[sum(ord(c) for c in pl_id) % len(gradients)]
        sync_state = "synced" if self.network_online else "pending_sync"

        by_id = {t["id"]: t for t in CATALOG_TRACKS}
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO playlists (id, title, description, cover_gradient, is_system, sync_state, created_at, updated_at)
                VALUES (?, ?, ?, ?, 0, ?, ?, ?)
                """,
                (pl_id, clean_title, description, gradient, sync_state, now, now),
            )
            for idx, tid in enumerate(track_ids or []):
                track = by_id.get(tid)
                if track:
                    conn.execute(
                        """
                        INSERT INTO playlist_tracks (playlist_id, track_id, position, track_json, added_at)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (pl_id, tid, idx, json.dumps(self._strip_heavy_fields(track)), now),
                    )
            self._record_sync_op(
                conn,
                "CREATE_PLAYLIST",
                pl_id,
                {"title": clean_title, "track_ids": track_ids or []},
            )

        return self.get_playlist(pl_id) or {}

    def add_track_to_playlist(self, playlist_id: str, track: Dict[str, Any]) -> Dict[str, Any]:
        now = time.time()
        sync_state = "synced" if self.network_online else "pending_sync"
        clean_track = self._strip_heavy_fields(track)

        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM playlist_tracks WHERE playlist_id = ?",
                (playlist_id,),
            ).fetchone()
            next_pos = int(row["next_pos"]) if row else 0
            conn.execute(
                """
                INSERT INTO playlist_tracks (playlist_id, track_id, position, track_json, added_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (playlist_id, clean_track["id"], next_pos, json.dumps(clean_track), now),
            )
            conn.execute(
                "UPDATE playlists SET updated_at = ?, sync_state = ? WHERE id = ?",
                (now, sync_state, playlist_id),
            )
            self._record_sync_op(
                conn,
                "ADD_TRACK",
                playlist_id,
                {"track_id": clean_track["id"], "title": clean_track["title"], "position": next_pos},
            )

        return self.get_playlist(playlist_id) or {}

    def remove_track_from_playlist(self, playlist_id: str, track_id: str, position: Optional[int] = None) -> Dict[str, Any]:
        now = time.time()
        sync_state = "synced" if self.network_online else "pending_sync"
        with self._lock, self._connect() as conn:
            if position is not None:
                conn.execute(
                    "DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ? AND position = ?",
                    (playlist_id, track_id, int(position)),
                )
            else:
                conn.execute(
                    "DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?",
                    (playlist_id, track_id),
                )
            # Re-normalize track positions so there are no gaps
            rows = conn.execute(
                "SELECT track_id, track_json, added_at FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC",
                (playlist_id,),
            ).fetchall()
            conn.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?", (playlist_id,))
            for idx, r in enumerate(rows):
                conn.execute(
                    """
                    INSERT INTO playlist_tracks (playlist_id, track_id, position, track_json, added_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (playlist_id, r["track_id"], idx, r["track_json"], r["added_at"]),
                )
            conn.execute(
                "UPDATE playlists SET updated_at = ?, sync_state = ? WHERE id = ?",
                (now, sync_state, playlist_id),
            )
            self._record_sync_op(
                conn,
                "REMOVE_TRACK",
                playlist_id,
                {"track_id": track_id},
            )

        return self.get_playlist(playlist_id) or {}

    def toggle_like(self, track_id: str) -> Dict[str, Any]:
        now = time.time()
        with self._lock, self._connect() as conn:
            existing = conn.execute(
                "SELECT track_id FROM liked_tracks WHERE track_id = ?", (track_id,)
            ).fetchone()
            if existing:
                conn.execute("DELETE FROM liked_tracks WHERE track_id = ?", (track_id,))
                liked = False
            else:
                conn.execute(
                    "INSERT INTO liked_tracks (track_id, liked_at) VALUES (?, ?)",
                    (track_id, now),
                )
                liked = True

            self._record_sync_op(
                conn,
                "TOGGLE_LIKE",
                track_id,
                {"track_id": track_id, "liked": liked},
            )

            rows = conn.execute("SELECT track_id FROM liked_tracks").fetchall()
            return {
                "track_id": track_id,
                "liked": liked,
                "liked_track_ids": [r["track_id"] for r in rows],
                "sync_status": "synced" if self.network_online else "queued_offline",
            }
