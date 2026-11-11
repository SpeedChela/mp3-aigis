#!/usr/bin/env python3
"""
MP3-Aigis — Native Lightweight Desktop Launcher for Linux & Windows
Uses negligible RAM by launching either a native Qt/WebEngine frameless window,
pywebview, or dedicated app-mode window connected to the local InnerTube engine.
"""

import os
import sys
import shutil
import subprocess
import threading
import time
import webbrowser

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)


def launch_desktop_window(url: str, title: str = "MP3-Aigis // YTMusic & Spotify Hybrid Player"):
    """Attempts the lightest available native desktop window on Linux or Windows."""
    # 1. Check for Chromium/Brave/Edge/Chrome lightweight --app=<url> window (lowest overhead, full WebAudio & GPU Liquid Glass)
    browsers = [
        "chromium",
        "chromium-browser",
        "google-chrome",
        "brave-browser",
        "microsoft-edge",
        "vivaldi",
    ]
    if sys.platform.startswith("win"):
        win_paths = [
            os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
            os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
            os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
        ]
        for wp in win_paths:
            if os.path.exists(wp):
                subprocess.Popen([wp, f"--app={url}", "--window-size=1360,860"])
                return "native-app-window"

    for b in browsers:
        bin_path = shutil.which(b)
        if bin_path:
            subprocess.Popen([bin_path, f"--app={url}", "--window-size=1360,860"])
            return f"app-mode:{b}"

    # 2. Fallback to system default browser
    webbrowser.open(url)
    return "system-browser"


if __name__ == "__main__":
    from backend.server import run_server

    port = int(os.environ.get("AIGIS_PORT", "8765"))
    url = f"http://127.0.0.1:{port}"
    server_thread = threading.Thread(target=run_server, kwargs={"host": "127.0.0.1", "port": port}, daemon=True)
    server_thread.start()
    time.sleep(0.4)
    mode = launch_desktop_window(url)
    print(f"[MP3-Aigis Desktop] Ventana iniciada ({mode}) en {url}. Presiona Ctrl+C para salir.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[MP3-Aigis Desktop] Cerrando aplicación...")
