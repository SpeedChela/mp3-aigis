# MP3-Aigis // YTMusic & Spotify Hybrid Liquid Glass Audio Workstation

> **Estación de Audio Híbrida (Spotify + YouTube Music) de Ultra-Bajo Consumo (< 35 MB RAM RSS en Backend)** con interfaz **Liquid Glass**, extracción dinámica de color de portada en tiempo real, conmutación instantánea **Canción (ATV) ↔ Video (OMV)** con **0 ms de desfase**, **AdBlock + SponsorBlock** automático para cuentas gratuitas de Google, **Playlists Offline-First** resilientes a caídas de red, motor de descargas multi-chunk con verificación **SHA-256**, ecualizador DSP **WebAudio de 10 bandas** y **7 temas icónicos**.

---

## Tabla de Contenidos

1. [Arquitectura del Sistema y Eficiencia de Recursos](#-arquitectura-del-sistema-y-eficiencia-de-recursos)
2. [Características Principales](#-características-principales)
   - [Interfaz Híbrida Spotify + YouTube Music (4 Layouts)](#1-interfaz-híbrida-spotify--youtube-music-4-layouts-conmutables)
   - [Sesión de Google Ligera + Auto-AdBlock para Cuentas Gratuitas](#2-sesión-de-google-ligera--auto-adblock-para-cuentas-gratuitas)
   - [Playlists Resilientes Offline-First (Anti-Cortes de Red)](#3-playlists-resilientes-offline-first-anti-cortes-de-red)
   - [Descargas Inteligentes Multi-Chunk con Verificación SHA-256](#4-descargas-inteligentes-multi-chunk-con-verificación-sha-256)
   - [Conmutación Instantánea Canción (ATV) ↔ Video (OMV)](#5-conmutación-instantánea-canción-atv--video-omv-sin-bugs)
   - [Estudio de Audio DSP y Ecualizador WebAudio de 10 Bandas](#6-estudio-de-audio-dsp-y-ecualizador-webaudio-de-10-bandas)
   - [Motor Liquid Glass, Color Dinámico de Portada y Modo Eco](#7-motor-liquid-glass-color-dinámico-de-portada-y-modo-eco)
3. [Los 7 Temas Oficiales](#-los-7-temas-oficiales)
4. [Guía de Ejecución Multiplataforma](#-guía-de-ejecución-multiplataforma)
   - [Web / PWA (Navegador)](#1-modo-web--pwa-multiplataforma)
   - [Linux Desktop (Nativo Ligero)](#2-linux-desktop)
   - [Windows Desktop](#3-windows-desktop)
   - [Compilación de APK para Android](#4-compilación-del-apk-para-android)
5. [Referencia de API REST Local](#-referencia-de-api-rest-local)

---

## Arquitectura del Sistema y Eficiencia de Recursos

A diferencia de los clientes basados en Electron que consumen entre **450 MB y 800 MB de RAM**, **MP3-Aigis** está diseñado desde cero bajo una arquitectura **Zero-Bloat**:

```
mp3-aigis/
├── run.py                          # Lanzador unificado (--web, --desktop, --check)
├── backend/
│   ├── server.py                   # Servidor HTTP/1.1 Threading + Streaming 206 Partial Content (<35 MB RAM)
│   ├── ytmusic_engine.py           # Motor InnerTube YTMusic, Sesión Google & Escudo AdBlock/SponsorBlock
│   ├── playlist_cache.py           # Caché SQLite en modo WAL + Cola de Reconciliación Offline
│   └── download_manager.py         # Gestor de Descargas Multi-Chunk + Failover Multi-Cliente + SHA-256
├── web/
│   ├── index.html                  # SPA Híbrida con 5 vistas dinámicas y 4 arquitecturas de Layout
│   ├── manifest.json & sw.js       # Soporte PWA e interceptación offline mediante Service Worker
│   ├── css/
│   │   ├── base-liquid-glass.css   # Refracción Liquid Glass GPU, 4 Layouts y Modo Eco
│   │   └── themes.css              # Los 7 temas visuales y telemetría HUD
│   └── js/
│       ├── app.js                  # Controlador principal, sincronización O(1) de letras y UI
│       ├── audio-engine.js         # Grafo WebAudio DSP de 10 bandas y switcher Canción <-> Video
│       ├── color-extractor.js      # Cuantización 32x32 con caché LRU O(1) y gestor de temas
│       └── offline-sync.js         # Sincronización optimista de playlists y simulador de red
├── platforms/
│   ├── desktop/
│   │   ├── desktop_app.py          # Lanzador nativo ligero para Linux y Windows
│   │   └── tauri.conf.json         # Configuración opcional para empaquetado Tauri
│   └── android/
│       ├── capacitor.config.json   # Configuración de contenedor móvil Android
│       └── build-apk.sh            # Pipeline automatizado para generar el APK
```

---

## Características Principales

### 1. Interfaz Híbrida Spotify + YouTube Music (4 Layouts Conmutables)
Combina la velocidad y densidad de biblioteca de **Spotify Desktop** con el algoritmo de descubrimiento, supermixes y conmutación de video de **YouTube Music**:
- **`hybrid` (Por defecto)**: Barra lateral de biblioteca y playlists offline + Escenario central con chips de filtro + Panel derecho con pestañas de **Cola**, **Letras Sincronizadas** y **Algoritmo** + Barra inferior flotante Liquid Glass.
- **`ytmusic`**: Diseño inspirado en YouTube Music mejorado, con barra superior extendida y escenario inmersivo.
- **`spotify`**: División clásica en 3 islas redondeadas de alta densidad.
- **`custom`**: Grid modular configurable en tiempo real (posición de barra lateral a izquierda/derecha/oculta, densidad de filas compacta/confortable/espaciosa e intensidad de desenfoque del cristal).

### 2. Sesión de Google Ligera + Auto-AdBlock para Cuentas Gratuitas
- Inspección ultraligera de sesión (`SAPISID` / cookies de sesión locales) únicamente para personalizar las recomendaciones del algoritmo de YouTube Music y detectar el nivel de suscripción (`free` vs `premium`).
- **Activación Automática de AdBlock**: Si se detecta una cuenta **Gratuita (`free`)**, el motor activa automáticamente el escudo **Aigis AdShield + SponsorBlock**, eliminando `adPlacements`, `playerAds`, cortes publicitarios de audio/video y silencios patrocinados sin intervención del usuario.
- **Modo Premium Directo**: Si detecta **YouTube Music Premium (`premium`)**, habilita el flujo directo de alto bitrate (`256 kbps AAC` / `160 kbps Opus`) sin sobrecarga de filtrado.

### 3. Playlists Resilientes Offline-First (Anti-Cortes de Red)
Soluciona el fallo crítico de YouTube Music donde una caída momentánea de Wi-Fi o datos móviles congela la reproducción o vacía las listas de reproducción:
- **Doble Persistencia (SQLite WAL + LocalStorage/IndexedDB)**: Todas las playlists y pistas se respaldan localmente en una base de datos SQLite en modo `Write-Ahead Logging` (`data/aigis_cache.db`) y en el almacenamiento del navegador.
- **Mutaciones Optimistas y Cola Diferida (`pending_sync_ops`)**: Puedes crear playlists, dar *Me Gusta* o agregar/quitar canciones incluso sin conexión; al volver la red, la cola de operaciones se reconcilia automáticamente sin perder ningún cambio.
- Incluye un botón **"Simular Caída"** en la barra superior para comprobar en vivo cómo el audio y las playlists siguen funcionando sin interrupciones.

### 4. Descargas Inteligentes Multi-Chunk con Verificación SHA-256
Resuelve los errores de detección de stream (`403 Forbidden` o firmas caducadas) habituales en descargadores convencionales:
- **Failover Multi-Cliente InnerTube**: Sondea automáticamente entre perfiles de cliente (`ANDROID_MUSIC`, `IOS_MUSIC`, `WEB_REMIX`, `TVHTML5_SIMPLY_EMBEDDED_PLAYER`) hasta obtener un stream limpio y directo.
- **Descarga Segmentada (`Multi-Chunk`)**: Descarga en bloques paralelos/secuenciales con soporte `HTTP Range` y reintentos con *exponential backoff*.
- **Integridad Criptográfica**: Verifica el hash **SHA-256** del archivo ensamblado antes de marcarlo como disponible para reproducción offline instantánea.

### 5. Conmutación Instantánea Canción (ATV) ↔ Video (OMV) sin Bugs
- Alterna en cualquier momento entre el modo **Canción** (Audio Master Oficial `ATV`) y el modo **Video** (Video Musical Oficial `OMV`) desde la píldora superior, la tabla de canciones o el escenario.
- **0 ms de Desfase (`Zero Timestamp Drift`)**: El motor conserva el segundo y milisegundo exacto (`currentTime`), el estado de reproducción (`playing`/`paused`) y mantiene intacto el grafo de ecualización WebAudio sin reiniciar la pista ni provocar cortes.

### 6. Estudio de Audio DSP y Ecualizador WebAudio de 10 Bandas
Procesamiento en tiempo real mediante nodos nativos `BiquadFilterNode` y `DynamicsCompressorNode`:
- **10 Bandas ISO**: `31Hz`, `62Hz`, `125Hz`, `250Hz`, `500Hz`, `1kHz`, `2kHz`, `4kHz`, `8kHz` y `16kHz` (±12 dB por banda) + **Preamp** dedicado.
- **Sub-Bass Boost**, **Spatial Stereo Exciter**, **Crossfade Inteligente** (0–12 s), reproducción **Gapless** y **Normalización LUFS (-14 LUFS)** para evitar saltos bruscos de volumen entre pistas.
- **8 Presets Integrados**: *Plano (Studio Reference)*, *Aigis Orgia Overdrive*, *Hatsune Miku CV01*, *Agnes Tachyon Factor*, *Godzilla Atomic Bass*, *Phantom Thieves Rock*, *Supersonic Ring Boost* y *Tartarus Midnight Clear*.

### 7. Motor Liquid Glass, Color Dinámico de Portada y Modo Eco
- **Refracción Liquid Glass**: Superficies translúcidas multicapa con bordes especulares cromáticos.
- **Extracción Dinámica de Color O(1)**: Muestrea la portada de la canción actual en un lienzo reducido de `32x32` píxeles con caché LRU para extraer los tonos primario, secundario y de acento, iluminando toda la interfaz y el visualizador de frecuencias al ritmo de cada pista.
- **Modo Eco (Ultra-Bajo Consumo)**: Con un clic desactiva los pases de `backdrop-filter: blur()`, las órbitas ambientales y congela el renderizado de canvas cuando el audio está en pausa o la ventana está oculta (`0.0%` CPU en reposo).

---

## Los 7 Temas Oficiales

Cada tema modifica profundamente las variables CSS, geometría de tarjetas, patrones de fondo, barras de progreso, tipografía HUD y preajustes sugeridos del ecualizador:

| ID | Tema | Inspiración & Estética Visual | Paleta Dominante | Preset DSP Asociado |
| :--- | :--- | :--- | :--- | :--- |
| `aigis` | **Aigis (Persona 3)** *(Por defecto)* | Armadura de titanio marfil, azul cobalto S.E.E.S., núcleo dorado *Papillon Heart*, retícula táctica giratoria y **Modo Orgia / Overdrive**. | `#1A56DB` • `#38BDF8` • `#F59E0B` | `Aigis Orgia Overdrive` |
| `persona3` | **Persona 3 Reload** | Estética *Dark Hour* y Tártaro, cristal cian medianoche, menús y tarjetas con inclinación diagonal (`skewX`) y sombras geométricas. | `#0077FF` • `#00D4FF` • `#7EF9FF` | `Tartarus Midnight Clear` |
| `persona5` | **Persona 5 (Phone IM UI)** | Interfaz inspirada en el smartphone IM de Joker y los *Phantom Thieves*: rojo carmesí rebelde, negro absoluto, recortes poligonales agresivos (`clip-path`) y filas de canciones estilo burbuja de chat. | `#E60012` • `#0A0A0A` • `#FFFFFF` | `Phantom Thieves Rock` |
| `sonic` | **Sonic the Hedgehog** | Azul supersónico cobalto, anillos dorados brillantes, patrón ajedrezado *Emerald Hill* y barra de progreso estilo *Boost Gauge*. | `#0055FF` • `#00B4FF` • `#FFD700` | `Supersonic Ring Boost` |
| `miku` | **Hatsune Miku (CV01)** | Ciber-turquesa Vocaloid (`#39C5BB`), magenta eléctrico, cuadrícula de matriz de sintetizador e insignia `"01"` en el escenario principal. | `#39C5BB` • `#00F5D4` • `#FF2A85` | `Hatsune Miku CV01` |
| `godzilla` | **Godzilla (Kaiju Atomic)** | Escamas de obsidiana dorsal, pulso azul neón de radiación *Cherenkov* (aliento atómico) y telemetría ámbar estilo *Monarch Outpost 54*. | `#0284C7` • `#00F0FF` • `#F59E0B` | `Godzilla Atomic Bass` |
| `tachyon` | **Agnes Tachyon (Uma Musume)** | Laboratorio científico bioluminiscente verde lima experimental (`#39FF14`), tubos de ensayo ámbar, red molecular hexagonal y fórmula `c² < v² // TACHYON FACTOR`. | `#10B981` • `#39FF14` • `#F59E0B` | `Agnes Tachyon Factor` |

---

## Guía de Ejecución Multiplataforma

**MP3-Aigis** no requiere dependencias pesadas externas: su motor central funciona directamente con la biblioteca estándar de **Python 3.9+**.

### Diagnóstico Rápido del Motor (`Self-Check`)
Antes de iniciar, puedes verificar el motor InnerTube, el escudo AdBlock, la caché SQLite Offline, el conmutador Canción/Video y el gestor de descargas SHA-256 ejecutando:
```bash
python3 run.py --check
```

### 1. Modo Web / PWA (Multiplataforma)
Inicia el servidor local de alto rendimiento y abre la aplicación en tu navegador (con soporte de instalación PWA):
```bash
# Inicia en http://127.0.0.1:8765 y abre el navegador automáticamente
python3 run.py --web

# O inicia el servidor sin abrir ventana automáticamente (útil para servidores o desarrollo)
python3 run.py --port 8765 --no-open
```

### 2. Linux Desktop
Ejecuta **MP3-Aigis** en una ventana dedicada sin bordes de navegador (*Chromeless App Mode*) con aceleración GPU para Liquid Glass y WebAudio, consumiendo una fracción mínima de RAM frente a Electron:
```bash
# Opción A: Mediante el lanzador unificado
python3 run.py --desktop

# Opción B: Mediante el lanzador nativo de escritorio
python3 platforms/desktop/desktop_app.py
```

### 3. Windows Desktop
En **Windows 10 / 11**, el lanzador detecta automáticamente Microsoft Edge, Google Chrome o Brave en modo aplicación nativa (`--app`) conectado al motor local:
```powershell
# Desde PowerShell o CMD en la raíz del proyecto
python run.py --desktop

# O ejecutando directamente el lanzador de escritorio
python platforms\desktop\desktop_app.py
```

### 4. Compilación del APK para Android
El directorio `platforms/android/` incluye la configuración de **Capacitor** (`capacitor.config.json`) y el script automatizado `build-apk.sh` para empaquetar toda la interfaz Liquid Glass, los 7 temas y el motor DSP en un APK ligero para Android:
```bash
# Requisitos para compilar localmente: Node.js (npx) + Android SDK / Gradle
bash platforms/android/build-apk.sh
```
El archivo instalable se generará en:
`platforms/android/android/app/build/outputs/apk/debug/app-debug.apk`

---

## Referencia de API REST Local

| Método | Endpoint | Descripción |
| :--- | :--- | :--- |
| `GET` | `/api/status` | Telemetría de RAM/CPU en vivo, estado de sesión Google, contador AdBlock y estado de red/descargas. |
| `GET` | `/api/home` | Feed principal del algoritmo (*Quick Picks*, *Supermixes* y catálogo temático). |
| `GET` | `/api/search?q=<texto>&filter=<filtro>` | Búsqueda instantánea filtrada por canciones, videos, género o disponibilidad offline. |
| `GET` | `/api/player/resolve?id=<id>&mode=audio\|video&pos=<seg>` | Resuelve el par exacto Canción (`ATV`) o Video (`OMV`) preservando el timestamp (`resume_position_sec`). |
| `GET` | `/api/stream/<id>` | Streaming de audio libre de anuncios con soporte completo `HTTP 206 Partial Content` (`Range: bytes=...`). |
| `GET` | `/api/playlists` / `/api/playlists/<id>` | Lista y consulta playlists desde la caché resiliente SQLite WAL. |
| `POST` | `/api/playlists` | Crea playlists, añade/elimina pistas o alterna *Me Gusta* con soporte de cola offline. |
| `POST` | `/api/downloads` | Inicia una descarga inteligente multi-chunk con verificación SHA-256. |
| `POST` | `/api/auth/session` | Configura la sesión de Google (`free` o `premium`) y ajusta automáticamente la política AdBlock. |
| `POST` | `/api/network/simulate` | Simula desconexión/reconexión de red para verificar la resiliencia offline y la reconciliación automática. |

---

## Licencia

Distribuido bajo la licencia incluida en el archivo [`LICENSE`](LICENSE).
