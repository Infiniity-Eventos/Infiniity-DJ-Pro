# Infiniity DJ

Mezclador de música para eventos sociales. Tauri v2 (Rust) + React + TypeScript.
Se opera en vivo, en portátiles de gama baja. **Si algo falla, falla en mitad de
un evento con gente bailando** — de ahí las reglas de abajo.

## Correr en desarrollo

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 npx tauri dev
```

Esa variable es **obligatoria** en Fedora/Wayland; sin ella la ventana se cae al
abrir. Desde la 0.3.6 el programa la pone solo cuando detecta NVIDIA
(`src-tauri/src/arranque.rs`), así que en desarrollo sobra, pero no estorba.

**No la pongas en los accesos directos de las demás PC**: en los portátiles
Intel prohíbe la tarjeta gráfica y la CPU se va al 186 % reproduciendo. El
programa decide GPU/software por sí mismo y, si la GPU falla al abrir, se
reinicia por software y lo recuerda (`~/.cache/infiniity-dj/gpu-prohibida`).

## Publicar una versión para las demás PC

```bash
./publicar.sh 0.3.5 "Qué cambió en esta versión"
```

Compila dentro de un contenedor Ubuntu 22.04, firma, sube a GitHub Releases y
**sube el código con `git push`**. Las PC instaladas ven un aviso y se
actualizan solas.

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

7. **Nada que afecte al sonido se anima con `requestAnimationFrame`.** El motor
   web congela rAF con la ventana oculta o minimizada, y una transición del
   automix quedó a medias con los dos decks a todo volumen. Crossfader y
   velocidad van como curvas en los `AudioParam` (`AudioEngine.ts`), que corren
   en el hilo de audio pase lo que pase con la pantalla.

8. **Con una cabina Bluetooth, "conectada" no significa "con sonido".** Un día
   entero (2026-10-26, trece versiones) se fue en esto. El servidor de sonido
   puede crear la salida de la cabina **sin canal hacia el aparato**: existe,
   está en RUNNING, acepta el flujo de la app (y el de cualquier otro programa),
   y por ella no sale nada. Se reconoce en `pactl list sinks` por
   `api.bluez5.transport = ""` y `api.bluez5.connection = "disconnected"`
   (`es_fantasma` en `salida_audio.rs`); el informe lo marca como `FANTASMA`.
   El registro de wireplumber dice por qué: el canal se crea y la cabina lo
   suelta nada más abrirse. Pasa tras una desconexión espontánea seguida de
   reconexión. Lecciones pagadas:
   - **Medir, no deducir.** `pactl` decía que todo estaba bien. Lo que destapó
     el fallo fue grabar la salida (`medir_llegada`) y medir lo que sale del
     motor (`medirNivelSalida`): sonido dentro, silencio fuera. Si no suena, el
     primer paso es el botón **Guardar informe**, que viaja solo por Sync.
   - **Nada de reiniciar el sonido del equipo ni el adaptador desde la app.**
     No reabre el canal (es la cabina la que lo suelta) y en un evento dejó el
     portátil trabado tras cinco reinicios en bucle. Peor que una cabina muda.
   - **No mandar versiones a ciegas al equipo.** Sin poder reproducir aquí, cada
     versión le cuesta al que prueba. Primero el informe, luego el cambio.
   - **Verificar antes de mandar, también lo "obvio".** En `bluez5.roles` de
     WirePlumber los roles se nombran desde el PORTÁTIL: `a2dp_source` = envía
     audio (cabinas), `a2dp_sink` = recibe (de un celular). Una versión puso
     `a2dp_sink` sin comprobarlo y dejó un portátil sin poder conectar ninguna
     cabina (`br-connection-profile-unavailable`). Se comprobó después en un
     minuto, en este PC, mirando qué puntos registra bluetoothd. Ese minuto
     va ANTES de publicar, no después. (`preparacion_bt.rs`)
   - Sigue siendo cierto que la salida no se cambia arrastrando el flujo
     (`AudioEngine.rehacerConexion()` la rehace y reanuda donde iba) y que hay
     que comprobar que suena de verdad (`audio_output_status`), pero eso NO
     era la causa del fallo de la cabina.

9. **Nada que tarde corre en el hilo de la ventana, y lo que tarda se ve.** Los
   comandos de Tauri declarados `fn` se ejecutan en el hilo de la ventana: si
   tardan, la pantalla deja de repintarse y el sistema saca «la aplicación no
   responde». Pasó con la búsqueda de cabinas Bluetooth (doce segundos). Todo
   lo que hable con programas del sistema (`bluetoothctl`, `pactl`) va con
   `en_otro_hilo()` (en `lib.rs`). Y en pantalla tiene que verse algo moviéndose
   —cuenta atrás, ruedita— porque una espera sin señales no se distingue de un
   cuelgue. Ampliando la regla 4: no basta con avisar de los fallos; también hay
   que decir «estoy trabajando» y «busqué y no encontré nada».

10. **No quitar el `git push` del final de `publicar.sh`.** Durante dos meses el
   guion publicaba el programa pero no subía el código, y nadie lo notó porque
   publicar "funcionaba". GitHub se quedó en la 0.3.4 de agosto mientras salían
   versiones nuevas: alguien trabajó desde otro PC sobre código de dos meses
   atrás y hubo que reaplicarle el arreglo a mano, y el instalador de PC nuevas
   —que se sirve desde esta rama— también estaba viejo. Si el push falla, el
   guion lo dice y termina con error: el programa ya salió, pero el código no.

## Probar el automix sin la ventana nativa

```bash
DJ_BIBLIOTECA_JSON=/ruta/biblioteca.json npx vite
```

Con esa variable, Vite sirve la biblioteca (un JSON con la forma de
`read_library`) y el audio por HTTP, y la app abre en un navegador normal
(poner `musicRoot` en `localStorage` → `infiniity-dj-prefs`). Solo desarrollo;
en el AppImage no existe. Hay `window.__dj` con el store, el motor y el automix.

## Al mandar comandos por WhatsApp al equipo

WhatsApp **borra los asteriscos** de los comandos sin avisar. La persona ejecuta
algo distinto y nadie se entera. Escribe rutas completas, nunca comodines.

## Documentación

- [LEEME-ACTUALIZACIONES.md](LEEME-ACTUALIZACIONES.md) — distribución, actualizaciones y diagnóstico de fallos.
- [GUIA-DEL-PROYECTO.md](GUIA-DEL-PROYECTO.md) — estructura y decisiones del código.
- El historial de git explica el *porqué* de cada arreglo; los mensajes son largos a propósito.
