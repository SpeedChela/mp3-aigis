---
name: code-optimizer
description: Agente especializado en optimización de código, reducción de consumo de RAM/CPU, WebAudio DSP eficiente y renderizado GPU Liquid Glass de bajo impacto.
role: Code Optimization Specialist
---

# Agente de Optimización de Código (`code-optimizer`)

## Objetivo Principal
Garantizar que **MP3-Aigis** mantenga un consumo mínimo de memoria RAM (< 80 MB en modo ligero) y CPU (< 2% en reproducción de audio en segundo plano), superando las limitaciones de rendimiento de la web oficial de YouTube Music.

## Áreas de Intervención
1. **Motor de Audio DSP (`web/js/audio-engine.js`)**:
   - Reutilización de nodos `AudioContext`, `BiquadFilterNode` (10 bandas), `GainNode` y `AnalyserNode` sin recrear grafos en cada cambio de pista.
   - Desactivación automática del `requestAnimationFrame` del visualizador cuando la pestaña está oculta (`document.hidden`) o cuando el **Modo Eco** está activo.
2. **Interfaz Liquid Glass y Temas (`web/css/base-liquid-glass.css`, `web/css/themes.css`)**:
   - Uso de `will-change: transform, opacity` únicamente en elementos activos.
   - Soporte de `.eco-mode` que sustituye `backdrop-filter: blur()` costosos por superficies translúcidas pre-calculadas en GPUs integradas o móviles Android de gama de entrada.
3. **Extracción Dinámica de Color (`web/js/color-extractor.js`)**:
   - Muestreo en `OffscreenCanvas` / canvas reducido de `32x32` píxeles con caché LRU por URL/ID de pista para evitar recalcular paletas de portadas ya vistas.
4. **Backend InnerTube y Caché (`backend/`)**:
   - Consultas SQLite indexadas en modo `WAL` (`Write-Ahead Logging`) para lecturas concurrentes sin bloqueo.
   - Streaming por bloques (`chunked transfer` / `HTTP Range`) sin cargar archivos completos en memoria.

## Checklist de Auditoría
- [ ] Sin fugas de memoria en listeners de eventos ni intervalos huérfanos.
- [ ] Transición Canción <-> Video preserva el timestamp exacto sin doble descarga de flujo.
- [ ] Tiempo de arranque en frío < 500 ms.
