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

8. **Con una cabina Bluetooth, hacer POCO y medir lo que llega.** Dos días
   (26 y 27 de octubre de 2026, unas veinte versiones) se fueron en esto, y casi
   todo lo que se creyó por el camino resultó falso. Lo que quedó demostrado:
   - **La medida que lo partió en dos** (27-oct, 21:29, con la canción
     sonando): el motor tenía sonido dentro (−11,3 dB) y **el flujo que la app
     entregaba al sistema iba en silencio** (grabando solo ese flujo con
     `parecord --monitor-stream`, `informe::medir_flujo_propio`). Firefox, que
     entrega a 48000 Hz, sonaba por la misma salida; WebKitGTK crea el motor a
     44100 aunque el sistema vaya a 48000. Desde la 0.4.53 el motor se crea a
     48000 (`AudioEngine.ensure`). Si esto vuelve a fallar, esa es la medida a
     mirar primero: ¿sale sonido del motor y entra silencio al sistema?
     La 0.4.53 igualó la frecuencia y **no bastó**. La otra diferencia medida
     con Firefox es el margen: 75 ms (Firefox) contra 40 ms (la app). Ese
     margen lo fija el navegador interno y **no se cambia desde la app**:
     WebKitGTK ignora `latencyHint` y `PULSE_LATENCY_MSEC` no toca su salida de
     GStreamer (los dos, comprobados aquí). Lo que sí funciona es una regla de
     pipewire-pulse para un solo programa (`pulse.rules`, `pulse.min.quantum` y
     `pulse.min.req`). Es el botón «Preparar equipo» desde la 0.4.54
     (`preparacion_bt.rs`), comprobado aquí con la regla exacta.
     **Resultado:** con 75 ms la app **sonó por la cabina por primera vez**
     (27-oct, 22:10), pero entrecortado; desde la 0.4.55 son 200 ms. Si vuelve
     a cortarse, ese número es lo primero que se toca.
   - **Lo que falla de verdad** (registro de wireplumber 0.4.17 en Mint 22.1):
     al tomar la app la cabina, el sistema intenta conectar el audio y falla,
     `2 of 2 PipeWire links failed to activate`, y **no lo reintenta**:
     `tried to link on last rescan, not retrying`. El flujo de la app queda
     "enganchado" a la cabina en `pactl` y no llega nada. Firefox, que solo
     abre su conexión y la deja quieta, suena por la misma cabina en el mismo
     portátil (medido). Dos cabinas distintas fallaban igual: no era la cabina.
   - **Por eso la app hace lo mínimo** con Bluetooth (`audio_set_output_sinc`):
     salida general + mover el flujo, sin puentes ni cambios de perfil. Y si al
     medir no llega sonido, **rehace su propia conexión** (`rehacerConexion`):
     una conexión nueva el sistema sí la conecta desde cero. Máximo dos veces
     (`comprobarQueLlega` en `salidaAudio.ts`).
   - **`api.bluez5.transport = ""` NO significa "sin canal".** Sale igual con
     YouTube sonando. Se construyó encima un "reavivado" que apagaba y
     encendía cabinas sanas; quitado. Que una propiedad "suene" a algo no la
     convierte en señal: antes de usarla, comprobarla en un caso que funcione.
   - **Medir, no deducir.** Lo único fiable fue grabar la salida
     (`medir_llegada`) y medir lo que sale del motor (`medirNivelSalida`). Si no
     suena, el primer paso es **Guardar informe**, que viaja solo por Sync. Y
     pedir también un informe **de cuando sí suena** (otro programa sonando):
     sin una referencia buena se adivina.
   - **Nada de reiniciar el sonido del equipo ni el adaptador desde la app**:
     entró en bucle y trabó un portátil en pleno uso.
   - **Verificar antes de mandar, también lo "obvio".** En `bluez5.roles` de
     WirePlumber, `a2dp_source` = el portátil envía (cabinas), `a2dp_sink` =
     recibe. Una versión lo invirtió sin comprobarlo y dejó un portátil sin
     poder conectar ninguna cabina. Se comprueba en un minuto en este PC.
   - **No mandar versiones a ciegas al equipo.** Cada una le cuesta al que
     prueba. Primero el informe, luego el cambio.

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
