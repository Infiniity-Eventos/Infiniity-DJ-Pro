# Guía para Automix

> Documento vivo. Aquí queda **todo lo decidido**, para no depender de la memoria del chat.
> Si se cierra la sesión, se retoma leyendo este archivo.

- **Tarea:** dos formas de mezclar sola la música: (1) una **cola Automix** manual en una barra lateral donde se arrastran canciones y el programa las encadena sin silencios y con transiciones suaves; (2) un botón **"Poner automix"** junto a "Actualizar lista" que toma la carpeta (género o artista) que se está viendo y la mezcla sola buscando la mejor ruta para que no haya golpes de ritmo.
- **Inicio:** 2026-10-18
- **Estado:** ✅ Terminada (0.4.18; ajuste 0.4.20 tras el primer evento real, 2026-10-18)
- **Proyecto:** `~/Apps Zeven/Infiniity Eventos/Infiniity Dj Pro` (Tauri + React) · versión actual 0.4.17

---

## 1. Objetivo

Que en un evento la música siga sola, sin silencios y sin cambios bruscos que los invitados noten,
ya sea porque el gestor fue armando una cola a mano o porque puso una carpeta entera en automix.
Dudas del usuario que la guía tiene que resolver: cómo se combina con la canción que ya está
sonando (sin cortes) y cómo funciona con los decks A/B.

---

## 2. Decisiones CERRADAS

No se vuelven a preguntar. Cada una con su **porqué**.

### Del contexto (antes del cuestionario)

| # | Decisión | Por qué |
|---|----------|---------|
| D1 | Las dos cosas existen: cola manual en barra lateral **y** botón "Poner automix" por carpeta/artista. | Pedido explícito. |
| D2 | El botón "Poner automix" va **junto a "Actualizar lista"** (barra del buscador de la lista) y actúa sobre lo que se está viendo (género o artista). | Pedido explícito. |

### De la ronda 2 (2026-10-18)

| # | Decisión | Por qué |
|---|----------|---------|
| D10 | La barra Automix es una **tercera columna a la derecha de la lista** (Carpetas · Lista · Automix), plegable con un botón. | Se ve la cola mientras se arrastra de la lista. |
| D11 | **La cola da vueltas en el mismo orden** cuando se acaba (venga de una carpeta o armada a mano). Regla: la siguiente es **la primera canción que todavía no ha sonado**; si ya sonaron todas, la que sigue en el orden circular. Así, si en la segunda vuelta el DJ agrega una canción al final, **suena de inmediato** después de la actual, y luego se continúa **por donde iba la vuelta**, no desde la primera. | Observación del usuario: no tener que esperar toda la vuelta, y no volver a la primera. Y nunca se queda en silencio mientras haya canciones. |
| D12 | **Sin tonalidad.** Ruta por ritmo + golpes alineados + energía. | Criterio del agente aceptado: en música latina ayuda poco y falla 3 de 10. |
| D13 | **Evitar el mismo artista dos veces seguidas** en la ruta cuando hay con qué. | |
| D14 | Con el automix encendido, **los botones A/B y el doble clic quedan bloqueados con aviso**; a la cola **solo arrastrando**. | Elegido sobre convertirlos en "+ Cola". |
| D15 | Botón **"Saltar"** en la barra: pasa ya a la siguiente con la misma transición suave. | |
| D16 | Cuándo entra la siguiente: **"decide tú"** → se aplica la recomendación: **según el género**. Carpetas bailables: entra cuando la energía cae al final (se come hasta 30 s de cola floja), transición de 8 s. Viejoteca, Carranga y Boleros: casi entera, transición de 6 s sobre el final. | Criterio de DJ: no enfriar el baile; no cortar lo que la gente canta. |
| D17 | Dónde guardar el análisis de golpes: el usuario eligió "las dos" (skill en las nuevas + app en caché compartida). **Ver bitácora 2026-10-18 (decisión sobre la marcha):** al diseñarlo resultó innecesario, porque el análisis se hace en milisegundos al cargar la canción. | |

### De la ronda 1 (2026-10-18)

| # | Decisión | Por qué |
|---|----------|---------|
| D3 | **Una sola cola Automix.** La barra lateral ES la cola; "Poner automix" en un género/artista la llena con esa carpeta ya ordenada. Si la cola **ya tiene canciones**, pregunta (modal propio, sin pausar el audio): **"¿Limpiar la cola o añadir al final?"** | Pedido explícito en la observación. |
| D4 | Al encender el automix, **respeta la canción que suena**: sigue hasta cerca de su final y ahí entra la primera de la cola. | Nadie nota que se activó. |
| D5 | **Alterna los decks A y B**: la siguiente se precarga en el deck libre; el crossfader se mueve solo. Los decks siguen siendo los de siempre. | Límite de RAM (L3) y se ve qué suena. |
| D6 | Con el automix **encendido, los controles de los decks y el crossfader quedan bloqueados**. Si alguien los toca, sale el aviso: **"Para mezclar tú mismo, apaga el automix"**. La barra lleva un **botón de encendido/apagado** y un **botón de limpiar**, "bien bonitos". | Pedido explícito. Quien manda es el automix hasta que lo apagan. |
| D7 | **Alinear los golpes** (no solo igualar velocidad). El análisis del primer golpe **la primera vez debe cubrir TODAS las carpetas**, no solo "Sin clasificar". | Pedido explícito: las carpetas ya organizadas no lo tienen. Dónde se guarda: ronda 2 (S4). |
| D8 | **Recortar silencios** al inicio y al final, **siempre** (también al cargar a mano en un deck). | Gratis y evita huecos. |
| D9 | **Sin panel de ajustes.** Las transiciones son **automáticas según la canción** (duración, momento de entrada) con valores que elige el agente. | "Esos pelados no saben configurar velocidades". |

---

## 3. Límites encontrados en el código (lo que hay y lo que no)

Esto no se pregunta: se leyó del proyecto. El usuario lo puede desmentir.

- **L1 — Datos por canción (etiquetas ID3 que escribe /Organizar_Canciones):** título, artista(s), género, **BPM entero** (de Deezer; si no, análisis propio en Rust con 1 decimal), duración, año, ISRC, ReplayGain. **NO hay tonalidad** (decisión D20 de la guía de Organizar: "sin tonalidad por ahora"). → La ruta se puede calcular por BPM (y género/artista); por tonalidad **no**, salvo que se añada un análisis.
- **L2 — No hay "rejilla de pulsos"** (dónde cae el primer golpe de cada canción). El MEZCLAR de hoy **iguala la velocidad** (`playbackRate`, hasta ±8 %) pero **no alinea los golpes**: dos canciones al mismo tempo pueden sonar "a galope" durante la transición. Alinearlos exige detectar el primer beat (análisis en Rust, cacheable; la skill podría escribirlo como etiqueta).
- **L3 — Dos decks, dos canciones decodificadas como máximo.** Cada canción cargada ocupa ~80-170 MB de RAM (se decodifica entera a PCM porque WebKitGTK no soporta `<audio>`; ver GUIA-DEL-PROYECTO 2.2). Así que **solo puede haber UNA canción "lista" por adelantado** (en el deck libre), no una cola entera precargada.
- **L4 — La transición actual** (`AudioEngine.autoMix`): arranca el deck destino desde el segundo 0, iguala tempo en los primeros ~2,5 s, mueve el crossfader en 8 s, pausa el deck origen y devuelve el tempo natural en 4 s. Los valores (8 s, 8 %) **no se pueden cambiar desde la pantalla** (existen en `settings` pero no hay panel).
- **L5 — Fin de canción:** el motor solo se entera cuando la canción **ya terminó** (`onended`). Para mezclar "antes del final" hay que vigilar la posición (ya se lee 4 veces por segundo para la barra de progreso: no cuesta más).
- **L6 — Silencios:** el AudioBuffer da el audio crudo, así que detectar silencio al inicio/final es **gratis** (igual que la auto-nivelación RMS que ya existe).
- **L7 — Pantalla:** portátiles de 1366×768. Hoy la pantalla es decks A | mezclador | deck B arriba, y carpetas (260 px) | lista abajo. Una barra lateral nueva tiene que caber ahí.
- **L8 — DDJ-200:** los botones LOAD y SYNC de la controladora **llegan** al programa (`ddj200.rs`) pero **no hacen nada** (`useMidi.ts` los ignora).
- **L9 — Rendimiento:** decodificar una canción cuesta 1-3 s de CPU en el portátil objetivo (i5-6300U). Se puede hacer con tiempo (al empezar la canción actual), nunca en el último segundo.

---

## 4. Suposiciones del agente

Cosas que decidí yo — porque las deduje del código o porque él respondió "decide tú".
**Válidas mientras no las desmienta.**

- **S1** — "Poner automix" actúa sobre **lo que está listado en ese momento**: una carpeta de género, un artista, "Todas las canciones" o incluso el resultado del buscador. *(deducido de: el botón vive en la barra del buscador, igual que "Actualizar lista")*
- **S2** — Canciones **sin BPM** en modo carpeta: van **al final** de la ruta y se encadenan con fundido simple, sin igualar velocidad. *(no hay con qué ordenarlas)*
- **S3** — Si una canción de la cola **no se puede cargar** (archivo borrado, error de lectura): se salta, se avisa en pantalla y sigue con la siguiente. Nunca se queda callado. *(regla 4 del proyecto: nada falla en silencio)*
- **S4** — La siguiente canción se **precarga en cuanto termina la transición anterior**, no cuando la actual va a acabar. *(L9)*
- **S5** — La cola **no se guarda** entre sesiones: al cerrar la app se pierde. *(si se quiere persistir, se decide luego)*
- **S6** — **Ruta por BPM** (modo carpeta): empieza por la canción más parecida a la que está sonando (o la de BPM más "central" si no suena nada) y va encadenando la de BPM más cercano aún no usada, aceptando dobles/mitades como equivalentes (95 ≈ 190) y nunca saltando más de lo que la velocidad puede igualar (8 %); si no queda ninguna dentro del salto, toma la más cercana igual y la transición se hace con fundido sin igualar velocidad. *(es lo que hace un DJ: subir y bajar poco a poco)*
- **S7** — Evitar el **mismo artista dos veces seguidas** en la ruta, cuando hay con qué. *(se confirma en ronda 2 como sugerencia)*
- **S8** — **"Poner automix" enciende el automix** además de llenar la cola. *("que empiece a mezclar solo")*
- **S9** — Con el automix encendido, el **volumen general (VOL) sigue funcionando** y el botón MEZCLAR se deshabilita; lo bloqueado es play/pausa, avance, volumen de cada deck, crossfader y cargar canciones en los decks. *(hay que poder bajar el volumen si el animador habla)*
- **S10** — Tras cada transición la canción nueva **vuelve a su tempo natural** en unos segundos (como hoy, `returnToNatural`). *(nadie quiere Romeo Santos acelerado 6 % toda la canción)*
- **S11** — Las canciones **sin golpes analizados** se mezclan igualando solo velocidad (como hoy); el análisis de golpes corre en segundo plano, una canción a la vez, como el de BPM. *(nunca se bloquea por falta de análisis)*

---

## 5. Descartado (no volver a proponer)

- **LOAD/SYNC de la DDJ-200** con la cola → "después, como tarea aparte" (ronda 1). No entra aquí.
- **Panel de ajustes de transición** en pantalla → descartado (D9): automático según la canción.
- **Bandejas internas invisibles** para el automix → se prefirió alternar A/B (D5).
- **"Pregunta cada vez" / "Entra de una"** al encender con música sonando → se prefirió respetar la que suena (D4).

---

## 6. Estado de las rondas

- **Ronda 1 — Visión general** ✅ respondida · `Cuestionario-1-Automix.html`
- **Ronda 2 — Comportamiento y pantalla** ✅ respondida · `Cuestionario-2-Automix.html`
- **Ronda 3** ❌ no se hace: ya no queda nada que adivinar.

---

## 7. Incógnitas abiertas

*(ninguna: todo lo de la lista anterior quedó en D3–D17 o en suposiciones S1–S11)*

---

## 8. Plan de implementación

**Cómo funciona por dentro (resumen):** un controlador `Automix` (TypeScript) vigila 4 veces por segundo el deck que suena. Al cargar cualquier canción, el motor analiza el audio ya decodificado (milisegundos): silencio inicial/final, dónde cae la energía al final (outro) y dónde cae el primer golpe. La siguiente canción se precarga en el deck libre. Cuando el deck que suena llega al punto de mezcla, se arranca la siguiente **en su primer golpe, justo en un golpe de la actual** (programado con precisión de muestra en el reloj de audio), con la velocidad igualada; el crossfader se mueve solo; al terminar se pausa la anterior, la nueva vuelve a su tempo natural y se precarga la que sigue.

- [x] 1 · `src/audio/analisis.ts`: análisis del AudioBuffer (silencios, outro, primer golpe, fase local de pulso).
- [x] 2 · `AudioEngine`: analizar al cargar; recortar silencios siempre; arranque programado en un instante del reloj de audio; función `transicion()` compartida (MEZCLAR también alinea golpes desde ahora).
- [x] 3 · `src/lib/ruta.ts`: orden de la carpeta por BPM (dobles/mitades, salto ≤ 8 %, sin repetir artista seguido, empezar por la más parecida a la que suena).
- [x] 4 · `store`: estado de la cola (encendido, canciones, sonando, siguiente, etiqueta, cuenta regresiva) y aviso de confirmación con 3 botones (limpiar / añadir / cancelar).
- [x] 5 · `src/audio/Automix.ts`: controlador (encender, apagar, agregar, poner carpeta, quitar, mover, limpiar, saltar, regla D11, precarga, fallos de carga → saltar y avisar).
- [x] 6 · `AutomixBar.tsx` + CSS: tercera columna plegable; encendido/apagado, Saltar, Limpiar; filas arrastrables (reordenar, quitar), marca "Sonando" / "Siguiente" / "ya sonó"; cuenta regresiva a la próxima mezcla.
- [x] 7 · `TrackList`: botón "Poner automix" junto a "Actualizar lista" (actúa sobre lo listado; si la cola tiene canciones pregunta limpiar/añadir); A/B y doble clic bloqueados con aviso.
- [x] 8 · Bloqueos con automix encendido: DeckPanel (play, avance, volumen, soltar canción), ProgressBar (buscar), Mixer (crossfader, MEZCLAR), MIDI (deck/crossfader). VOL general sigue.
- [x] 9 · Probar (en el navegador integrado con las canciones reales, ver bitácora) (dos canciones reales, transición alineada, cola que da vueltas, agregar en segunda vuelta, saltar, apagar a mitad).
- [x] 10 · Versión 0.4.18 publicada con `./publicar.sh` (2026-10-18).

---

## 9. Bitácora

- **2026-10-18** — Se leyó el proyecto (AudioEngine, store, TrackList, FolderTree, DeckPanel, Mixer, bpm.rs, library.rs, ddj200.rs, useMidi) y la guía de Organizar_Canciones. Se armó la ronda 1 con 4 preguntas y 5 sugerencias.
- **2026-10-18** — Ronda 1 respondida (D3–D9). Hallazgo para la ronda 2: la app ya tiene una **caché compartida por Sync** (`cache.rs`: un archivo `bpm-<pc>.json` por PC, viaja con la biblioteca) donde cabría el análisis de golpes sin reescribir los MP3.
- **2026-10-18** — Ronda 2 respondida (D10–D17). No hay ronda 3.
- **2026-10-18 · Decisión sobre la marcha (D17):** al diseñar el análisis de golpes resultó que **no hace falta ni la skill ni la caché compartida**: la app ya tiene el audio decodificado de cada canción al cargarla en un deck, y sacar silencios, outro y primer golpe de ahí cuesta milisegundos (igual que la auto-nivelación que ya existe). Además, la fase del pulso de la canción que está sonando se mide **en el momento de la mezcla**, sobre el audio real de ese instante, lo que es más exacto que cualquier valor guardado (un BPM entero de Deezer, 133 en vez de 132.94, acumula un cuarto de golpe de error en 3 minutos). Resultado: todas las carpetas quedan cubiertas sin reescribir MP3 ni esperar análisis, que era la preocupación de fondo. Si el usuario igual quiere la etiqueta en el MP3, se añade después sin tocar nada de esto.
- **2026-10-18 · Construcción.** Hecho todo el plan (pasos 1–8). Pruebas en el navegador integrado con la biblioteca real (modo de prueba solo en desarrollo: `DJ_BIBLIOTECA_JSON` + `.claude/launch.json`), de punta a punta: cola por carpeta ordenada por ritmo (117→120→123→126→127→128→133), primera canción arranca sola, la siguiente se precarga en el deck libre, transición con velocidad igualada (p. ej. 0,9286) y golpes alineados, al terminar la anterior se pausa y la nueva vuelve a su tempo; Saltar; vuelta 2 en orden; canción agregada en la vuelta 2 suena de inmediato y luego sigue por donde iba; apagar deja los decks sonando; bloqueo con aviso; cuadro "Limpiar y poner / Añadir al final".
- **Fallos encontrados y arreglados sobre la marcha:**
  1. **Seek tomado como fin de canción** (latente desde antes): el `onended` de la fuente vieja llegaba después de crear la nueva y se contaba como fin natural; con automix arrancaba la siguiente de golpe. Ahora cada fuente comprueba que sigue siendo la vigente.
  2. **Animaciones con `requestAnimationFrame`**: el navegador las congela con la ventana oculta/minimizada y una transición quedaba a medias con los dos decks a todo volumen. Crossfader y velocidad ahora son curvas programadas en los `AudioParam` (hilo de audio); la posición se calcula integrando la rampa.
  3. **Silencios con umbral fijo (-40 dB)** se comían intros suaves de MP3 masterizados bajitos ("Los Infieles": 8 s de guitarra). Umbral relativo al cuerpo de la canción (-35 dB al inicio, -28 dB al final) con piso de -70 dBFS.
  4. La barra de progreso no se repintaba al cargar una canción en pausa (mostraba 0:00/-0:00): ahora repinta al cambiar la duración.
- **Pedidos del usuario durante la construcción (2026-10-18):** el aviso "apaga el automix" se perdía abajo → ahora sale **grande en el centro y se desvanece** (2,6 s). La barra de progreso debe seguir mostrando dónde va la canción con el automix encendido → ya lo hace (lo que vio en su pantalla fue la recarga en caliente de Vite mezclando módulos viejos y nuevos; con la app reiniciada no pasa). Al apagar el automix la canción sigue en su deck para mezclarla a mano → así funciona.
- **Decisión sobre la marcha:** la ruta por carpeta, cuando no suena nada, empieza por la **más lenta** y va subiendo (arrancar por la mitad obligaba a bajar de golpe al final).
- **2026-10-18 · Cierre.** Commit `ca89680` + publicación 0.4.18. Los HTML de las rondas se borraron; esta guía queda como historia. **Pendiente de la vida real:** probar en un portátil del equipo (WebKitGTK, i5-6300U) que la transición suene alineada y que el CPU no suba al precargar; y escuchar cómo cae el punto de entrada en canciones con cola floja larga.
- **2026-10-18 · Primer uso real (Sharon, portátil del equipo, 0.4.18).** Dijo: "no deja adelantar ni pausar" y "se demora mucho en bajar el sonido de una canción; necesito que se pause una para que suene bien la otra". Se le llevó al usuario como choque con D6 y D16:
  - **D6 se mantiene** (controles bloqueados con el automix encendido; para pasar está Saltar). Decisión del usuario, 2026-10-18.
  - **D16 cambia:** transición de **5 s en bailables y 4 s en lentos** (antes 8 y 6), y la curva de la transición automática pasa a **igual potencia**: la que sale baja desde el primer segundo (con el corte lineal se quedaba al 100 % media transición). El crossfader manual conserva su corte lineal. El cambio de graves (Efectos, D2) sigue entre el 40 % y el 70 %.
