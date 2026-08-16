#!/usr/bin/env bash
# ============================================================================
#  Infiniity DJ - Instalador para Fedora (probado en Fedora 42, 43 y 44)
#
#  Que hace, en orden:
#    1. Instala las librerias del sistema que necesita Tauri (con dnf).
#    2. Instala Rust (si no esta) y Node.js (si no esta o esta viejo).
#    3. Instala las dependencias del proyecto (npm).
#    4. Compila la app y genera el AppImage.
#    5. Deja la app instalada en el menu de aplicaciones, con su icono.
#
#  Uso:
#      chmod +x scripts/instalar-fedora.sh
#      ./scripts/instalar-fedora.sh
#
#  Opciones:
#      --solo-deps     Solo instala requisitos, no compila.
#      --solo-build    Salta la instalacion de requisitos, solo compila e instala.
#      --sin-menu      Compila pero no crea el acceso directo en el menu.
#      --dev           Instala requisitos y abre la app en modo desarrollo.
# ============================================================================

set -euo pipefail

# --- Colores para que se lea facil en la terminal ---------------------------
ROJO=$'\e[1;31m'; VERDE=$'\e[1;32m'; AMAR=$'\e[1;33m'; MORA=$'\e[1;35m'; FIN=$'\e[0m'

paso()  { echo -e "\n${MORA}==> $*${FIN}"; }
ok()    { echo -e "  ${VERDE}OK${FIN}  $*"; }
aviso() { echo -e "  ${AMAR}!${FIN}   $*"; }
error() { echo -e "\n${ROJO}ERROR:${FIN} $*\n" >&2; exit 1; }

# --- Opciones ---------------------------------------------------------------
HACER_DEPS=1
HACER_BUILD=1
HACER_MENU=1
MODO_DEV=0

for arg in "$@"; do
  case "$arg" in
    --solo-deps)  HACER_BUILD=0; HACER_MENU=0 ;;
    --solo-build) HACER_DEPS=0 ;;
    --sin-menu)   HACER_MENU=0 ;;
    --dev)        MODO_DEV=1; HACER_BUILD=0; HACER_MENU=0 ;;
    -h|--help)    sed -n '2,21p' "$0"; exit 0 ;;
    *)            error "Opcion desconocida: $arg  (usa --help)" ;;
  esac
done

# --- Comprobaciones basicas -------------------------------------------------
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

[[ -f package.json && -d src-tauri ]] || \
  error "Este script debe ejecutarse dentro de la carpeta del proyecto Infiniity DJ."

if [[ "${EUID}" -eq 0 ]]; then
  error "No ejecutes este script con sudo ni como root.
       Ejecutalo como tu usuario normal: el script pedira la clave solo cuando la necesite."
fi

command -v dnf >/dev/null 2>&1 || \
  error "No se encontro 'dnf'. Este instalador es para Fedora."

if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  echo -e "${MORA}Infiniity DJ - instalador para Fedora${FIN}"
  echo "Sistema detectado: ${PRETTY_NAME:-desconocido}"
fi

# ============================================================================
# 1) LIBRERIAS DEL SISTEMA
# ============================================================================
instalar_paquetes() {
  # Instala una lista; si alguno no existe en esta version de Fedora, lo dice
  # pero no aborta (los opcionales se manejan aparte).
  sudo dnf install -y "$@"
}

instalar_opcional() {
  # Instala paquetes de uno en uno; si uno no existe, sigue de largo.
  local p
  for p in "$@"; do
    if sudo dnf install -y "$p" >/dev/null 2>&1; then
      ok "opcional instalado: $p"
    else
      aviso "opcional no disponible en esta version de Fedora: $p (se omite)"
    fi
  done
}

if [[ $HACER_DEPS -eq 1 ]]; then
  paso "1/5  Instalando librerias del sistema (te va a pedir tu clave)"

  # Herramientas de compilacion de C (dnf5 en Fedora nuevo usa 'dnf group install').
  if ! sudo dnf group install -y c-development development-tools 2>/dev/null; then
    sudo dnf groupinstall -y "C Development Tools and Libraries" "Development Tools" \
      || instalar_paquetes gcc gcc-c++ make pkgconf-pkg-config
  fi
  ok "herramientas de compilacion"

  # WebKitGTK: el motor con el que Tauri dibuja la interfaz.
  # Tauri 2 necesita la version 4.1. Si algun dia Fedora la renombra, avisamos claro.
  if ! sudo dnf install -y webkit2gtk4.1-devel 2>/dev/null; then
    aviso "no se pudo instalar 'webkit2gtk4.1-devel', buscando alternativa..."
    if ! sudo dnf install -y webkitgtk4.1-devel 2>/dev/null; then
      error "Tu Fedora no ofrece webkit2gtk4.1-devel (lo necesita Tauri 2).
       Revisa con:  dnf search webkit2gtk
       y avisale al equipo con el resultado."
    fi
  fi
  ok "webkit2gtk 4.1"

  # Resto de librerias obligatorias.
  instalar_paquetes \
    gtk3-devel \
    openssl-devel \
    librsvg2-devel \
    alsa-lib-devel \
    curl wget file
  ok "gtk3, openssl, librsvg, alsa (sonido), utilidades"

  # Opcionales: bandeja del sistema, empaquetado y soporte para abrir AppImage.
  # 'fuse' / 'fuse-libs' es lo que permite ABRIR un AppImage con doble clic en Fedora.
  instalar_opcional \
    libappindicator-gtk3-devel \
    patchelf squashfs-tools desktop-file-utils xdg-utils \
    fuse fuse-libs

  # ---------------------------------------------------------------- Node.js
  paso "2/5  Revisando Node.js"
  NODE_OK=0
  if command -v node >/dev/null 2>&1; then
    NODE_MAJOR="$(node -v | sed 's/^v\([0-9]*\).*/\1/')"
    if [[ "$NODE_MAJOR" -ge 18 ]]; then
      ok "Node.js $(node -v) ya instalado"
      NODE_OK=1
    else
      aviso "Node.js $(node -v) es muy viejo (se necesita 18 o mas nuevo)"
    fi
  fi
  if [[ $NODE_OK -eq 0 ]]; then
    instalar_paquetes nodejs npm
    ok "Node.js $(node -v) instalado"
  fi
  command -v npm >/dev/null 2>&1 || instalar_paquetes npm

  # ------------------------------------------------------------------- Rust
  paso "3/5  Revisando Rust"
  [[ -f "$HOME/.cargo/env" ]] && . "$HOME/.cargo/env"
  if command -v cargo >/dev/null 2>&1; then
    ok "Rust $(rustc --version 2>/dev/null || echo '') ya instalado"
  else
    aviso "Rust no esta instalado; se instala con rustup (no pide clave)"
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path
    . "$HOME/.cargo/env"
    # Deja rust disponible en futuras terminales.
    for perfil in "$HOME/.bashrc" "$HOME/.zshrc"; do
      [[ -f "$perfil" ]] && ! grep -q 'cargo/env' "$perfil" 2>/dev/null \
        && echo '. "$HOME/.cargo/env"' >> "$perfil"
    done
    ok "Rust $(rustc --version) instalado"
  fi
else
  paso "Saltando instalacion de requisitos (--solo-build)"
  [[ -f "$HOME/.cargo/env" ]] && . "$HOME/.cargo/env"
fi

# Asegura que cargo este en el PATH aunque el script se haya saltado el paso 3.
[[ -f "$HOME/.cargo/env" ]] && . "$HOME/.cargo/env"
command -v cargo >/dev/null 2>&1 || error "No se encontro 'cargo' (Rust). Cierra y abre la terminal, o ejecuta: . \$HOME/.cargo/env"
command -v npm   >/dev/null 2>&1 || error "No se encontro 'npm' (Node.js)."

# ============================================================================
# 2) DEPENDENCIAS DEL PROYECTO
# ============================================================================
paso "4/5  Instalando dependencias del proyecto (npm)"
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi
ok "dependencias del frontend listas"

# ============================================================================
# 3) MODO DESARROLLO (opcional)
# ============================================================================
if [[ $MODO_DEV -eq 1 ]]; then
  paso "Abriendo la app en modo desarrollo (la primera vez tarda: compila el motor)"
  exec npm run tauri dev
fi

# ============================================================================
# 4) COMPILAR
# ============================================================================
if [[ $HACER_BUILD -eq 1 ]]; then
  paso "5/5  Compilando Infiniity DJ (la primera vez puede tardar 5-15 minutos)"
  aviso "La primera compilacion del AppImage descarga un archivo pequeno de internet."

  if ! npm run tauri build; then
    aviso "Fallo la compilacion completa. Reintentando solo el paquete RPM/DEB..."
    npm run tauri build -- --bundles deb \
      || error "No se pudo compilar. Copia el error de arriba y mandalo al equipo."
  fi
  ok "compilacion terminada"

  BUNDLE="$RAIZ/src-tauri/target/release/bundle"
  APPIMAGE="$(find "$BUNDLE" -name '*.AppImage' -type f 2>/dev/null | head -n 1 || true)"
  BINARIO="$RAIZ/src-tauri/target/release/infiniity-dj"

  echo
  echo "Archivos generados en: $BUNDLE"
  find "$BUNDLE" -maxdepth 2 -type f \( -name '*.AppImage' -o -name '*.deb' -o -name '*.rpm' \) \
    -printf '  - %p\n' 2>/dev/null || true
fi

# ============================================================================
# 5) INSTALAR EN EL MENU DE APLICACIONES
# ============================================================================
if [[ $HACER_MENU -eq 1 ]]; then
  paso "Instalando Infiniity DJ en el menu de aplicaciones"

  DESTINO_BIN="$HOME/.local/bin"
  DESTINO_APP="$HOME/.local/share/applications"
  DESTINO_ICO="$HOME/.local/share/icons/hicolor/128x128/apps"
  mkdir -p "$DESTINO_BIN" "$DESTINO_APP" "$DESTINO_ICO"

  if [[ -n "${APPIMAGE:-}" && -f "${APPIMAGE:-}" ]]; then
    install -m 755 "$APPIMAGE" "$DESTINO_BIN/infiniity-dj.AppImage"
    EJECUTABLE="$DESTINO_BIN/infiniity-dj.AppImage"
    ok "AppImage instalado en $EJECUTABLE"
  elif [[ -x "${BINARIO:-}" ]]; then
    install -m 755 "$BINARIO" "$DESTINO_BIN/infiniity-dj"
    EJECUTABLE="$DESTINO_BIN/infiniity-dj"
    aviso "No se genero AppImage; se instalo el programa directo en $EJECUTABLE"
  else
    error "No se encontro ni el AppImage ni el ejecutable. Revisa los errores de la compilacion."
  fi

  cp -f "$RAIZ/src-tauri/icons/128x128.png" "$DESTINO_ICO/infiniity-dj.png" 2>/dev/null || true

  cat > "$DESTINO_APP/infiniity-dj.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Infiniity DJ
GenericName=Mezclador de musica
Comment=Mezclador de musica para eventos - Infiniity Eventos
Exec=$EJECUTABLE
Icon=infiniity-dj
Terminal=false
Categories=AudioVideo;Audio;Player;
StartupNotify=true
DESKTOP

  chmod 644 "$DESTINO_APP/infiniity-dj.desktop"
  command -v update-desktop-database >/dev/null 2>&1 && \
    update-desktop-database "$DESTINO_APP" >/dev/null 2>&1 || true
  ok "acceso directo creado (busca 'Infiniity DJ' en el menu)"

  # Aviso util: en Fedora el AppImage necesita fuse2 para abrirse con doble clic.
  if [[ "$EJECUTABLE" == *.AppImage ]] && ! ldconfig -p 2>/dev/null | grep -q 'libfuse\.so\.2'; then
    aviso "Si al abrir dice algo de 'fuse', ejecuta:  sudo dnf install -y fuse fuse-libs"
    aviso "O abrelo asi:  $EJECUTABLE --appimage-extract-and-run"
  fi
fi

# ============================================================================
echo
echo -e "${VERDE}==============================================${FIN}"
echo -e "${VERDE} LISTO. Infiniity DJ quedo instalado.${FIN}"
echo -e "${VERDE}==============================================${FIN}"
echo
echo "Para abrirlo:"
echo "  - Busca 'Infiniity DJ' en el menu de aplicaciones, o"
echo "  - Escribe en la terminal:  ${EJECUTABLE:-$HOME/.local/bin/infiniity-dj.AppImage}"
echo
echo "Si el menu no lo muestra todavia, cierra sesion y vuelve a entrar."
echo
