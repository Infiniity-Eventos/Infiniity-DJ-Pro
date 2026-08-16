# 📘 Guía del proyecto — Infiniity DJ

> Documento de traspaso para trabajar en local. Escrito en lenguaje simple.
> Última actualización: julio 2026.

---

## 1. ¿Qué es esto?

**Infiniity DJ** es un programa de escritorio para **Linux** (Mint y Fedora) que sirve
para mezclar música en eventos en vivo (bodas, quinces, fiestas). Está pensado para
que lo use el personal de Infiniity Eventos **sin experiencia en DJ**, en portátiles
de **gama baja**, sin que se trabe ni se caiga a mitad de una fiesta.

Es un tipo "mini Virtual DJ", pero simple, liviano y con la estética morada de Infiniity.

**Lo más importante del proyecto (en orden):**
1. Que nunca se trabe ni se caiga en un evento.
2. Que sea rápido y liviano.
3. Que sea muy fácil de usar.
4. Que se vea profesional (glassmorphism morado).
5. Mezcla inteligente por ritmo (BPM).
6. Que funcione la controladora DDJ-200 al conectarla.

---

## 2. Cómo lo abro en mi computador (paso a paso)

### Paso 1 — Instalar las herramientas base (una sola vez)

Necesitas **Node.js** y **Rust**.

- Node.js: https://nodejs.org (versión 18 o más nueva).
- Rust: abre una terminal y pega:
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  ```
  (dale Enter a la opción por defecto). Luego cierra y abre la terminal.

### Paso 2 — Instalar las librerías del sistema (una sola vez)

**En Linux Mint / Ubuntu:**
```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libssl-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev libasound2-dev
```

**En Fedora (40 – 44):** hay un instalador que hace todo solo (librerías, Node, Rust,
compilar y dejar la app en el menú). Ver **[INSTALAR-FEDORA.md](INSTALAR-FEDORA.md)**:
```bash
./scripts/instalar-fedora.sh
```

A mano sería así:
```bash
sudo dnf group install -y c-development development-tools
sudo dnf install -y webkit2gtk4.1-devel openssl-devel gtk3-devel librsvg2-devel \
  libappindicator-gtk3-devel alsa-lib-devel curl wget file patchelf fuse fuse-libs
```

### Paso 3 — Bajar el proyecto

```bash
git clone <la-URL-de-tu-repositorio>
cd Infiniity-DJ-Pro
git checkout claude/infiniity-dj-analysis-iuxvby
```

### Paso 4 — Instalar dependencias del proyecto (una sola vez)

```bash
npm install
```

### Paso 5 — Probar la app

```bash
npm run tauri dev
```
Se abre la app. La primera vez tarda un poco (compila el "motor"); después es rápido.

### Paso 6 — Generar el instalable (cuando esté listo para repartir)

```bash
npm run tauri build
```
Los archivos quedan en `src-tauri/target/release/bundle/`:
- `appimage/*.AppImage` → sirve en casi cualquier Linux (Mint y Fedora). Se le da permiso
  y se abre:
  ```bash
  chmod +x Infiniity*.AppImage && ./Infiniity*.AppImage
  ```
- `deb/*.deb` → para instalar en Mint/Ubuntu con doble clic.

> Para generar solo uno: `npm run tauri build -- --bundles deb` (o `appimage`).
> El AppImage baja un archivito de internet la **primera vez** que compilas (solo esa vez).

---

## 3. Cómo está organizado el proyecto (mapa simple)

El programa tiene dos "mitades":

- **La cara (frontend):** lo que ves y tocas. Está en la carpeta `src/` (hecho en React).
- **El cerebro (backend):** lo que hace el trabajo pesado (leer archivos, analizar ritmo,
  hablar con la controladora). Está en `src-tauri/src/` (hecho en Rust).

```
Infiniity-DJ-Pro/
│
├── src/                         ← LA CARA (lo visual)
│   ├── App.tsx                  Arma toda la pantalla.
│   ├── components/              Las piezas visuales:
│   │   ├── TopBar.tsx           Barra de arriba (carpeta, tema, DDJ-200, cerrar).
│   │   ├── DeckPanel.tsx        Cada bandeja (Deck A y Deck B).
│   │   ├── Mixer.tsx            El botón MEZCLAR, el crossfader y el volumen general.
│   │   ├── FolderTree.tsx       El explorador de carpetas de la izquierda.
│   │   ├── TrackList.tsx        La lista de canciones y el buscador.
│   │   ├── Vinyl.tsx            El disco giratorio.
│   │   ├── ProgressBar.tsx      La barra de progreso de cada canción.
│   │   └── Welcome.tsx          La pantalla inicial para elegir la carpeta.
│   ├── audio/
│   │   └── AudioEngine.ts       ⭐ El motor de sonido (mezcla, volúmenes, beatmatch).
│   ├── state/store.ts           La "memoria" de la app (qué está sonando, etc.).
│   ├── lib/                     Ayudas (hablar con el cerebro, formatos, etc.).
│   ├── hooks/useMidi.ts         Traduce los botones de la DDJ-200 a acciones.
│   └── styles/theme.css         ⭐ LOS COLORES MORADOS (aquí se cambian).
│
├── src-tauri/                   ← EL CEREBRO (el trabajo pesado)
│   ├── src/
│   │   ├── lib.rs               Conecta todo y expone los "comandos".
│   │   ├── library.rs           Leer/mover carpetas y canciones.
│   │   ├── bpm.rs               ⭐ Detecta el ritmo (BPM) de las canciones.
│   │   ├── cache.rs             Guarda el BPM para no repetir el análisis.
│   │   ├── midi.rs              Conexión con la controladora.
│   │   └── ddj200.rs            ⭐ EL MAPEO DE LA DDJ-200 (aquí se afina).
│   ├── icons/                   ⭐ EL LOGO/ÍCONO de la app.
│   └── tauri.conf.json          Configuración general (pantalla completa, etc.).
│
├── README.md                    Instrucciones cortas.
└── GUIA-DEL-PROYECTO.md         Este documento.
```

Los ⭐ son los archivos que probablemente vas a querer cambiar.

---

## 4. Qué está TERMINADO ✅

Todo esto ya funciona y está probado que compila:

- **Dos bandejas (Deck A y B):** cargar canción, reproducir/pausar, volumen, barra de
  progreso (se puede hacer clic para saltar), botones de adelantar/retroceder.
- **Crossfader** central para mezclar entre las dos, con volumen parejo.
- **Volumen general** (master).
- **Mezcla inteligente (botón MEZCLAR):**
  - Iguala el ritmo de la canción que entra **poco a poco** (no un salto brusco).
  - Cruza los volúmenes suave durante la transición (8 segundos, ajustable).
  - Si las dos canciones tienen ritmos muy distintos (más de ~8%), **avisa que no combinan**
    en lugar de forzar algo que suene feo.
  - Al terminar, la canción nueva vuelve poco a poco a su ritmo natural.
- **Análisis de ritmo (BPM):**
  - Lo hace el cerebro en segundo plano (no traba la pantalla).
  - Se guarda para siempre: **cada canción se analiza una sola vez**.
  - Botón "Analizar todo" y opción de corregir el BPM a mano (clic en el número del BPM).
- **Explorador de carpetas por género** en la izquierda.
  - **Arrastrar una canción a otra carpeta la mueve de verdad** en el disco.
  - Crea sola la carpeta **"Sin clasificar"**.
  - Botón para crear carpetas nuevas.
- **Buscador** de canciones por nombre y **tiempo restante** de cada tema.
- **Estética morada glassmorphism** con **modo claro y oscuro** (botón de sol/luna).
- **Disco giratorio** (provisional, hecho con código).
- **Abre en pantalla completa** con botones de minimizar / pantalla completa / salir.
- **Controladora DDJ-200** conectada por MIDI nativo, con el mapeo grabado en el código.
- **Empaquetado** configurado para AppImage y .deb (probado: el .deb se genera, 2.2 MB).

---

## 5. Qué FALTA ⏳ (en orden de prioridad)

### 🔴 1. Probar la controladora DDJ-200 (lo único que necesita hardware)
El código de la controladora está completo, pero los números exactos de cada botón/perilla
**se pusieron con la información conocida del modelo y falta confirmarlos con la unidad real.**

**Cómo se prueba (cuando tengas la DDJ-200 en la empresa):**
1. Conecta la DDJ-200 por USB.
2. Abre la app y dale al botón "DDJ-200" arriba a la derecha (debe ponerse verde).
3. Prueba play, volumen, crossfader, jog.
4. Si algún control hace algo distinto a lo esperado, se ajusta **un solo archivo**:
   `src-tauri/src/ddj200.rs` (está todo comentado y ordenado para eso).

> Nota: en Linux, a veces hay que dar permiso al usuario para usar dispositivos MIDI/USB.
> Si no la detecta, avísame y te paso el comando exacto según tu distribución.

### 🟡 2. Reemplazar los elementos visuales provisionales
Todo esto es temporal hasta que pases los definitivos:

| Qué | Dónde se cambia |
|---|---|
| **Colores morados** | `src/styles/theme.css` (las variables `--purple-...` arriba del archivo) |
| **Logo / ícono** de la app | poner un PNG grande y correr `npm run tauri icon ruta-del-logo.png` |
| **Disco giratorio** | `src/components/vinyl.css` |

### 🟢 3. Mejoras opcionales para más adelante (si las quieres)
Estas NO están hechas; las dejamos para una segunda etapa para no sobrecargar la v1:
- Cola / lista de "próximas canciones".
- Que suene sola la siguiente cuando termine una (auto-play).
- Que las descargas de YouTube entren solas a "Sin clasificar" (lo dejamos para después).
- Sincronizar la carpeta de música entre computadores (con Syncthing).
- Mini waveform (onda de la canción) — solo si no afecta el rendimiento.

---

## 6. Cómo cambiar las cosas más comunes

- **Duración de la transición al mezclar:** ya es ajustable dentro de la app (8 segundos por
  defecto). El valor por defecto y el límite de compatibilidad (~8%) están en
  `src/state/store.ts` (busca `defaultSettings`).
- **Colores:** `src/styles/theme.css`.
- **Textos de la interfaz:** están dentro de cada componente en `src/components/`.
- **Rango de ritmos que detecta (70–180 BPM):** `src-tauri/src/bpm.rs` (arriba del archivo).

---

## 7. Si algo sale mal (problemas comunes)

- **"No se encontró la DDJ-200":** revisa que esté conectada por USB antes de darle al botón.
  En Linux puede necesitar permisos; avísame.
- **La app no reproduce una canción:** confirma que sea MP3 o WAV y que esté **dentro** de la
  carpeta de música que elegiste (por diseño, solo se ve la música de esa carpeta).
- **El BPM salió mal en una canción:** dale clic al número del BPM en la bandeja y escríbelo a
  mano; queda guardado para siempre.
- **Quiero volver a analizar todo desde cero:** borra el archivo de caché en
  `~/.local/share/com.infiniityeventos.dj/bpm_cache.json`.
- **Al compilar el AppImage da un error de descarga:** necesitas internet la primera vez.
  Alternativa: genera solo el `.deb` con `npm run tauri build -- --bundles deb`.

---

## 8. Cómo seguimos trabajando juntos

- Todo el trabajo va en la rama **`claude/infiniity-dj-analysis-iuxvby`**.
- Cuando quieras que retome, cuéntame qué probaste y qué sentiste al usarlo, y/o pásame:
  1. Los **colores morados exactos** (o una imagen de referencia).
  2. El **logo** de Infiniity.
  3. El resultado de la **prueba de la DDJ-200** (qué control hizo qué).
- Con eso afino los detalles finales y dejamos la v1 lista para tus eventos.

---

Hecho con cariño para Infiniity Eventos 💜
