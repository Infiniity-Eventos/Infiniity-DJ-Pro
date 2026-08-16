# 🎧 Instalar Infiniity DJ en Fedora (40 – 44)

> Guía en lenguaje simple. Sirve para Fedora Workstation 40, 41, 42, 43 y **44**.

---

## ⚡ La forma rápida (recomendada): un solo comando

Copia esto y pégalo **completo** en la terminal de la computadora Fedora.
Hace todo solo: instala lo que falta, compila el programa y lo deja en el menú de
aplicaciones con su ícono.

```bash
sudo dnf install -y git
git clone https://github.com/Infiniity-Eventos/Infiniity-DJ-Pro.git
cd Infiniity-DJ-Pro
git checkout claude/fedora-44-installation-qkv6pm
chmod +x scripts/instalar-fedora.sh
./scripts/instalar-fedora.sh
```

**Qué va a pasar:**

1. Te pide la clave de la computadora (para instalar las librerías del sistema). Es normal.
2. Descarga e instala lo que falte: librerías, Node.js y Rust.
3. Compila el programa. **La primera vez tarda entre 5 y 15 minutos** en un portátil de gama
   baja. Es normal que se vea mucho texto pasando; solo hay que esperar.
4. Al final dice **"LISTO. Infiniity DJ quedó instalado."**

**Para abrirlo:** busca **Infiniity DJ** en el menú de aplicaciones (la tecla de Windows y
escribir "infiniity"). Si no aparece de una, cierra sesión y vuelve a entrar.

> ℹ️ Se necesita **internet** solo mientras se instala y compila. Una vez instalado,
> el programa funciona **sin internet** (la música es toda local).

---

## 📋 Requisitos

- Fedora Workstation 40 o más nuevo (probado en 42, 43 y 44).
- Unos **3 GB libres** en disco (la mayoría son archivos temporales de compilación).
- Conexión a internet durante la instalación.
- La clave de administrador (`sudo`) de esa computadora.

---

## 🛠️ La forma manual (si prefieres ir paso a paso)

### Paso 1 — Librerías del sistema

```bash
sudo dnf group install -y c-development development-tools

sudo dnf install -y webkit2gtk4.1-devel gtk3-devel openssl-devel librsvg2-devel \
  alsa-lib-devel libappindicator-gtk3-devel curl wget file patchelf \
  desktop-file-utils fuse fuse-libs
```

Qué es cada cosa, en corto:

| Paquete | Para qué sirve |
|---|---|
| `c-development` / `development-tools` | Compilador de C (lo necesita Rust). |
| `webkit2gtk4.1-devel` | El motor con el que se dibuja la pantalla de la app. |
| `gtk3-devel` | Las ventanas del sistema. |
| `alsa-lib-devel` | **El sonido** y la controladora MIDI (DDJ-200). |
| `librsvg2-devel`, `openssl-devel` | Íconos y seguridad. |
| `fuse`, `fuse-libs` | Permite **abrir el AppImage** con doble clic en Fedora. |

### Paso 2 — Node.js y Rust

```bash
sudo dnf install -y nodejs npm
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

En Rust, dale **Enter** a la opción por defecto (la número 1). Luego cierra y abre la
terminal, o ejecuta:

```bash
. "$HOME/.cargo/env"
```

Comprueba que quedó bien:

```bash
node -v     # debe decir v18 o más alto
cargo -V    # debe decir cargo 1.77 o más alto
```

### Paso 3 — Bajar el proyecto y compilarlo

```bash
git clone https://github.com/Infiniity-Eventos/Infiniity-DJ-Pro.git
cd Infiniity-DJ-Pro
git checkout claude/fedora-44-installation-qkv6pm
npm ci
npm run tauri build
```

Los archivos quedan en `src-tauri/target/release/bundle/`:

- `appimage/Infiniity DJ_0.1.0_amd64.AppImage` → **este es el que se usa en Fedora**.
- `deb/*.deb` → ese es para Linux Mint / Ubuntu, en Fedora no sirve.

### Paso 4 — Instalarlo de verdad (que quede en el menú)

```bash
mkdir -p ~/.local/bin
cp src-tauri/target/release/bundle/appimage/*.AppImage ~/.local/bin/infiniity-dj.AppImage
chmod +x ~/.local/bin/infiniity-dj.AppImage
~/.local/bin/infiniity-dj.AppImage
```

Para que aparezca en el menú con su ícono, lo más fácil es dejar que lo haga el script:

```bash
./scripts/instalar-fedora.sh --solo-build
```

---

## 🚚 Instalar en varias computadoras SIN compilar en cada una

Esto es lo más práctico para los equipos de los eventos: **se compila una sola vez** y el
archivo resultante se copia a las demás computadoras.

**En la computadora donde compilaste:** agarra el archivo
`src-tauri/target/release/bundle/appimage/*.AppImage` y pásalo por USB o WeTransfer.

**En cada computadora nueva (Fedora), solo esto:**

```bash
sudo dnf install -y fuse fuse-libs
mkdir -p ~/.local/bin
cp ~/Descargas/Infiniity*.AppImage ~/.local/bin/infiniity-dj.AppImage
chmod +x ~/.local/bin/infiniity-dj.AppImage
~/.local/bin/infiniity-dj.AppImage
```

Ahí **no hace falta ni Rust, ni Node, ni compilar nada**. El AppImage trae todo dentro.

---

## ❗ Si algo sale mal

| Lo que dice / pasa | Qué hacer |
|---|---|
| `dlopen(): error loading libfuse.so.2` al abrir el AppImage | `sudo dnf install -y fuse fuse-libs` — o ábrelo así: `./Infiniity*.AppImage --appimage-extract-and-run` |
| `No match for argument: webkit2gtk4.1-devel` | Ejecuta `dnf search webkit2gtk` y mándame el resultado (Fedora pudo haber renombrado el paquete). |
| `cargo: command not found` | Cierra y abre la terminal, o ejecuta `. "$HOME/.cargo/env"` |
| Falla la compilación del AppImage por internet | Compila solo el ejecutable: `npm run tauri build -- --bundles deb` y luego usa el binario de `src-tauri/target/release/infiniity-dj` |
| `no space left on device` | Libera espacio: `cargo clean` dentro de `src-tauri/` borra los temporales de compilación. |
| El programa no aparece en el menú | Cierra sesión y vuelve a entrar, o ejecuta `update-desktop-database ~/.local/share/applications` |
| No se escucha nada | Revisa en Configuración → Sonido que la salida sea la correcta (parlantes / interfaz de audio). |
| No detecta la DDJ-200 | Conéctala **antes** de abrir la app y dale al botón "DDJ-200" arriba a la derecha. |

---

## 📨 Mensaje listo para reenviar

Si quien va a instalar no es técnico, mándale **este texto tal cual**:

> **Para instalar Infiniity DJ en la computadora con Fedora:**
>
> 1. Abre la terminal (tecla de Windows → escribe "terminal" → Enter).
> 2. Copia y pega este bloque completo, y dale Enter:
>
> ```
> sudo dnf install -y git && git clone https://github.com/Infiniity-Eventos/Infiniity-DJ-Pro.git && cd Infiniity-DJ-Pro && git checkout claude/fedora-44-installation-qkv6pm && chmod +x scripts/instalar-fedora.sh && ./scripts/instalar-fedora.sh
> ```
>
> 3. Te va a pedir la clave de la computadora: escríbela (no se ve mientras escribes, es
>    normal) y dale Enter.
> 4. Espera. Tarda entre 5 y 15 minutos y va a salir mucho texto: es normal.
> 5. Cuando diga **"LISTO. Infiniity DJ quedó instalado"**, busca **Infiniity DJ** en el
>    menú de aplicaciones y ábrelo.
> 6. La primera vez te pide elegir la **carpeta de la música**. Elige la carpeta donde
>    están los MP3.
>
> Si sale algún error, sácale una foto a la pantalla y mándala.

---

Hecho con cariño para Infiniity Eventos 💜
