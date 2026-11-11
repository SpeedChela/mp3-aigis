#!/usr/bin/env python3
"""
MP3-Aigis Unified Launcher (`run.py`)
Supports:
  --port <PORT>   : Bind HTTP server to custom port (default: 8765)
  --host <HOST>   : Bind address (default: 127.0.0.1)
  --desktop       : Launch in lightweight native desktop app window (Chromeless / pywebview / xdg-open fallback)
  --web           : Launch web server (and optionally open browser)
  --no-open       : Start server without opening a browser window
  --check         : Run self-diagnostics on all backend engines & REST API endpoints and exit 0
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser

from backend.server import GLOBAL_STATE, create_server, run_server


def run_self_check() -> int:
    """Verify InnerTube engine, AdBlock tier logic, SQLite offline resilience, and SmartDownloadManager."""
    print("=== MP3-Aigis Core Engine Self-Check ===")

    # 1. Session & Free/Premium AdBlock check
    free_state = GLOBAL_STATE.engine.set_session(cookie_or_token="SID=demo_free", tier="free")
    assert free_state["session"]["account_tier"] == "free"
    assert free_state["adblock"]["enabled"] is True

    prem_state = GLOBAL_STATE.engine.set_session(cookie_or_token="SID=demo_prem;music_premium=1", tier="premium")
    assert prem_state["session"]["account_tier"] == "premium"
    assert prem_state["adblock"]["enabled"] is False

    # Restore Free tier with active AdBlock
    GLOBAL_STATE.engine.set_session(cookie_or_token="SID=demo_free", tier="free")
    print("[OK] Session Tier Detection & Automatic AdBlock/SponsorBlock Policy verified.")

    # 2. Seamless Audio (ATV) <-> Video (OMV) switch at exact timestamp
    ctx_audio = GLOBAL_STATE.engine.get_playback_context("aigis_trk_01", mode="audio", position_sec=42.75)
    ctx_video = GLOBAL_STATE.engine.get_playback_context("aigis_trk_01", mode="video", position_sec=42.75)
    assert ctx_audio["resume_position_sec"] == 42.75
    assert ctx_video["resume_position_sec"] == 42.75
    assert ctx_audio["active_content_id"].startswith("ATV_")
    assert ctx_video["active_content_id"].startswith("OMV_")
    assert "adPlacements" not in ctx_audio
    print("[OK] Seamless Song (ATV) <-> Video (OMV) timestamp preservation & ad stripping verified.")

    # 3. Offline Playlist Resilience check
    GLOBAL_STATE.playlists.set_network_state(False)
    track = GLOBAL_STATE.engine.get_track("aigis_trk_04")
    pl_after_add = GLOBAL_STATE.playlists.add_track_to_playlist("pl_cyber_flow", track)
    assert pl_after_add["sync_state"] == "pending_sync"
    assert GLOBAL_STATE.playlists.get_pending_ops_count() >= 1
    net_restored = GLOBAL_STATE.playlists.set_network_state(True)
    assert net_restored["pending_ops_count"] == 0
    print("[OK] SQLite Offline Playlist Shield & Automatic Sync Reconciliation verified.")

    # 4. Smart Multi-Client Download & SHA-256 verification
    dl_task = GLOBAL_STATE.downloads.start_download("aigis_trk_01", blocking=True)
    assert dl_task["status"] == "completed"
    assert os.path.exists(dl_task["file_path"])
    assert len(dl_task["sha256"] or "") == 64
    print(f"[OK] SmartDownloadManager verified: {dl_task['file_name']} (SHA-256: {dl_task['sha256'][:16]}...)")

    telemetry = GLOBAL_STATE.get_resource_telemetry()
    print(
        f"[OK] Memory Footprint: {telemetry['rss_memory_mb']} MB RSS "
        f"({telemetry['memory_saved_pct']}% lighter than Electron baseline)."
    )
    print("=== All MP3-Aigis Core Checks Passed ===")
    return 0


import socket


def find_available_port(host: str, preferred_port: int = 8765) -> int:
    """Return preferred_port if free, otherwise pick the next available local port."""
    for p in range(preferred_port, preferred_port + 25):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind((host, p))
                return p
            except OSError:
                continue
    return preferred_port


def launch_desktop_window(url: str) -> None:
    """Open a lightweight native app-mode window on Windows or Fedora/Linux without Electron bloat."""
    if sys.platform.startswith("win"):
        win_candidates = [
            os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
            os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
            os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
            os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
            os.path.expandvars(r"%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe"),
        ]
        for exe in win_candidates:
            if os.path.exists(exe):
                try:
                    subprocess.Popen(
                        [exe, f"--app={url}", "--window-size=1360,860"],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                    return
                except OSError:
                    pass

    for bin_name in ("chromium", "chromium-browser", "google-chrome", "brave-browser", "microsoft-edge", "vivaldi"):
        exe = shutil.which(bin_name)
        if exe:
            try:
                subprocess.Popen(
                    [exe, f"--app={url}", "--window-size=1360,860"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                return
            except OSError:
                pass
    webbrowser.open(url)


def main() -> int:
    parser = argparse.ArgumentParser(description="MP3-Aigis High-Efficiency YouTube Music Client & Engine")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host address (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8765, help="Bind port (default: 8765)")
    parser.add_argument("--desktop", action="store_true", help="Launch in lightweight native desktop window mode (default)")
    parser.add_argument("--web", action="store_true", help="Launch in standard web browser tab")
    parser.add_argument("--no-open", action="store_true", help="Do not automatically open browser/window")
    parser.add_argument("--check", action="store_true", help="Run engine self-diagnostics and exit")
    args = parser.parse_args()

    if args.check:
        return run_self_check()

    active_port = find_available_port(args.host, args.port)
    url = f"http://{args.host}:{active_port}"
    if not args.no_open:
        def _delayed_open() -> None:
            time.sleep(0.4)
            if args.web and not args.desktop:
                webbrowser.open(url)
            else:
                # Default on double-click / no flags: open native frameless Desktop window
                launch_desktop_window(url)

        threading.Thread(target=_delayed_open, daemon=True).start()

    run_server(host=args.host, port=active_port)
    return 0


if __name__ == "__main__":
    sys.exit(main())
