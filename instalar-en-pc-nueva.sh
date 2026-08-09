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

# ------------------------------------------------------------ 1. requisitos
# Mint 21+/Ubuntu 22.04+ ya NO traen libfuse2, y sin eso ningun AppImage abre.
if ! ldconfig -p 2>/dev/null | grep -q "libfuse.so.2"; then
  echo "→ Falta un componente del sistema (libfuse2). Te va a pedir tu contraseña."
  sudo apt-get update
  sudo apt-get install -y libfuse2 || sudo apt-get install -y libfuse2t64
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
curl -fL --progress-bar "$URL" -o "$DESTINO/Infiniity-DJ.AppImage"
chmod +x "$DESTINO/Infiniity-DJ.AppImage"

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
echo "✅ Listo. Busca 'Infiniity DJ' en el menu de aplicaciones."
echo
echo "   Cuando haya una version nueva, el programa te avisa solo al abrirlo"
echo "   y te pregunta si quieres actualizar. No hace falta volver a instalar."
