#!/usr/bin/env bash
# MP3-Aigis — Automated Android APK Builder (Capacitor / Gradle)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=========================================================="
echo "  MP3-Aigis // Android APK Packaging Pipeline"
echo "=========================================================="

if ! command -v npx >/dev/null 2>&1; then
  echo "[!] Node/npx no detectado localmente. Puedes usar el workflow de GitHub Actions (.github/workflows/release-builds.yml) o instalar Node.js + Android SDK."
  exit 0
fi

cd "$SCRIPT_DIR"
if [ ! -d "android" ]; then
  echo "[1/3] Inicializando proyecto Android con Capacitor..."
  npx @capacitor/cli add android
fi

echo "[2/3] Sincronizando assets Web (Liquid Glass + 7 Temas + Motor Audio DSP)..."
npx @capacitor/cli sync android

echo "[3/3] Compilando APK ligero (Debug & Release-unsigned)..."
cd android
./gradlew assembleDebug
echo "[OK] APK generado en: platforms/android/android/app/build/outputs/apk/debug/app-debug.apk"
