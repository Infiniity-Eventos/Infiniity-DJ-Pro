# 📘 Guía del proyecto — Infiniity DJ

> Documento de traspaso y contexto. Escrito en lenguaje simple.
> **Última actualización: 2026-07-20 · Versión actual: 0.1.6**
> Rama de trabajo: `claude/infiniity-dj-analysis-iuxvby`

> 🟢 **Para una IA/conversación nueva:** lee este documento completo antes de tocar nada.
> Contiene hallazgos duros (WebKitGTK, audio, rendimiento) que costó descubrir y que
> NO se deben re-investigar. Empieza por la sección 2 (hallazgos críticos).

---

## 1. ¿Qué es esto?

**Infiniity DJ** es un programa de escritorio para **Linux** (Mint y Fedora), hecho con
**Tauri (React + TypeScript por delante, Rust por detrás)**. Sirve para mezclar música en
eventos en vivo. Lo usa personal **sin experiencia de DJ**, en portátiles de **gama baja**.

**Prioridades (en orden, no negociables):**
1. **Que NUNCA se trabe ni se caiga en un evento.** (La #1 absoluta.)
2. **Que la música NUNCA se pause por nada** (ni por abrir un cuadro de diálogo).
3. Que sea rápido y liviano en equipos flojos.
4. Que sea muy fácil de usar.
5. Que se vea profesional (glassmorphism morado).
6. Mezcla inteligente por BPM. 7. Controladora DDJ-200.

---

## 2. ⚠️ HALLAZGOS CRÍTICOS (leer sí o sí)

Todo esto se descubrió a fuerza de bugs. No repetir el camino.

### 2.1 Lanzar la app en dev (Fedora + Wayland + NVIDIA)
La PC de desarrollo es Fedora 44, GNOME/Wayland, **NVIDIA RTX 5060**. Hay que lanzar SIEMPRE:
```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev
```
Sin ese flag, la ventana se cae con *"Error 71 dispatching to Wayland display"* (bug clásico
NVIDIA+Wayland+WebKitGTK). Ese flag apaga la GPU → render por software → CPU alto en dev; es
un **artefacto de la NVIDIA**, no un problema real de la app.

### 2.2 El audio NO usa `<audio>` ni el protocolo asset
En Linux/WebKitGTK el audio HTML5 es frágil:
- `createMediaElementSource` **NO funciona** → daba "operation not supported".
- El protocolo `asset://` de Tauri (`convertFileSrc`) **no lo lee** el reproductor → MediaError 4.
- Reproducir/buscar dentro de un Blob con `<audio>` **falla** (seek roto, sonaba desordenado).

**Solución actual (en `src/audio/AudioEngine.ts`):** comando Rust `read_media` devuelve los
bytes → `ctx.decodeAudioData` → se reproduce con **`AudioBufferSourceNode` + GainNodes**
(eso sí lo soporta WebKitGTK). Da reproducción sin saltos, seek preciso y beatmatch por
`playbackRate`. **Costo: ~80-170 MB RAM por canción decodificada** (máx 2 decks). No volver a
intentar `<audio>`/asset para audio.

### 2.3 NADA de diálogos nativos (pausan la música)
`window.prompt`, `window.confirm`, `window.alert` en WebKitGTK **BLOQUEAN el proceso y PAUSAN
el audio**. Prohibidos. Ya se reemplazaron por modales propios de React:
`ConfirmModal.tsx` y `PromptModal.tsx` (usar `askConfirm` / `askPrompt` del store).

### 2.4 Empaquetado: solo `.deb` (el AppImage falla)
`npm run tauri build -- --bundles deb` → genera `.deb` (~2.3 MB). El **AppImage FALLA**
("failed to run linuxdeploy", tema de FUSE en el entorno). Para eventos se usa el `.deb`.
Ojo: el `.deb` declara `depends: []`, así que en el equipo destino hay que instalar a mano
las deps de runtime (ver sección 4).

### 2.5 RENDIMIENTO — el tema abierto más importante 🔴
Medido en el portátil objetivo real (**Intel i5-6300U, 2015, 4 hilos, 7.6 GB, Mint 22.1**):
- Reposo: ~450 MB, **~3% CPU** ✅
- Pausado (canciones cargadas): ~700 MB, **~17% CPU** ✅ (la RAM es normal, sobra)
- **REPRODUCIENDO: ~147-190% CPU** 🔴 (demasiado alto)

Se intentó bajarlo quitando animaciones (disco giratorio, puntito, barra a 4fps en vez de
rAF) y **casi no bajó** (de ~190% a ~147%). **Conclusión provisional:** el costo NO son las
animaciones sino, muy probablemente, que **WebKitGTK redibuja la ventana continuamente
mientras suena audio, por software** (sin aceleración GPU, también en el Intel del portátil).

**PRUEBA PENDIENTE (define la estrategia):** reproducir una canción y **minimizar/ocultar la
ventana** ~20s; el diagnóstico ahora anota `ventana:visible|OCULTA`. Si oculta el CPU BAJA →
es repintado (hay plan: reducir repintados). Si sigue igual → es el audio (otra estrategia).

> Nota tranquilizadora: 147% en 4 hilos = ~37% del total → **le sobra CPU, NO se traba y la
> música suena fluida.** Pero se quiere exprimir más. En equipos potentes/con GPU esto no pasa.

---

## 3. Cómo correr en DESARROLLO

Requisitos ya instalados en la PC de dev (Fedora): Node 22, Rust (rustup, `~/.cargo/env`),
libs de sistema (webkit2gtk4.1-devel, gtk3, alsa), gcc/make, gstreamer con códecs MP3.

```bash
cd "Infiniity Dj Pro"
WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev
```
Dentro de la app hay un botón **🔄** (solo en dev) para recargar rápido y limpiar estado.

---

## 4. Cómo se DISTRIBUYE y ACTUALIZA (flujo real actual)

Se reparte por **Syncthing** + un script instalador. NO hay auto-updater todavía.

**Carpeta compartida por Syncthing:** `/home/zevenoficial07/Música/Infiniity Dj Pro`
(contiene el `.deb`, `instalar.sh` y `LEEME.txt`). ID del dispositivo (PC dev):
`2ZCEMB4-Z3Z2M6O-ZH6T6WJ-A7M5QXU-PAMPMTA-GQG4H7D-TRH5JZD-HAVETQV`.
Syncthing está instalado en `~/.local/bin/syncthing` (Web UI: http://127.0.0.1:8384).

**Para sacar una actualización a TODOS los equipos:**
1. **Subir el número de versión** en 3 archivos: `package.json`, `src-tauri/tauri.conf.json`,
   `src-tauri/Cargo.toml`. ⚠️ SIN subir versión, apt cree que ya la tiene y NO actualiza.
2. Compilar: `npm run tauri build -- --bundles deb`
3. Reemplazar el `.deb` viejo por el nuevo en la carpeta compartida de Syncthing.
   (Rescan por API: `curl -s -X POST -H "X-API-Key: <key>" "http://127.0.0.1:8384/rest/db/scan?folder=infiniity-musica"`; la key está en `~/.local/state/syncthing/config.xml`.)
4. En cada portátil: correr `bash instalar.sh` (agarra el `.deb` más nuevo y actualiza).

**La versión se ve DENTRO de la app** (arriba, junto al logo: "v0.1.6"). Sirve para confirmar
que actualizó.

**Deps de runtime en el portátil (una vez, las mete `instalar.sh`):**
```bash
sudo apt install -y libwebkit2gtk-4.1-0 gstreamer1.0-plugins-good \
  gstreamer1.0-plugins-bad gstreamer1.0-libav ffmpeg
```
> Posible incompatibilidad de glibc si el Mint fuera muy viejo (build en Fedora 44). El Mint
> 22.1 del portátil funcionó bien.

---

## 5. Qué está TERMINADO ✅ (incluye lo de hoy)

- **Motor de audio reescrito** con AudioBuffer (ver 2.2): reproducir/pausar, volumen, seek
  (barra y botones ⏮⏭ funcionan), beatmatch por playbackRate.
- **Auto-nivelación de volumen** (RMS): iguala la sonoridad entre canciones al cargarlas
  (para que no suene una durísima y otra bajita). En `AudioEngine.computeNormGain`.
- **Crossfader corte lineal:** en el centro AMBOS al 100%; hacia un lado apaga el opuesto.
  **Doble clic** vuelve al centro.
- **Cargar canción:** doble clic, botones A/B, o **arrastrar al deck** (con icono de nota).
  **Aviso** si vas a reemplazar una canción que está SONANDO (modal propio, no bloquea audio).
- **Editar BPM** y **crear carpeta**: con modal propio (`PromptModal`), NO pausan la música.
- **Buscador + descarga de YouTube** (dentro de la app, botón "⬇️ YouTube"):
  - Busca **sin API key** (usa yt-dlp). Resultados con miniatura.
  - Descarga en **SEGUNDO PLANO** (sigues mezclando), con indicador abajo-derecha y
    **prioridad baja (`nice`)** para no quitarle CPU a la música.
  - Al terminar: va a "Sin clasificar" y la canción nueva **titila**.
  - Si falla (429 de YouTube, etc.): queda con botón **🔄 Reintentar** (no se pierde).
  - Herramientas: **yt-dlp** (`~/.local/bin`), **deno** (`~/.deno/bin`, motor JS que YouTube
    ahora exige) y **ffmpeg**. Si faltan, la app las instala solas (botón "Instalar").
- **Modo bajo consumo ⚡** (botón arriba): quita desenfoque y detiene el disco.
  **Se auto-activa en equipos de ≤4 hilos** (como el i5 del portátil).
- **Monitor de recursos** (chip abajo-izq: RAM · CPU) + **diagnóstico** que graba a
  `~/.local/share/com.infiniityeventos.dj/diagnostico-rendimiento.csv` (clic en el chip abre
  la carpeta). Anota versión, actividad, modo ⚡ y si la ventana está visible.
- **Visual:** iconos SVG de transporte, tarjetas de vidrio, filas de canciones pulidas,
  paleta morado→azul→rosa (estilo referencia "LUMINA"). Modo claro/oscuro.
- **Versión visible** dentro de la app.
- Análisis de BPM (Rust, en segundo plano, cacheado), explorador de carpetas, arrastrar entre
  carpetas, "Sin clasificar" automática, buscador local, botón MEZCLAR (transición auto).
- Empaquetado `.deb` + distribución por Syncthing con `instalar.sh`.

---

## 6. Qué FALTA / PRÓXIMOS PASOS ⏳

### 🔴 1. RESOLVER el CPU al reproducir (lo más importante)
Ver 2.5. **Siguiente acción concreta:** leer el próximo `diagnostico-rendimiento.csv` del
portátil con la prueba de **ventana minimizada/oculta**.
- Si oculta baja el CPU → reducir repintados durante la reproducción (investigar por qué
  WebKit repinta; probar quitar más cosas de la vista mientras suena).
- Si no baja → es el audio; considerar simplificar el grafo o aceptar el costo (igual no
  se traba).

### 🔴 2. Probar la controladora DDJ-200 (necesita el hardware)
El código está en `src-tauri/src/ddj200.rs` (mapeo con datos conocidos del modelo, falta
confirmar con la unidad real). Conectar por USB → botón "DDJ-200" arriba → probar controles.

### 🟡 3. Reemplazar visuales provisionales (cuando lleguen del cliente)
| Qué | Dónde |
|---|---|
| Colores morados exactos | `src/styles/theme.css` (variables `--purple-*` y el degradado del body) |
| Logo / ícono | PNG grande + `npm run tauri icon ruta.png` |
| Disco giratorio (arte real) | `src/components/vinyl.css` |

### 🟢 4. Mejoras opcionales / ideas
- **Visor de ondas (waveform)**: se acordó hacerlo ESTÁTICO (precalculado del AudioBuffer al
  cargar, casi gratis), NO un analizador en vivo (ese sí consume). Quedó pendiente.
- Cola de "próximas canciones" + auto-play de la siguiente.
- Auto-updater de Tauri (para no depender de correr `instalar.sh` a mano). Requiere firmar
  y hostear las actualizaciones.
- **Legal:** descargar de YouTube para uso comercial es zona gris (decisión del cliente).

---

## 7. Mapa del proyecto (archivos nuevos marcados)

```
src/
├── App.tsx                      Arma la pantalla + listeners globales.
├── components/
│   ├── TopBar.tsx               Barra: carpeta, ⬇️YouTube, DDJ-200, ⚡, tema, versión, 🔄(dev).
│   ├── DeckPanel.tsx            Cada bandeja (drop de canción, editar BPM).
│   ├── Mixer.tsx                MEZCLAR, crossfader (corte lineal + doble clic), master.
│   ├── FolderTree.tsx           Carpetas (crear con PromptModal).
│   ├── TrackList.tsx            Lista + titileo de la recién descargada.
│   ├── Vinyl.tsx / vinyl.css    Disco (provisional). En ⚡ no gira.
│   ├── ProgressBar.tsx          Barra (setInterval 4fps, NO rAF — por rendimiento).
│   ├── Icons.tsx                🆕 Iconos SVG de transporte.
│   ├── ConfirmModal.tsx         🆕 Aviso propio (reemplaza window.confirm).
│   ├── PromptModal.tsx          🆕 Pedir dato propio (reemplaza window.prompt).
│   ├── StatsMonitor.tsx         🆕 Chip RAM/CPU + graba diagnóstico.
│   ├── DownloadModal.tsx        🆕 Buscador de YouTube.
│   └── DownloadIndicator.tsx    🆕 Descargas en 2do plano + reintento.
├── audio/AudioEngine.ts         ⭐ Motor con AudioBuffer (ver 2.2) + auto-nivelación.
├── lib/
│   ├── tauri.ts                 Puente con Rust (read_media, ytdl_*, system_stats, etc.).
│   ├── downloads.ts             🆕 Orquesta descargas en 2do plano + reintento.
│   └── library.ts, format.ts    Ayudas.
├── state/store.ts               Estado global (zustand) + auto-⚡ en equipos flojos.
└── styles/theme.css, global.css ⭐ Colores y estilos. Incluye modo ⚡.

src-tauri/src/
├── lib.rs                       Registra comandos.
├── library.rs                   Leer/mover carpetas y canciones.
├── bpm.rs / cache.rs            Análisis de BPM (rango 70–180) + caché.
├── midi.rs / ddj200.rs          ⭐ Controladora DDJ-200 (falta probar con hardware).
├── downloader.rs                🆕 yt-dlp: buscar, descargar (nice), instalar tools.
└── sysmon.rs                    🆕 Monitor RAM/CPU (lee /proc) + diagnóstico a CSV.
```

---

## 8. Problemas comunes / recordatorios

- **La app no reproduce:** debe ser MP3/WAV dentro de la carpeta elegida. Si da "formato no
  soportado", revisar que `read_media` + decodeAudioData estén bien (ver 2.2).
- **YouTube da 429 (Too Many Requests):** es límite temporal de YouTube por muchas peticiones
  seguidas. Esperar 1-2 min. La descarga fallida queda con botón Reintentar.
- **BPM mal en una canción:** clic en el número del BPM → escribirlo (usa PromptModal, no pausa).
- **Re-analizar BPM desde cero:** borrar `~/.local/share/com.infiniityeventos.dj/bpm_cache.json`.
- **Confirmar qué versión corre:** mirar el número junto al logo dentro de la app.
- **Herramientas de YouTube ya instaladas en la PC dev:** yt-dlp, deno, ffmpeg (no reinstalar).

---

## 9. Estado al cerrar el 2026-07-20

- App en **v0.1.6**, funcionando: audio, mezcla, crossfader, auto-nivelación, buscador+descarga
  de YouTube en 2do plano con reintento, modales sin pausar audio, monitor+diagnóstico, ⚡.
- **Pendiente inmediato:** el usuario va a hacer la **prueba de CPU con la ventana minimizada**
  (v0.1.6 ya lo anota) y enviar el CSV. Con eso se decide cómo bajar el ~147% de reproducción.
- Sin cambios subidos a git remoto ni desplegados fuera de la carpeta Syncthing.

Hecho con cariño para Infiniity Eventos 💜
