#!/usr/bin/env bash
#
# Corre DENTRO del contenedor, justo despues de 'tauri build'.
#
# QUE ARREGLA
# El empaquetador mete dentro del AppImage cinco librerias graficas de Ubuntu
# 22.04. En equipos con otra tarjeta de video (confirmado en una AMD Lucienne
# con Fedora 44 + Wayland) esas librerias chocan con el driver del sistema y el
# programa muere al abrir con:
#     Could not create default EGL display: EGL_BAD_PARAMETER. Aborting...
# dejando la pantalla en negro. En otros equipos no molesta, asi que el fallo
# parece aleatorio segun la maquina.
#
# La solucion es quitarlas para que use las del sistema anfitrion. Son
# librerias que TODO escritorio Linux ya trae, y su interfaz es estable, por
# eso la lista oficial de AppImage recomienda no empaquetarlas nunca.
#
# OJO CON EL ORDEN: hay que volver a firmar DESPUES de reempaquetar. La firma
# se calcula sobre el archivo final; si se firma antes, las PC rechazan la
# actualizacion por firma invalida.
set -euo pipefail

DIR=/app/src-tauri/target/release/bundle/appimage

# Librerias que NO deben viajar dentro del paquete.
QUITAR=(
  libwayland-client.so.0
  libwayland-cursor.so.0
  libwayland-egl.so.1
  libwayland-server.so.0
  libepoxy.so.0
)

APPDIR="$(find "$DIR" -maxdepth 1 -name "*.AppDir" | head -1)"
APPIMAGE="$(find "$DIR" -maxdepth 1 -name "*.AppImage" ! -name "*.sig" | head -1)"

if [[ -z "$APPDIR" || -z "$APPIMAGE" ]]; then
  echo "❌ No encuentro el AppDir o el AppImage en $DIR"
  ls -la "$DIR" || true
  exit 1
fi

echo "→ Quitando las librerias graficas que chocan con el sistema..."
for L in "${QUITAR[@]}"; do
  if [[ -e "$APPDIR/usr/lib/$L" ]]; then
    rm -f "$APPDIR/usr/lib/$L"
    echo "   quitada: $L"
  fi
done

# Comprobar que de verdad no quedo ninguna: si el empaquetador cambia y las
# pone en otra ruta, esto avisa en vez de publicar un paquete roto.
QUEDAN="$(find "$APPDIR" -name "libwayland-*" -o -name "libepoxy.so.*" 2>/dev/null || true)"
if [[ -n "$QUEDAN" ]]; then
  echo "❌ Todavia quedan librerias graficas dentro del paquete:"
  echo "$QUEDAN"
  echo "   Revisa las rutas en arreglar-appimage.sh antes de publicar."
  exit 1
fi

echo "→ Volviendo a empaquetar..."
rm -f "$APPIMAGE" "$APPIMAGE.sig"
ARCH=x86_64 APPIMAGE_EXTRACT_AND_RUN=1 appimagetool "$APPDIR" "$APPIMAGE" >/dev/null

if [[ ! -f "$APPIMAGE" ]]; then
  echo "❌ El reempaquetado no genero el AppImage."
  exit 1
fi

echo "→ Firmando el paquete final..."
npx tauri signer sign "$APPIMAGE" >/dev/null

if [[ ! -f "$APPIMAGE.sig" ]]; then
  echo "❌ El paquete quedo SIN firma. Las PC rechazarian la actualizacion."
  exit 1
fi

echo "✅ Paquete arreglado y firmado: $(basename "$APPIMAGE")"
