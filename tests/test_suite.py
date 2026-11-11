#!/usr/bin/env python3
"""
MP3-Aigis Comprehensive Automated QA & Bug Verification Test Suite (`tests/test_suite.py`)
Tests:
1. Google Session Tier Detection & Automatic AdBlock / SponsorBlock Policy (Free vs Premium)
2. Seamless Song (ATV) <-> Video (OMV) Mode Switching with Exact Timestamp Preservation
3. Network Failure Resilience on Playlists (SQLite WAL Offline Cache + Sync Journal Reconciliation)
4. Smart Multi-Chunk Download Manager (Multi-Client Probing, SHA-256 Checksum Integrity, Disk Output)
5. Live HTTP Server Endpoints, HTTP 206 Partial Content Range Streaming & Path Traversal Security
6. Frontend Integrity: 7 Themes, 4 Switchable Layouts, Liquid Glass CSS Variables, Cover Color Extractor & 10-Band EQ DSP
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.download_manager import SmartDownloadManager
from backend.playlist_cache import ResilientPlaylistCache
from backend.server import GLOBAL_STATE, create_server
from backend.ytmusic_engine import CATALOG_TRACKS, YTMusicInnerTubeEngine


class TestMP3AigisSuite(unittest.TestCase):
    """Comprehensive verification suite for MP3-Aigis Backend & Frontend."""

    def setUp(self) -> None:
        self.engine = YTMusicInnerTubeEngine()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.temp_dir.name, "test_aigis_cache.db")
        self.dl_dir = os.path.join(self.temp_dir.name, "downloads")
        self.playlist_cache = ResilientPlaylistCache(db_path=self.db_path)
        self.download_mgr = SmartDownloadManager(self.engine, download_dir=self.dl_dir)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    # ------------------------------------------------------------------
    # 1. Google Session Detection & Auto-AdBlock / SponsorBlock
    # ------------------------------------------------------------------
    def test_01_google_session_free_vs_premium_and_adblock(self) -> None:
        """Free account automatically activates AdBlock & SponsorBlock; Premium uses direct high-bitrate streams."""
        # Free account session
        free_status = self.engine.set_session(
            cookie_or_token="SAPISID=free_user_token_123",
            tier="free",
            profile_name="Aigis Free Tester",
            email="aigis.free@sees.org",
        )
        self.assertEqual(free_status["session"]["account_tier"], "free")
        self.assertTrue(free_status["adblock"]["enabled"])
        self.assertTrue(free_status["adblock"]["sponsorblock_enabled"])

        # Verify player payload strips ads on Free account
        ctx_free = self.engine.get_playback_context("aigis_trk_01", mode="audio", position_sec=15.5)
        self.assertNotIn("adPlacements", ctx_free)
        self.assertNotIn("playerAds", ctx_free)
        self.assertNotIn("_simulated_ad_payload", ctx_free)
        self.assertTrue(ctx_free["adblock_meta"]["active"])
        self.assertGreater(ctx_free["adblock_meta"]["ads_stripped_in_request"], 0)

        # Premium account session via cookie hint
        prem_status = self.engine.set_session(
            cookie_or_token="SAPISID=prem_token; music_premium=1",
            profile_name="Aigis Premium Tester",
        )
        self.assertEqual(prem_status["session"]["account_tier"], "premium")
        self.assertFalse(prem_status["adblock"]["enabled"])

        # Logout resets to Guest Free with AdBlock active
        logout_status = self.engine.set_session(cookie_or_token="logout")
        self.assertFalse(logout_status["session"]["logged_in"])
        self.assertEqual(logout_status["session"]["account_tier"], "free")
        self.assertTrue(logout_status["adblock"]["enabled"])

    # ------------------------------------------------------------------
    # 2. Seamless Song (ATV) <-> Video (OMV) Switch Preserving Timestamp
    # ------------------------------------------------------------------
    def test_02_seamless_song_video_switch_timestamp_preservation(self) -> None:
        """Switching between Audio (ATV) and Video (OMV) preserves exact playback timestamp (`position_sec`)."""
        exact_ts = 87.425
        audio_ctx = self.engine.get_playback_context("aigis_trk_02", mode="audio", position_sec=exact_ts)
        video_ctx = self.engine.get_playback_context("aigis_trk_02", mode="video", position_sec=exact_ts)

        self.assertEqual(audio_ctx["playback_mode"], "audio")
        self.assertEqual(video_ctx["playback_mode"], "video")

        # Verify counterpart ATV/OMV IDs are paired properly
        self.assertEqual(audio_ctx["active_content_id"], "ATV_aigis_02")
        self.assertEqual(audio_ctx["counterpart_content_id"], "OMV_aigis_02")
        self.assertEqual(video_ctx["active_content_id"], "OMV_aigis_02")
        self.assertEqual(video_ctx["counterpart_content_id"], "ATV_aigis_02")

        # Verify exact position preservation (0ms drift)
        self.assertAlmostEqual(audio_ctx["resume_position_sec"], exact_ts, places=3)
        self.assertAlmostEqual(video_ctx["resume_position_sec"], exact_ts, places=3)
        self.assertAlmostEqual(video_ctx["position_sec"], exact_ts, places=3)
        self.assertAlmostEqual(video_ctx["preservedPosition"], exact_ts, places=3)
        self.assertAlmostEqual(video_ctx["video_canvas"]["sync_timestamp_sec"], exact_ts, places=3)
        self.assertTrue(video_ctx["video_canvas"]["enabled"])

    # ------------------------------------------------------------------
    # 3. Network Failure Resilience on Playlists (Offline + Sync)
    # ------------------------------------------------------------------
    def test_03_playlist_offline_resilience_and_sync_reconciliation(self) -> None:
        """Playlists survive network disconnections, allow offline mutations, and reconcile when back online."""
        # Initial online state has seeded playlists
        initial_list = self.playlist_cache.list_playlists()
        self.assertTrue(initial_list["network_online"])
        self.assertGreaterEqual(len(initial_list["playlists"]), 3)

        # Simulate network disconnection
        offline_state = self.playlist_cache.set_network_state(False)
        self.assertFalse(offline_state["network_online"])

        # Create a new playlist while offline
        new_pl = self.playlist_cache.create_playlist(
            title="Offline Tartarus Run",
            description="Created during simulated network blackout",
            track_ids=["aigis_trk_01", "aigis_trk_03"],
        )
        self.assertEqual(new_pl["sync_state"], "pending_sync")
        self.assertEqual(new_pl["track_count"], 2)

        # Add a track to an existing playlist while offline
        track_to_add = CATALOG_TRACKS[4]
        updated_pl = self.playlist_cache.add_track_to_playlist(new_pl["id"], track_to_add)
        self.assertEqual(updated_pl["track_count"], 3)
        self.assertEqual(updated_pl["sync_state"], "pending_sync")

        # Remove a track while offline
        after_remove = self.playlist_cache.remove_track_from_playlist(new_pl["id"], "aigis_trk_01")
        self.assertEqual(after_remove["track_count"], 2)

        # Toggle like while offline
        like_res = self.playlist_cache.toggle_like("aigis_trk_05")
        self.assertEqual(like_res["sync_status"], "queued_offline")

        # Verify pending sync ops were journaled
        pending_count = self.playlist_cache.get_pending_ops_count()
        self.assertGreaterEqual(pending_count, 4)

        # Serve cached playlists while still offline without error
        cached_list = self.playlist_cache.list_playlists()
        self.assertFalse(cached_list["network_online"])
        self.assertEqual(cached_list["served_from"], "sqlite_wal_cache")

        # Restore network connection -> automatic reconciliation
        online_state = self.playlist_cache.set_network_state(True)
        self.assertTrue(online_state["network_online"])
        self.assertEqual(online_state["pending_ops_count"], 0)
        self.assertEqual(online_state["reconciled_now"], pending_count)

        reconciled_pl = self.playlist_cache.get_playlist(new_pl["id"])
        self.assertIsNotNone(reconciled_pl)
        self.assertEqual(reconciled_pl["sync_state"], "synced")

    # ------------------------------------------------------------------
    # 4. Smart Multi-Chunk Download Manager & SHA-256 Integrity
    # ------------------------------------------------------------------
    def test_04_smart_multi_chunk_download_manager(self) -> None:
        """Multi-client fallback probing, 4-chunk transfer, SHA-256 verification, and disk output."""
        probe = self.download_mgr.probe_stream_candidates("aigis_trk_03", preferred_format="wav")
        self.assertEqual(probe["track_id"], "aigis_trk_03")
        self.assertEqual(len(probe["probe_log"]), 3)
        self.assertEqual(probe["selected_profile"], "ANDROID_MUSIC")

        task = self.download_mgr.start_download(
            track_id="aigis_trk_03",
            mode="audio",
            preferred_format="wav",
            blocking=True,
        )
        self.assertEqual(task["status"], "completed")
        self.assertEqual(task["progress_pct"], 100)
        self.assertEqual(task["chunks_completed"], 4)
        self.assertTrue(os.path.exists(task["file_path"]))
        self.assertGreater(task["bytes_downloaded"], 10000)

        # Verify SHA-256 checksum matches actual file on disk
        with open(task["file_path"], "rb") as fh:
            disk_bytes = fh.read()
        actual_sha256 = hashlib.sha256(disk_bytes).hexdigest()
        self.assertEqual(task["sha256"], actual_sha256)
        self.assertEqual(disk_bytes[:4], b"RIFF")

        # Verify listing and deletion
        dl_list = self.download_mgr.list_downloads()
        self.assertEqual(dl_list["completed_count"], 1)

        del_res = self.download_mgr.delete_download("aigis_trk_03")
        self.assertTrue(del_res["deleted"])
        self.assertFalse(os.path.exists(task["file_path"]))

    # ------------------------------------------------------------------
    # 5. Live HTTP Server Endpoints & HTTP 206 Range Streaming
    # ------------------------------------------------------------------
    def test_05_live_http_server_endpoints_and_partial_content_range(self) -> None:
        """Start live ThreadingHTTPServer on ephemeral port and verify all REST & streaming routes."""
        server = create_server(host="127.0.0.1", port=0)
        port = server.server_address[1]
        base_url = f"http://127.0.0.1:{port}"
        server_thread = threading.Thread(target=server.serve_forever, daemon=True)
        server_thread.start()

        try:
            def get_json(path: str):
                with urllib.request.urlopen(f"{base_url}{path}", timeout=5) as resp:
                    return resp.status, json.loads(resp.read().decode("utf-8"))

            def post_json(path: str, payload: dict):
                data = json.dumps(payload).encode("utf-8")
                req = urllib.request.Request(
                    f"{base_url}{path}",
                    data=data,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=5) as resp:
                    return resp.status, json.loads(resp.read().decode("utf-8"))

            # /api/status
            status_code, status_data = get_json("/api/status")
            self.assertEqual(status_code, 200)
            self.assertIn("resources", status_data)
            self.assertLess(status_data["resources"]["rss_memory_mb"], 250.0)

            # /api/home
            status_code, home_data = get_json("/api/home")
            self.assertEqual(status_code, 200)
            self.assertIn("quick_picks", home_data)
            self.assertIn("mixed_for_you", home_data)
            self.assertGreaterEqual(len(home_data["quick_picks"]), 6)

            # /api/search (catalog & dynamic fallback)
            status_code, search_data = get_json("/api/search?q=Midnight")
            self.assertEqual(status_code, 200)
            self.assertGreaterEqual(search_data["count"], 1)

            status_code, dyn_search = get_json("/api/search?q=PersonaReloadSpecialRemix2025")
            self.assertEqual(status_code, 200)
            self.assertEqual(dyn_search["count"], 1)

            # /api/player/resolve
            status_code, resolve_data = get_json("/api/player/resolve?id=aigis_trk_01&mode=video&pos=33.5")
            self.assertEqual(status_code, 200)
            self.assertEqual(resolve_data["playback_mode"], "video")
            self.assertAlmostEqual(resolve_data["resume_position_sec"], 33.5, places=2)

            # /api/stream/<id> with Range: bytes=0-1023 -> HTTP 206 Partial Content
            range_req = urllib.request.Request(
                f"{base_url}/api/stream/aigis_trk_01",
                headers={"Range": "bytes=0-1023"},
            )
            with urllib.request.urlopen(range_req, timeout=5) as resp:
                self.assertEqual(resp.status, 206)
                self.assertIn("bytes 0-1023/", resp.headers.get("Content-Range", ""))
                chunk = resp.read()
                self.assertEqual(len(chunk), 1024)
                self.assertEqual(chunk[:4], b"RIFF")

            # /api/network/simulate (offline -> create playlist -> online)
            status_code, sim_off = post_json("/api/network/simulate", {"offline": True})
            self.assertEqual(status_code, 200)
            self.assertFalse(sim_off["network_online"])

            status_code, created_pl = post_json(
                "/api/playlists",
                {"title": "QA Offline Test Playlist", "track_ids": ["aigis_trk_01"]},
            )
            self.assertEqual(status_code, 201)
            self.assertEqual(created_pl["sync_state"], "pending_sync")

            status_code, sim_on = post_json("/api/network/simulate", {"online": True})
            self.assertEqual(status_code, 200)
            self.assertTrue(sim_on["network_online"])
            self.assertEqual(sim_on["pending_ops_count"], 0)

            # /api/downloads
            status_code, dl_post = post_json(
                "/api/downloads",
                {"track_id": "aigis_trk_02", "blocking": True},
            )
            self.assertEqual(status_code, 202)
            self.assertEqual(dl_post["status"], "completed")

            status_code, dl_list = get_json("/api/downloads")
            self.assertEqual(status_code, 200)
            self.assertGreaterEqual(dl_list["completed_count"], 1)

            # /api/eq/smart (Smart Auto-EQ genre/track adaptation)
            status_code, eq_synth = get_json("/api/eq/smart?id=aigis_trk_01")
            self.assertEqual(status_code, 200)
            self.assertEqual(eq_synth["preset_id"], "orgia")
            self.assertEqual(len(eq_synth["gains"]), 10)

            status_code, eq_techno = get_json("/api/eq/smart?id=aigis_trk_07")
            self.assertEqual(status_code, 200)
            self.assertEqual(eq_techno["preset_id"], "bass")
            self.assertEqual(len(eq_techno["gains"]), 10)

            # /api/profiles (Multi-profile isolation & Cross-Device Handoff)
            status_code, prof_list = get_json("/api/profiles")
            self.assertEqual(status_code, 200)
            self.assertGreaterEqual(len(prof_list["profiles"]), 3)

            # Switch to Guest Borrowed Online profile (isolate_algorithm=True)
            status_code, sw_guest = post_json(
                "/api/profiles",
                {"action": "switch", "profile_id": "prof_guest_online"},
            )
            self.assertEqual(status_code, 200)
            self.assertEqual(sw_guest["active_profile_id"], "prof_guest_online")
            self.assertTrue(sw_guest["active_profile"]["isolate_algorithm"])
            self.assertTrue(sw_guest["network_online"])

            # Switch to Private Offline profile (network_policy='offline' forces offline state)
            status_code, sw_priv = post_json(
                "/api/profiles",
                {"action": "switch", "profile_id": "prof_private_offline"},
            )
            self.assertEqual(status_code, 200)
            self.assertEqual(sw_priv["active_profile_id"], "prof_private_offline")
            self.assertTrue(sw_priv["active_profile"]["isolate_algorithm"])
            self.assertFalse(sw_priv["network_online"])

            # Switch back to Main profile & verify Cross-Device Handoff push/pull
            status_code, sw_main = post_json(
                "/api/profiles",
                {"action": "switch", "profile_id": "prof_main"},
            )
            self.assertEqual(status_code, 200)
            self.assertEqual(sw_main["active_profile_id"], "prof_main")
            self.assertFalse(sw_main["active_profile"]["isolate_algorithm"])
            self.assertTrue(sw_main["network_online"])

            status_code, pushed = post_json(
                "/api/profiles",
                {
                    "action": "handoff_push",
                    "profile_id": "prof_main",
                    "track_id": "aigis_trk_06",
                    "position_sec": 74.25,
                    "mode": "video",
                    "device_name": "Steam Deck OLED",
                    "queue_ids": ["aigis_trk_06", "aigis_trk_01"],
                },
            )
            self.assertEqual(status_code, 200)
            self.assertEqual(pushed["track_id"], "aigis_trk_06")
            self.assertAlmostEqual(pushed["position_sec"], 74.25, places=2)
            self.assertEqual(len(pushed["sync_code"]), 6)

            status_code, pulled = post_json(
                "/api/profiles",
                {"action": "handoff_pull", "sync_code": pushed["sync_code"]},
            )
            self.assertEqual(status_code, 200)
            self.assertEqual(pulled["track_id"], "aigis_trk_06")
            self.assertAlmostEqual(pulled["position_sec"], 74.25, places=2)
            self.assertEqual(pulled["mode"], "video")
        finally:
            GLOBAL_STATE.playlists.set_network_state(True)
            server.shutdown()
            server.server_close()

    # ------------------------------------------------------------------
    # 6. Frontend Integrity: 7 Themes, 4 Layouts, Liquid Glass & 10-Band EQ
    # ------------------------------------------------------------------
    def test_06_frontend_themes_layouts_liquid_glass_and_eq_integrity(self) -> None:
        """Verify all 7 themes, 4 layouts, Liquid Glass CSS variables, and 10-band EQ presets exist."""
        web_dir = PROJECT_ROOT / "web"
        index_html = (web_dir / "index.html").read_text(encoding="utf-8")
        base_css = (web_dir / "css" / "base-liquid-glass.css").read_text(encoding="utf-8")
        themes_css = (web_dir / "css" / "themes.css").read_text(encoding="utf-8")
        audio_js = (web_dir / "js" / "audio-engine.js").read_text(encoding="utf-8")
        color_js = (web_dir / "js" / "color-extractor.js").read_text(encoding="utf-8")
        offline_js = (web_dir / "js" / "offline-sync.js").read_text(encoding="utf-8")
        app_js = (web_dir / "js" / "app.js").read_text(encoding="utf-8")

        # Verify all 7 themes in HTML, CSS, and Color/Theme Engine JS
        required_themes = ["aigis", "persona3", "persona5", "sonic", "miku", "godzilla", "tachyon"]
        for theme in required_themes:
            self.assertIn(f'data-theme="{theme}"', themes_css, f"Missing theme in themes.css: {theme}")
            self.assertIn(f'value="{theme}"', index_html, f"Missing theme option in index.html: {theme}")
            self.assertIn(f"id: '{theme}'", color_js, f"Missing theme profile in color-extractor.js: {theme}")

        # Verify all 4 switchable layouts in HTML and CSS
        required_layouts = ["hybrid", "ytmusic", "spotify", "custom"]
        for layout in required_layouts:
            self.assertIn(f'data-layout="{layout}"', base_css, f"Missing layout in base-liquid-glass.css: {layout}")
            self.assertIn(f'value="{layout}"', index_html, f"Missing layout option in index.html: {layout}")

        # Verify Liquid Glass CSS variables & Dynamic Song Color variables
        required_css_vars = [
            "--glass-blur",
            "--glass-saturate",
            "--glass-specular-top",
            "--song-color-primary",
            "--song-color-secondary",
            "--song-color-accent",
        ]
        for css_var in required_css_vars:
            self.assertIn(css_var, base_css, f"Missing CSS variable in base-liquid-glass.css: {css_var}")

        # Verify 10-band EQ frequencies and DSP presets in audio-engine.js & index.html
        eq_bands = ["31", "62", "125", "250", "500", "1000", "2000", "4000", "8000", "16000"]
        for freq in eq_bands:
            self.assertIn(f'data-freq="{freq}"', index_html, f"Missing EQ band slider {freq}Hz in index.html")
            self.assertIn(freq, audio_js, f"Missing EQ frequency {freq}Hz in audio-engine.js")

        for preset in ["flat", "orgia", "vocaloid", "tachyon", "bass", "rock", "sonic"]:
            self.assertIn(preset, audio_js, f"Missing EQ preset {preset} in audio-engine.js")

        # Verify Offline Sync and App JS classes are properly defined
        self.assertIn("AigisOfflineSyncEngine", offline_js)
        self.assertIn("MP3AigisApp", app_js)


if __name__ == "__main__":
    unittest.main(verbosity=2)
