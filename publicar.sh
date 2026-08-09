#!/usr/bin/env bash
#
# Publica una version nueva de Infiniity DJ para TODAS las PC.
#
#   ./publicar.sh 0.2.0  "Arreglado el vinilo que se trababa"
#
# Que hace, en orden:
#   1. Cambia el numero de version en los 3 archivos que lo llevan.
#   2. Compila DENTRO de un contenedor Ubuntu 22.04 (para que corra en Mint).
#   3. Firma el paquete con tu llave privada.
#   4. Sube el AppImage + latest.json a GitHub Releases.
#
# Desde ese momento, cada PC que abra el programa vera el aviso de
# "Hay una version nueva".
set -euo pipefail

VERSION="${1:-}"
NOTAS="${2:-Mejoras y correcciones.}"

REPO="Infiniity-Eventos/Infiniity-DJ-Pro"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LLAVE="$HOME/.tauri/infiniity-dj.key"
IMAGEN="infiniity-dj-builder"

# ---------------------------------------------------------------- validaciones
if [[ -z "$VERSION" ]]; then
  echo "❌ Falta el numero de version."
  echo "   Uso: ./publicar.sh 0.2.0 \"Que cambio en esta version\""
  exit 1
fi
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "❌ La version debe ser tipo 0.2.0 (tres numeros separados por punto)."
  exit 1
fi
if [[ ! -f "$LLAVE" ]]; then
  echo "❌ No encuentro la llave de firma en: $LLAVE"
  echo "   Sin ella las PC rechazan la actualizacion. Si la perdiste, mira LEEME-ACTUALIZACIONES.md"
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "❌ 'gh' no esta autenticado. Corre:  gh auth login"
  exit 1
fi
if gh release view "v$VERSION" -R "$REPO" >/dev/null 2>&1; then
  echo "❌ La version v$VERSION ya esta publicada. Usa un numero mas alto."
  exit 1
fi

echo "════════════════════════════════════════════"
echo "  Publicando Infiniity DJ v$VERSION"
echo "════════════════════════════════════════════"

# ------------------------------------------------------- 1. numero de version
echo "→ [1/4] Poniendo el numero de version..."
cd "$AQUI"
# package.json
python3 - "$VERSION" <<'PY'
import json, sys
v = sys.argv[1]
for f, key in (("package.json", "version"),):
    d = json.load(open(f))
    d[key] = v
    json.dump(d, open(f, "w"), indent=2, ensure_ascii=False)
    open(f, "a").write("\n")
PY
# tauri.conf.json
python3 - "$VERSION" <<'PY'
import json, sys
v = sys.argv[1]
f = "src-tauri/tauri.conf.json"
d = json.load(open(f))
d["version"] = v
json.dump(d, open(f, "w"), indent=2, ensure_ascii=False)
open(f, "a").write("\n")
PY
# Cargo.toml (solo la primera aparicion, la del paquete)
sed -i "0,/^version = \".*\"/s//version = \"$VERSION\"/" src-tauri/Cargo.toml

# ------------------------------------------------- 2. compilar en el contenedor
echo "→ [2/4] Preparando el entorno Ubuntu 22.04 (la 1a vez tarda varios minutos)..."
podman build -t "$IMAGEN" -f Containerfile . >/dev/null

echo "→ [2/4] Compilando para Linux Mint..."
# Volumenes con nombre para que la 2a vez compile rapido:
#   - cargo-cache: las dependencias de Rust ya bajadas
#   - target-mint: los objetos compilados (separados de los de Fedora)
#   - node-mint:   node_modules compilado dentro de Ubuntu (los binarios
#                  nativos de esbuild/rollup NO son intercambiables con los
#                  de Fedora, por eso no se reusa el node_modules del host)
podman run --rm \
  -v "$AQUI":/app:Z \
  -v infiniity-cargo-cache:/usr/local/cargo/registry \
  -v infiniity-target-mint:/app/src-tauri/target \
  -v infiniity-node-mint:/app/node_modules \
  -e TAURI_SIGNING_PRIVATE_KEY="$(cat "$LLAVE")" \
  -e TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
  -w /app \
  "$IMAGEN" \
  bash -c "npm install --no-audit --no-fund && npx tauri build --bundles appimage"

# --------------------------------------------------- 3. localizar los archivos
echo "→ [3/4] Buscando el paquete firmado..."
SALIDA="$(podman run --rm -v infiniity-target-mint:/t "$IMAGEN" \
  bash -c "ls /t/release/bundle/appimage/ 2>/dev/null" || true)"
if [[ -z "$SALIDA" ]]; then
  echo "❌ El compilado no genero ningun AppImage. Revisa los errores de arriba."
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
podman run --rm -v infiniity-target-mint:/t -v "$TMP":/out:Z "$IMAGEN" \
  bash -c "cp /t/release/bundle/appimage/*.AppImage* /out/ 2>/dev/null" || true

APPIMAGE="$(find "$TMP" -name "*.AppImage" ! -name "*.sig" | head -1)"
FIRMA="$(find "$TMP" -name "*.AppImage.sig" | head -1)"

if [[ -z "$APPIMAGE" ]]; then
  echo "❌ No se encontro el AppImage. Archivos generados:"
  echo "$SALIDA"
  exit 1
fi
if [[ -z "$FIRMA" ]]; then
  echo "❌ El AppImage NO quedo firmado. Sin firma, las PC rechazan la actualizacion."
  echo "   Revisa que 'createUpdaterArtifacts' siga en true en tauri.conf.json."
  exit 1
fi

# ------------------------------------------------------------ 4. subir a GitHub
echo "→ [4/4] Subiendo a GitHub..."
NOMBRE_APPIMAGE="$(basename "$APPIMAGE")"
URL="https://github.com/$REPO/releases/download/v$VERSION/$(printf '%s' "$NOMBRE_APPIMAGE" | sed 's/ /%20/g')"

cat > "$TMP/latest.json" <<EOF
{
  "version": "$VERSION",
  "notes": $(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$NOTAS"),
  "pub_date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "platforms": {
    "linux-x86_64": {
      "signature": "$(cat "$FIRMA")",
      "url": "$URL"
    }
  }
}
EOF

gh release create "v$VERSION" \
  -R "$REPO" \
  --title "Infiniity DJ v$VERSION" \
  --notes "$NOTAS" \
  "$APPIMAGE" \
  "$TMP/latest.json"

echo
echo "════════════════════════════════════════════"
echo "  ✅ Publicada la version $VERSION"
echo "════════════════════════════════════════════"
echo
echo "Las demas PC veran el aviso de actualizacion la proxima vez que abran"
echo "el programa. Para instalarlo por primera vez en una PC nueva, pasales:"
echo "  $URL"
