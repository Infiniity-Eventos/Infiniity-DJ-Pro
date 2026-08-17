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

# ---------------------------------------------------------------------------
# METER LOS DECODIFICADORES DE AUDIO
#
# WebKit decodifica el audio con GStreamer. El empaquetador de Tauri se baja su
# complemento de GStreamer pero NO lo aplica, asi que el AppImage sale con el
# nucleo de GStreamer y CERO decodificadores.
#
# Sintoma: la cancion carga, dice "listo", queda con duracion 0:00 y al darle
# play no pasa nada ni sale ningun error.
#
# Por que no basta con quitar el GStreamer empaquetado: el del sistema exige una
# GLib mas nueva que la que viaja dentro (undefined symbol
# g_once_init_leave_pointer). Hay que meter los complementos, no quitarlos.
#
# En Mint 21 esto no se notaba: su GStreamer es el mismo 1.20 de Ubuntu 22.04,
# asi que los complementos del sistema si cargaban. En Fedora, que lleva uno
# mucho mas nuevo, no encajan y el audio queda mudo.
GST_ORIGEN=/usr/lib/x86_64-linux-gnu/gstreamer-1.0
GST_DESTINO="$APPDIR/usr/lib/gstreamer-1.0"

if [[ -d "$GST_ORIGEN" ]]; then
  echo "→ Metiendo los decodificadores de audio..."
  mkdir -p "$GST_DESTINO"
  cp "$GST_ORIGEN"/libgst*.so "$GST_DESTINO"/ 2>/dev/null || true

  # El escaner que GStreamer usa para leer sus complementos.
  ESCANER=/usr/lib/x86_64-linux-gnu/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner
  if [[ -f "$ESCANER" ]]; then
    mkdir -p "$APPDIR/usr/lib/gstreamer1.0/gstreamer-1.0"
    cp "$ESCANER" "$APPDIR/usr/lib/gstreamer1.0/gstreamer-1.0/"
  fi

  # Las librerias que necesitan esos decodificadores (libmpg123, libavcodec...).
  # Se copian solo las que faltan, y NUNCA las de la lista de exclusion: son las
  # que deben venir del sistema y cuya copia rompe equipos (ver mas arriba).
  EXCLUIR='libwayland|libepoxy|libEGL|libGL|libgbm|libdrm|libX11|libxcb|^libc\.|^libm\.|^libdl\.|^libpthread\.|^librt\.|ld-linux|libstdc\+\+|libgcc_s'
  for plugin in "$GST_DESTINO"/libgst*.so; do
    [[ -f "$plugin" ]] || continue
    ldd "$plugin" 2>/dev/null | awk '/=> \// {print $3}' | while read -r dep; do
      nombre="$(basename "$dep")"
      echo "$nombre" | grep -qE "$EXCLUIR" && continue
      [[ -f "$APPDIR/usr/lib/$nombre" ]] && continue
      cp -n "$dep" "$APPDIR/usr/lib/" 2>/dev/null || true
    done
  done

  # Decirle a GStreamer donde buscarlos. El AppRun solo carga el hook de GTK,
  # asi que se anaden ahi en vez de crear un archivo nuevo que nadie leeria.
  HOOK="$APPDIR/apprun-hooks/linuxdeploy-plugin-gtk.sh"
  if [[ -f "$HOOK" ]]; then
    cat >> "$HOOK" <<'FIN'

# --- Audio (anadido por arreglar-appimage.sh) ---
export GST_PLUGIN_SYSTEM_PATH_1_0="$APPDIR/usr/lib/gstreamer-1.0"
export GST_PLUGIN_PATH_1_0="$APPDIR/usr/lib/gstreamer-1.0"
export GST_PLUGIN_SCANNER="$APPDIR/usr/lib/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner"
# Registro propio: si se comparte con el del sistema, GStreamer mezcla
# complementos de dos versiones distintas y falla.
export GST_REGISTRY_1_0="${XDG_CACHE_HOME:-$HOME/.cache}/infiniity-dj-gst-registry.bin"
FIN
  fi

  CUANTOS=$(find "$GST_DESTINO" -name "libgst*.so" | wc -l)
  echo "   decodificadores incluidos: $CUANTOS"
  if [[ "$CUANTOS" -lt 10 ]]; then
    echo "❌ Se incluyeron muy pocos decodificadores. El audio no funcionaria."
    exit 1
  fi

  # Comprobar que el decodificador de MP3 tiene todo lo que necesita.
  if [[ -f "$GST_DESTINO/libgstmpg123.so" ]]; then
    FALTAN=$(LD_LIBRARY_PATH="$APPDIR/usr/lib" ldd "$GST_DESTINO/libgstmpg123.so" 2>/dev/null | grep -c "not found" || true)
    if [[ "$FALTAN" -gt 0 ]]; then
      echo "❌ Al decodificador de MP3 le faltan $FALTAN librerias. No sonaria nada."
      LD_LIBRARY_PATH="$APPDIR/usr/lib" ldd "$GST_DESTINO/libgstmpg123.so" 2>/dev/null | grep "not found"
      exit 1
    fi
    echo "   ✅ el decodificador de MP3 tiene todas sus dependencias"
  else
    echo "❌ Falta libgstmpg123.so: no se podrian reproducir MP3."
    exit 1
  fi
else
  echo "❌ No hay complementos de GStreamer en la imagen de compilacion."
  echo "   Revisa los paquetes gstreamer1.0-* del Containerfile."
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
