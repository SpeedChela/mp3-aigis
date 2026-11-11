"""
MP3-Aigis Core Backend Engine
High-efficiency, low-memory media engine with offline-first SQLite playlist caching,
account tier session handling, ad/sponsor filtering, and resumable stream management.
Supports standalone zero-Python-install binaries (PyInstaller / Fedora RPM / Windows EXE / Portable).
"""

from __future__ import annotations

import os
import sys

__version__ = "0.1.0"
__author__ = "MP3-Aigis Architecture Team"


def get_bundle_root() -> str:
    """Return the root directory for bundled read-only resources (supports PyInstaller _MEIPASS)."""
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return os.path.abspath(getattr(sys, "_MEIPASS"))
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def get_user_storage_root() -> str:
    """
    Return writable directory for SQLite cache and offline downloads:
    - If running as a Portable executable (`portable.flag` next to executable): `<exe_dir>/portable_data`
    - If running as an installed binary (`sys.frozen`): `~/.local/share/mp3-aigis` (Linux) or `%LOCALAPPDATA%/MP3-Aigis` (Windows)
    - If running from source repository: `<repo_root>`
    """
    if getattr(sys, "frozen", False):
        exe_dir = os.path.dirname(os.path.abspath(sys.executable))
        if os.path.exists(os.path.join(exe_dir, "portable.flag")):
            portable_root = os.path.join(exe_dir, "portable_data")
            os.makedirs(portable_root, exist_ok=True)
            return portable_root
        if sys.platform.startswith("win"):
            base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~\\AppData\\Local")
            app_dir = os.path.join(base, "MP3-Aigis")
        else:
            base = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
            app_dir = os.path.join(base, "mp3-aigis")
        os.makedirs(app_dir, exist_ok=True)
        return app_dir
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def get_web_root() -> str:
    return os.path.join(get_bundle_root(), "web")


def get_default_db_path() -> str:
    data_dir = os.path.join(get_user_storage_root(), "data")
    os.makedirs(data_dir, exist_ok=True)
    return os.path.join(data_dir, "aigis_cache.db")


def get_default_download_dir() -> str:
    dl_dir = os.path.join(get_user_storage_root(), "downloads")
    os.makedirs(dl_dir, exist_ok=True)
    return dl_dir
