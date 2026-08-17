# Infiniity DJ

Mezclador de música para eventos sociales. Tauri v2 (Rust) + React + TypeScript.
Se opera en vivo, en portátiles de gama baja. **Si algo falla, falla en mitad de
un evento con gente bailando** — de ahí las reglas de abajo.

## Correr en desarrollo

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 npx tauri dev
```

Esa variable es **obligatoria** en Fedora/Wayland; sin ella la ventana se cae al
abrir.

## Publicar una versión para las demás PC

```bash
./publicar.sh 0.3.5 "Qué cambió en esta versión"
```

Compila dentro de un contenedor Ubuntu 22.04, firma y sube a GitHub Releases.
Las PC instaladas ven un aviso y se actualizan solas.

**Antes de tocar nada de esto, lee [LEEME-ACTUALIZACIONES.md](LEEME-ACTUALIZACIONES.md).**
Explica el porqué de cada pieza y los fallos que ya se pagaron caros.

## Reglas que no se negocian

Cada una salió de un fallo real en el equipo de alguien:

1. **No compilar para distribuir fuera del contenedor.** Compilando en Fedora, el
   binario exige `GLIBC_2.39` y no abre en Linux Mint 21. No subas la versión de
   Ubuntu del `Containerfile`: cuanto más vieja, en más equipos corre.

2. **No quitar `arreglar-appimage.sh` de `publicar.sh`.** Quita librerías de video
   que provocan pantalla negra e incluye los decodificadores de audio, sin los
   cuales las canciones cargan con duración `0:00` y no suenan.

3. **Nada de emojis de color elaborados en la interfaz.** Estrellan el motor de
   dibujo empaquetado y dejan la ventana en blanco (`colrv1_configure_skpaint`).
   Los símbolos simples (⬆ ✅ ⚠ ⬇ 🌙 📁) sí funcionan. Ante la duda, texto.

4. **Nunca `catch {}` vacío.** Varios fallos costaron días porque el error se
   tragaba en silencio: el descargador que no instalaba, el deck que no sonaba,
   el actualizador que no avisaba. Si algo falla, que lo diga en pantalla.

5. **La llave de firma vive en `~/.tauri/infiniity-dj.key`**, fuera del repo (que
   es público). Si se pierde, ninguna PC instalada puede volver a actualizarse.

6. **Al lanzar programas del sistema, usar `clean_command()`** (en
   `src-tauri/src/downloader.rs`). Dentro del AppImage, las variables heredadas
   rompen `curl`, `python3` y cualquier herramienta externa.

## Al mandar comandos por WhatsApp al equipo

WhatsApp **borra los asteriscos** de los comandos sin avisar. La persona ejecuta
algo distinto y nadie se entera. Escribe rutas completas, nunca comodines.

## Documentación

- [LEEME-ACTUALIZACIONES.md](LEEME-ACTUALIZACIONES.md) — distribución, actualizaciones y diagnóstico de fallos.
- [GUIA-DEL-PROYECTO.md](GUIA-DEL-PROYECTO.md) — estructura y decisiones del código.
- El historial de git explica el *porqué* de cada arreglo; los mensajes son largos a propósito.
