# 🎧 Infiniity DJ

Mezclador de música liviano y estable para eventos en vivo, de **Infiniity Eventos**.
Pensado para que lo use el personal (sin experiencia en DJ) en portátiles de gama baja.

App de escritorio nativa para **Linux** (Mint y Fedora), hecha con **Tauri + React**.
No necesita internet: toda la música es local.

---

## ✨ Qué incluye esta versión

- **Dos decks (A y B)** con reproducir/pausar, volumen, barra de progreso y adelantar/retroceder.
- **Crossfader** central con curva de igual potencia (mezcla pareja, sin bajones de volumen).
- **Mezcla inteligente** (botón "MEZCLAR"): iguala el ritmo de la canción que entra de forma
  gradual y cruza los volúmenes en una transición suave (8 s por defecto, ajustable).
  Si dos canciones tienen ritmos muy distintos (más de ~8%), avisa que no combinan en vez de forzar.
- **Análisis de BPM** hecho en el "cerebro" en Rust, en segundo plano (no traba la interfaz),
  y **guardado para siempre** en un caché local: cada canción se analiza una sola vez.
- **Explorador de carpetas** por género. Se pueden **arrastrar canciones entre carpetas**
  (mueve el archivo real en el disco). Crea sola la carpeta **"Sin clasificar"**.
- **Buscador** de canciones por nombre y **tiempo restante** de cada tema.
- **Estética glassmorphism morada** con **modo claro y oscuro**. Disco giratorio (provisional).
- **Controladora Pioneer DDJ-200** por MIDI nativo (mapeo fijo en el código, plug-and-play).
  ⚠️ *Pendiente de probar contra la unidad física para afinar el mapeo.*
- Abre en **pantalla completa**.

---

## 🎨 Cosas provisionales por reemplazar (assets)

Estos elementos son marcadores de posición hasta que Stiven envíe los definitivos:

1. **Colores morados** → en `src/styles/theme.css` (variables `--purple-*`). Cambiar por los oficiales.
2. **Logo / ícono de la app** → carpeta `src-tauri/icons/`. Reemplazar con el logo real
   (basta un PNG grande y correr `npm run tauri icon ruta-del-logo.png`).
3. **Disco giratorio** → `src/components/vinyl.css` (hecho con CSS). Se puede cambiar por arte real.

---

## 🛠️ Requisitos para compilar

Necesitas **Node.js 18+** y **Rust** (https://rustup.rs).

### Dependencias del sistema

**Linux Mint / Ubuntu:**
```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libssl-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev libasound2-dev
```

**Fedora (40 – 44):** usa el instalador automático, que hace todo (librerías, Node, Rust,
compilar e instalar en el menú):
```bash
chmod +x scripts/instalar-fedora.sh
./scripts/instalar-fedora.sh
```
- Paso a paso y solución de problemas: **[INSTALAR-FEDORA.md](INSTALAR-FEDORA.md)**.
- Guía para alguien que **no sabe nada de Linux**: **[GUIA-FACIL.md](GUIA-FACIL.md)**.

Si prefieres hacerlo a mano:
```bash
sudo dnf group install -y c-development development-tools
sudo dnf install -y webkit2gtk4.1-devel openssl-devel gtk3-devel librsvg2-devel \
  libappindicator-gtk3-devel alsa-lib-devel curl wget file patchelf fuse fuse-libs
```

---

## ▶️ Cómo usarlo

Instalar dependencias del frontend (una sola vez):
```bash
npm install
```

**Probar en modo desarrollo** (se abre la app):
```bash
npm run tauri dev
```

**Generar el instalable** (AppImage universal + paquete .deb):
```bash
npm run tauri build
```
Los archivos quedan en `src-tauri/target/release/bundle/`:
- `appimage/*.AppImage` → funciona en casi cualquier Linux (Mint y Fedora). Dar permiso de
  ejecución y abrir: `chmod +x Infiniity*.AppImage && ./Infiniity*.AppImage`.
- `deb/*.deb` → para instalar en Mint/Ubuntu.

> En Fedora, el objetivo recomendado es el **AppImage** (portátil, sin instalación compleja).
>
> ℹ️ La **primera vez** que generas el AppImage, Tauri descarga un archivo de ayuda pequeño
> desde internet (solo durante la compilación, no al usar la app). Necesitas conexión ese
> momento. El paquete `.deb` no requiere ninguna descarga.
>
> Para generar solo uno de los dos: `npm run tauri build -- --bundles deb`
> (o `--bundles appimage`).

---

## 📂 Dónde se guardan los datos

- **Música:** la carpeta que elijas al abrir la app (se puede cambiar con el botón "📁 Carpeta").
- **Caché de BPM:** en la carpeta de datos de la app del usuario
  (`~/.local/share/com.infiniityeventos.dj/bpm_cache.json`).
  Se puede borrar sin problema; solo hará que se vuelvan a analizar las canciones.

---

## 🧠 Notas técnicas (para el desarrollo futuro)

- El cambio de tempo usa `playbackRate` con `preservesPitch = false` (como el pitch de un
  tornamesa): es muy liviano en CPU. Por eso el límite de ~8% en la mezcla inteligente.
- El análisis de BPM está en `src-tauri/src/bpm.rs` (auto-correlación + filtro peine).
  Si en pruebas reales algún género necesita más precisión, ese archivo es el lugar a ajustar.
- El mapeo de la DDJ-200 está centralizado en `src-tauri/src/ddj200.rs` para afinarlo en un
  solo lugar cuando se pruebe con la controladora.

---

Hecho con cariño para Infiniity Eventos 💜
