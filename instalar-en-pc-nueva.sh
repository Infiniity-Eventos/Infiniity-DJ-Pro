#!/usr/bin/env bash
#
# INSTALADOR PARA LAS PC DE LOS DEMAS (Linux Mint / Ubuntu).
#
# Se pasa este archivo a la persona y lo corre con doble clic (o en terminal):
#   bash instalar-en-pc-nueva.sh
#
# Baja la ultima version publicada, la deja instalada con su icono en el menu,
# y desde ahi el programa se actualiza solo avisando cuando haya version nueva.
set -euo pipefail

REPO="Infiniity-Eventos/Infiniity-DJ-Pro"
DESTINO="$HOME/Applications"
ESCRITORIO="$HOME/.local/share/applications/infiniity-dj.desktop"
ICONO="$HOME/.local/share/icons/hicolor/128x128/apps/infiniity-dj.png"

echo "════════════════════════════════════════════"
echo "  Instalando Infiniity DJ"
echo "════════════════════════════════════════════"

# -------------------------------------------- 0. quitar la version vieja (.deb)
# Las primeras pruebas se instalaron como paquete .deb. Tauri NO sabe
# auto-actualizar un .deb (solo AppImage), asi que si se queda instalado
# aparecen DOS "Infiniity DJ" en el menu y el viejo nunca se actualiza:
# la persona abre el equivocado y cree que las actualizaciones no sirven.
# Los datos (biblioteca, BPM analizados) NO se tocan: viven en la carpeta
# del usuario y los dos usan el mismo identificador.
if command -v dpkg >/dev/null 2>&1 && dpkg -l infiniity-dj 2>/dev/null | grep -q "^ii"; then
  VIEJA="$(dpkg-query -W -f='${Version}' infiniity-dj 2>/dev/null || echo "?")"
  echo "→ Encontre una version vieja instalada (la $VIEJA), de las pruebas."
  echo "  Esa no se puede actualizar sola, asi que la quito para que no quede"
  echo "  duplicada en el menu. Tu musica y tus ajustes NO se pierden."
  echo "  Te va a pedir tu contraseña."
  sudo apt-get remove -y infiniity-dj
fi

# ------------------------------------------------------------ 1. requisitos
# Mint 21+/Ubuntu 22.04+ ya NO traen libfuse2, y Fedora tampoco lo instala de
# fabrica. Sin esa libreria NINGUN AppImage abre.
# El paquete se llama distinto en cada sistema, de ahi la deteccion.
if ! ldconfig -p 2>/dev/null | grep -q "libfuse.so.2"; then
  echo "→ Falta un componente del sistema (libfuse2). Te va a pedir tu contraseña."
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y libfuse2 || sudo apt-get install -y libfuse2t64
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y fuse-libs
  elif command -v pacman >/dev/null 2>&1; then
    sudo pacman -S --noconfirm fuse2
  else
    echo "⚠️  No reconozco el gestor de paquetes de este sistema."
    echo "    Instala 'libfuse2' (o 'fuse-libs' en Fedora) a mano y vuelve a correr esto."
    exit 1
  fi

  # Comprobar que de verdad quedo: sin esto el programa no abriria y el
  # instalador estaria diciendo "listo" en falso.
  if ! ldconfig -p 2>/dev/null | grep -q "libfuse.so.2"; then
    echo "❌ No se pudo instalar libfuse2. El programa no podria abrir."
    exit 1
  fi
fi

# ------------------------------------------------------- 2. bajar el programa
echo "→ Buscando la ultima version..."
URL="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | grep -o '"browser_download_url": *"[^"]*\.AppImage"' \
  | head -1 | cut -d'"' -f4)"

if [[ -z "$URL" ]]; then
  echo "❌ No se pudo encontrar la ultima version."
  echo "   Revisa tu internet, o avisale a Stiven que no hay ninguna version publicada."
  exit 1
fi

VERSION="$(basename "$URL" | grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+' | head -1)"
echo "→ Bajando Infiniity DJ ${VERSION:-(ultima)}..."
mkdir -p "$DESTINO"

# Se baja a un archivo aparte y luego se reemplaza de un solo movimiento.
# POR QUE: si el programa esta ABIERTO, Linux no deja escribir encima de su
# archivo y curl falla con "El fichero de texto esta ocupado" (error 23).
# Reemplazar con 'mv' si funciona aunque este abierto: la copia vieja sigue
# viva hasta que la persona cierre el programa.
# Ademas, si la descarga se corta a medias, no deja el programa destrozado.
NUEVO="$DESTINO/.Infiniity-DJ.AppImage.descargando"
trap 'rm -f "$NUEVO"' EXIT
curl -fL --progress-bar "$URL" -o "$NUEVO"
chmod +x "$NUEVO"

# Avisar si estaba abierto: el cambio no se ve hasta cerrarlo y volver a abrir.
ESTABA_ABIERTO=no
if pgrep -f "Infiniity-DJ.AppImage" >/dev/null 2>&1; then
  ESTABA_ABIERTO=si
fi

mv -f "$NUEVO" "$DESTINO/Infiniity-DJ.AppImage"

# --------------------------------------------------- 3. icono y menu de inicio
echo "→ Agregandolo al menu..."
mkdir -p "$(dirname "$ESCRITORIO")" "$(dirname "$ICONO")"

# El icono viene dentro del propio AppImage.
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
( cd "$TMP" && "$DESTINO/Infiniity-DJ.AppImage" --appimage-extract >/dev/null 2>&1 || true )
ENCONTRADO="$(find "$TMP" -name "*.png" -path "*128*" 2>/dev/null | head -1)"
[[ -n "$ENCONTRADO" ]] && cp "$ENCONTRADO" "$ICONO"

cat > "$ESCRITORIO" <<EOF
[Desktop Entry]
Type=Application
Name=Infiniity DJ
Comment=Mezclador de musica para eventos
Exec=env WEBKIT_DISABLE_DMABUF_RENDERER=1 "$DESTINO/Infiniity-DJ.AppImage"
Icon=${ENCONTRADO:+infiniity-dj}
Terminal=false
Categories=Audio;Music;AudioVideo;
StartupWMClass=Infiniity DJ
EOF
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true

echo
echo "✅ Listo. Quedo instalada la version ${VERSION:-mas reciente}."
if [[ "$ESTABA_ABIERTO" == "si" ]]; then
  echo
  echo "⚠️  IMPORTANTE: el programa estaba ABIERTO mientras se instalaba."
  echo "    La ventana que tienes abierta sigue siendo la version vieja."
  echo "    CIERRALA y vuelve a abrir 'Infiniity DJ' desde el menu."
else
  echo "   Busca 'Infiniity DJ' en el menu de aplicaciones."
fi
echo
echo "   Cuando haya una version nueva, el programa te avisa solo al abrirlo"
echo "   y te pregunta si quieres actualizar. No hace falta volver a instalar."
