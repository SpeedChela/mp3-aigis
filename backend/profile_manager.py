"""
ProfileSessionManager — Multi-Profile Isolation & Cross-Device Playback Handoff
Supports:
- Isolated online/offline profiles (so borrowed/guest sessions never pollute the main account's
  algorithm, history, recommendations, or playlists).
- Cross-device continuation / handoff (`push_handoff_state` & `pull_handoff_state`) with
  deterministic 6-char sync codes and exact playback timestamp preservation.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import os
import sqlite3
import threading
import time
import uuid
from typing import Any, Dict, Iterator, List, Optional


DEFAULT_DB_PATH = "/home/speedchela/Proyectos/mp3-aigis/data/aigis_cache.db"


class ProfileSessionManager:
    """SQLite-backed multi-profile session & cross-device handoff manager."""

    def __init__(self, db_path: str = DEFAULT_DB_PATH) -> None:
        self.db_path = db_path
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        self._lock = threading.RLock()
        self.active_profile_id: str = "prof_main"
        self._init_schema()
        self._seed_defaults()

    @contextlib.contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path, timeout=10.0, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def _init_schema(self) -> None:
        with self._lock, self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS user_profiles (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    sync_mode TEXT NOT NULL DEFAULT 'standard',
                    isolate_algorithm INTEGER NOT NULL DEFAULT 0,
                    network_policy TEXT NOT NULL DEFAULT 'online_or_offline',
                    theme TEXT NOT NULL DEFAULT 'aigis',
                    is_active INTEGER NOT NULL DEFAULT 0,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS handoff_states (
                    profile_id TEXT PRIMARY KEY,
                    sync_code TEXT NOT NULL,
                    track_id TEXT NOT NULL,
                    position_sec REAL NOT NULL DEFAULT 0.0,
                    mode TEXT NOT NULL DEFAULT 'audio',
                    device_name TEXT NOT NULL DEFAULT 'Linux Desktop',
                    queue_json TEXT NOT NULL DEFAULT '[]',
                    theme TEXT DEFAULT 'aigis',
                    eq_preset TEXT DEFAULT 'orgia',
                    updated_at REAL NOT NULL
                );
                """
            )

    @staticmethod
    def _compute_sync_code(profile_id: str) -> str:
        digest = hashlib.sha256(f"aigis-handoff:{profile_id}".encode("utf-8")).hexdigest().upper()
        return digest[:6]

    def _seed_defaults(self) -> None:
        now = time.time()
        defaults = [
            {
                "id": "prof_main",
                "name": "Aigis Principal (Sync Multi-Dispositivo)",
                "sync_mode": "standard",
                "isolate_algorithm": 0,
                "network_policy": "online_or_offline",
                "theme": "aigis",
                "is_active": 1,
            },
            {
                "id": "prof_guest_online",
                "name": "Modo Invitado / Cuenta Prestada (Online Aislado)",
                "sync_mode": "isolated_online",
                "isolate_algorithm": 1,
                "network_policy": "online",
                "theme": "persona5",
                "is_active": 0,
            },
            {
                "id": "prof_private_offline",
                "name": "Sesión Privada (Solo Offline)",
                "sync_mode": "isolated_offline",
                "isolate_algorithm": 1,
                "network_policy": "offline",
                "theme": "persona3",
                "is_active": 0,
            },
        ]

        with self._lock, self._connect() as conn:
            for p in defaults:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO user_profiles
                    (id, name, sync_mode, isolate_algorithm, network_policy, theme, is_active, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        p["id"],
                        p["name"],
                        p["sync_mode"],
                        p["isolate_algorithm"],
                        p["network_policy"],
                        p["theme"],
                        p["is_active"],
                        now,
                        now,
                    ),
                )
                sync_code = self._compute_sync_code(p["id"])
                conn.execute(
                    """
                    INSERT OR IGNORE INTO handoff_states
                    (profile_id, sync_code, track_id, position_sec, mode, device_name, queue_json, theme, eq_preset, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        p["id"],
                        sync_code,
                        "aigis_trk_01",
                        0.0,
                        "audio",
                        "Linux Desktop (Aigis Engine)",
                        json.dumps(["aigis_trk_01", "aigis_trk_02", "aigis_trk_03"]),
                        p["theme"],
                        "orgia",
                        now,
                    ),
                )

            active_row = conn.execute(
                "SELECT id FROM user_profiles WHERE is_active = 1 LIMIT 1"
            ).fetchone()
            if active_row:
                self.active_profile_id = active_row["id"]
            else:
                self.active_profile_id = "prof_main"
                conn.execute("UPDATE user_profiles SET is_active = 1 WHERE id = 'prof_main'")

    def _row_to_profile(self, row: sqlite3.Row, handoff: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        pid = row["id"]
        isolate = bool(row["isolate_algorithm"])
        sync_mode = row["sync_mode"]
        return {
            "id": pid,
            "name": row["name"],
            "sync_mode": sync_mode,
            "isolate_algorithm": isolate,
            "network_policy": row["network_policy"],
            "theme": row["theme"],
            "is_active": bool(row["is_active"]),
            "sync_code": self._compute_sync_code(pid),
            "history_isolated": isolate,
            "recommendations_isolated": isolate,
            "cross_device_sync_enabled": sync_mode == "standard",
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "handoff": handoff,
        }

    def list_profiles(self) -> Dict[str, Any]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM user_profiles ORDER BY CASE id "
                "WHEN 'prof_main' THEN 0 WHEN 'prof_guest_online' THEN 1 WHEN 'prof_private_offline' THEN 2 ELSE 3 END, created_at ASC"
            ).fetchall()
            handoff_rows = conn.execute("SELECT * FROM handoff_states").fetchall()
            handoff_map: Dict[str, Dict[str, Any]] = {}
            for h in handoff_rows:
                try:
                    q_ids = json.loads(h["queue_json"] or "[]")
                except json.JSONDecodeError:
                    q_ids = []
                handoff_map[h["profile_id"]] = {
                    "profile_id": h["profile_id"],
                    "sync_code": h["sync_code"],
                    "track_id": h["track_id"],
                    "position_sec": float(h["position_sec"]),
                    "mode": h["mode"],
                    "device_name": h["device_name"],
                    "queue_ids": q_ids,
                    "theme": h["theme"],
                    "eq_preset": h["eq_preset"],
                    "updated_at": h["updated_at"],
                }

            profiles = [self._row_to_profile(r, handoff_map.get(r["id"])) for r in rows]
            active_prof = next((p for p in profiles if p["id"] == self.active_profile_id), profiles[0] if profiles else None)
            if active_prof:
                self.active_profile_id = active_prof["id"]

            return {
                "active_profile_id": self.active_profile_id,
                "active_profile": active_prof,
                "profiles": profiles,
                "count": len(profiles),
            }

    def create_profile(
        self,
        name: str,
        sync_mode: str = "isolated_online",
        isolate_algorithm: bool = True,
        network_policy: str = "online_or_offline",
        theme: str = "aigis",
    ) -> Dict[str, Any]:
        clean_name = (name or "Perfil Personalizado").strip()
        pid = f"prof_custom_{uuid.uuid4().hex[:6]}"
        now = time.time()
        sync_code = self._compute_sync_code(pid)

        if sync_mode == "isolated_offline":
            network_policy = "offline"
            isolate_algorithm = True
        elif sync_mode == "isolated_online":
            isolate_algorithm = True

        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO user_profiles
                (id, name, sync_mode, isolate_algorithm, network_policy, theme, is_active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
                """,
                (pid, clean_name, sync_mode, 1 if isolate_algorithm else 0, network_policy, theme, now, now),
            )
            conn.execute(
                """
                INSERT INTO handoff_states
                (profile_id, sync_code, track_id, position_sec, mode, device_name, queue_json, theme, eq_preset, updated_at)
                VALUES (?, ?, 'aigis_trk_01', 0.0, 'audio', 'Linux Desktop', '["aigis_trk_01"]', ?, 'orgia', ?)
                """,
                (pid, sync_code, theme, now),
            )

        state = self.list_profiles()
        created = next((p for p in state["profiles"] if p["id"] == pid), None)
        return {
            "created": created,
            "active_profile_id": state["active_profile_id"],
            "active_profile": state["active_profile"],
            "profiles": state["profiles"],
        }

    def switch_profile(self, profile_id: str) -> Dict[str, Any]:
        target_id = (profile_id or "prof_main").strip()
        now = time.time()
        with self._lock, self._connect() as conn:
            exists = conn.execute("SELECT id FROM user_profiles WHERE id = ?", (target_id,)).fetchone()
            if not exists:
                target_id = "prof_main"
            conn.execute("UPDATE user_profiles SET is_active = 0")
            conn.execute(
                "UPDATE user_profiles SET is_active = 1, updated_at = ? WHERE id = ?",
                (now, target_id),
            )
            self.active_profile_id = target_id

        return self.list_profiles()

    def push_handoff_state(
        self,
        profile_id: Optional[str] = None,
        track_id: str = "aigis_trk_01",
        position_sec: float = 0.0,
        mode: str = "audio",
        device_name: str = "Linux Desktop",
        queue_ids: Optional[List[str]] = None,
        theme: Optional[str] = None,
        eq_preset: Optional[str] = None,
    ) -> Dict[str, Any]:
        pid = (profile_id or self.active_profile_id or "prof_main").strip()
        sync_code = self._compute_sync_code(pid)
        now = time.time()
        safe_pos = max(0.0, float(position_sec or 0.0))
        norm_mode = "video" if str(mode).lower() == "video" else "audio"
        q_list = queue_ids if isinstance(queue_ids, list) and queue_ids else [track_id, "aigis_trk_02", "aigis_trk_03"]

        with self._lock, self._connect() as conn:
            cur = conn.execute("SELECT theme, eq_preset FROM handoff_states WHERE profile_id = ?", (pid,)).fetchone()
            use_theme = theme or (cur["theme"] if cur else "aigis")
            use_eq = eq_preset or (cur["eq_preset"] if cur else "orgia")

            conn.execute(
                """
                INSERT INTO handoff_states
                (profile_id, sync_code, track_id, position_sec, mode, device_name, queue_json, theme, eq_preset, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(profile_id) DO UPDATE SET
                    sync_code = excluded.sync_code,
                    track_id = excluded.track_id,
                    position_sec = excluded.position_sec,
                    mode = excluded.mode,
                    device_name = excluded.device_name,
                    queue_json = excluded.queue_json,
                    theme = excluded.theme,
                    eq_preset = excluded.eq_preset,
                    updated_at = excluded.updated_at
                """,
                (
                    pid,
                    sync_code,
                    track_id,
                    safe_pos,
                    norm_mode,
                    device_name or "Linux Desktop",
                    json.dumps(q_list),
                    use_theme,
                    use_eq,
                    now,
                ),
            )

        return self.pull_handoff_state(profile_id=pid)

    def pull_handoff_state(
        self,
        profile_id: Optional[str] = None,
        sync_code: Optional[str] = None,
    ) -> Dict[str, Any]:
        with self._lock, self._connect() as conn:
            row = None
            if sync_code:
                clean_code = str(sync_code).strip().upper()
                row = conn.execute(
                    "SELECT * FROM handoff_states WHERE UPPER(sync_code) = ? LIMIT 1",
                    (clean_code,),
                ).fetchone()

            if not row:
                pid = (profile_id or self.active_profile_id or "prof_main").strip()
                row = conn.execute(
                    "SELECT * FROM handoff_states WHERE profile_id = ? LIMIT 1",
                    (pid,),
                ).fetchone()

            if not row:
                row = conn.execute("SELECT * FROM handoff_states LIMIT 1").fetchone()

            prof_row = conn.execute(
                "SELECT * FROM user_profiles WHERE id = ?",
                (row["profile_id"],),
            ).fetchone()

            try:
                queue_ids = json.loads(row["queue_json"] or "[]")
            except json.JSONDecodeError:
                queue_ids = [row["track_id"]]

            return {
                "profile_id": row["profile_id"],
                "profile_name": prof_row["name"] if prof_row else row["profile_id"],
                "sync_mode": prof_row["sync_mode"] if prof_row else "standard",
                "isolate_algorithm": bool(prof_row["isolate_algorithm"]) if prof_row else False,
                "sync_code": row["sync_code"],
                "track_id": row["track_id"],
                "position_sec": round(float(row["position_sec"]), 3),
                "mode": row["mode"],
                "device_name": row["device_name"],
                "queue_ids": queue_ids,
                "theme": row["theme"],
                "eq_preset": row["eq_preset"],
                "updated_at": row["updated_at"],
            }
