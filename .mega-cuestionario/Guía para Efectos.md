# Guía para Efectos (manecillas)

> Documento vivo. Aquí queda **todo lo decidido**, para no depender de la memoria del chat.
> Si se cierra la sesión, se retoma leyendo este archivo.

- **Tarea:** manecillas (perillas) de efectos en el mezclador, por ejemplo bajarle solo a la voz de una canción, "y así".
- **Inicio:** 2026-10-18
- **Estado:** 🔵 Construyendo
- **Proyecto:** `~/Apps Zeven/Infiniity Dj Pro` · versión actual 0.4.18

---

## 1. Objetivo

Que quien maneja la música pueda retocar la canción que suena sin saber de DJ: bajar la voz, apagar
graves o agudos, hacer una "subida" con el filtro. Y que las transiciones (MEZCLAR y automix)
suenen más limpias con el cambio de graves automático. Las perillas de la DDJ-200 hacen lo mismo
que las de pantalla.

---

## 2. Decisiones CERRADAS

### Del contexto (antes del cuestionario)

| # | Decisión | Por qué |
|---|----------|---------|
| D1 | Existen manecillas de efectos; una de ellas baja la voz. | Pedido explícito. |

### De la ronda 1 (2026-10-18) — el usuario respondió "decide tú" a las 4 preguntas

| # | Decisión | Por qué |
|---|----------|---------|
| D2 | **Cambio de graves automático** en el automix **y** en MEZCLAR. | Aceptado (S1). Implica EQ por deck. |
| D3 | **Perillas de la DDJ-200** (EQ y filtro) en esta tarea; el usuario confirma con la controladora. | Aceptado (S2). Implica EQ y filtro por deck. |
| D4 | *(confirmado en ronda 2)* **Efectos: Graves · Medios · Agudos · Filtro · Voz.** Sin eco ni reverberación por ahora. | Son los que usa un DJ de fiesta y los que trae la DDJ-200; eco y reverb exigen criterio para no sonar mal y gente sin experiencia no los va a usar. |
| D5 | *(decidido por el agente)* **Voz = una perilla gradual** que cancela el centro conservando los graves y recorta la banda de la voz. A 0 no hace nada. | Es lo que mejor suena en canciones normales; sin IA (ver L2). |
| D6 | *(decidido por el agente)* **Por deck**, cada uno su juego. | D2 y D3 lo exigen. |
| D7 | *(confirmado en ronda 2)* **Perillas, sin botón de encendido.** Doble clic devuelve al neutro. La de Voz a 0 = apagada; las demás, al centro = sin efecto. | Menos cosas en pantalla; el neutro es evidente. |

---

## 3. Límites encontrados en el código (lo que hay y lo que no)

- **L1 — Cadena de audio actual** (`AudioEngine.ts`): por deck `Fuente → nivelación → volumen → crossfader → master → limitador → salida`. Los efectos se enchufan entre la fuente y el volumen; son nodos estándar de Web Audio que **corren en el hilo de audio nativo**, no en la interfaz: un filtro o un ecualizador **no cuesta CPU visible** ni en el portátil flojo. Sí cuesta un poco más la reverberación (convolución).
- **L2 — "Bajar solo la voz" tiene dos formas baratas y una cara:**
  - *Cancelación de centro* (el truco del karaoke): la voz casi siempre va en el centro del estéreo; restando el canal izquierdo del derecho desaparece. **Gratis.** Pega: también se lleva el bajo y el bombo si están en el centro (se evita dejando los graves aparte, por debajo de ~200 Hz), y en canciones con la voz "abierta" o con mucho eco, la voz baja pero queda un fantasma. En mono no hace nada.
  - *Bajar la banda de la voz* (ecualizador en 300 Hz – 3 kHz): la voz baja de forma gradual, pero también bajan guitarras y teclados de esa zona. **Gratis.** Nunca la quita del todo.
  - *Separación con inteligencia artificial* (Demucs/Spleeter): la única que de verdad aísla la voz. **No sirve en vivo en los portátiles del equipo**: tarda minutos por canción y pesa gigas. Solo valdría como proceso previo en el PC original (fuera de esta tarea).
- **L3 — Efectos típicos de un mezclador DJ y su costo:** ecualizador de 3 bandas (graves/medios/agudos), filtro (una perilla: a la izquierda pasa-bajos, a la derecha pasa-altos), eco/delay, reverberación, flanger/phaser. Todos existen como nodos estándar; eco y reverb necesitan sincronía con el BPM para sonar bien (el BPM ya está).
- **L4 — DDJ-200:** la controladora tiene perillas de EQ (HI/MID/LOW) por canal y una perilla de filtro (CFX). Hoy `ddj200.rs` **no las mapea** (solo play, cue, sync, load, tempo, volumen, jog, crossfader). Los números MIDI de esas perillas se conocen por documentación pero **habría que confirmarlos con la unidad real**, como se hizo con el resto.
- **L5 — Pantalla:** 1366×768. Cada deck ya lleva disco, título, barra y transporte; el mezclador central tiene MEZCLAR, crossfader y VOL. Las perillas necesitan sitio (una fila bajo el transporte de cada deck, o en el mezclador).
- **L6 — Automix / MEZCLAR:** la transición hoy es solo crossfader. Los DJ hacen "cambio de graves" (bajan los graves de la que sale mientras entra la nueva) para que no se amontonen dos bombos: con un EQ por deck se puede hacer solo.
- **L7 — Modo bajo consumo:** las perillas son DOM estático; el costo está en cómo se dibujan al girar (nada de animaciones continuas).

---

## 4. Suposiciones del agente

- **S1** — Las perillas se controlan con el ratón arrastrando vertical (arriba sube, abajo baja) y **doble clic las devuelve al centro/neutro**, igual que el crossfader. *(convención de la app)*
- **S2** — Ningún efecto cambia el volumen general percibido de golpe: todo neutro = suena exactamente como hoy. *(no romper lo que funciona)*
- **S3** — *(menor, decidido)* Las perillas van en **una fila bajo el transporte de cada deck** (Graves · Medios · Agudos · Filtro · Voz), pequeñas, con el nombre debajo. *(es donde cabe sin tocar el mezclador)*
- **S4** — *(menor, decidido)* Al cargar otra canción en un deck, **sus perillas vuelven al neutro**. *(que nadie se quede con la voz apagada sin querer en la siguiente canción)*
- **S5** — Cambio de graves en la transición: los graves de la que sale bajan durante la primera mitad del crossfade y los de la que entra suben desde cero en ese mismo tramo; al terminar, todo vuelve al neutro. *(regla de DJ; se ajusta de oído)*
- **S6** — Filtro: perilla centrada = nada; hacia la izquierda pasa-bajos (se apagan los agudos) y hacia la derecha pasa-altos (se apagan los graves), con una resonancia suave. EQ: ±12 dB por banda con cortes en ~200 Hz y ~3 kHz. *(valores típicos de mezclador)*
- **S7** — DDJ-200: se mapean los números MIDI documentados (EQ HI/MID/LOW y CFX); si alguna perilla no responde, el usuario lo dice y se ajusta el número. *(mismo método que con el resto del mapeo)*
- **S8** — Con el automix encendido, las perillas de efectos **sí** se pueden tocar (no son transporte ni crossfader). *(bajar la voz para que hable el animador es justo el caso)*

---

## 5. Descartado (no volver a proponer)

- *(nada aún)*

---

## 6. Estado de las rondas

- **Ronda 1 — Visión general** ✅ respondida (todo "decide tú") · `Cuestionario-1-Efectos.html`
- **Ronda 2 — Confirmación** ✅ respondida (las dos recomendadas) · `Cuestionario-2-Efectos.html`
- **Ronda 3** ❌ no se hace: no queda nada que adivinar.

---

## 7. Incógnitas abiertas

*(ninguna)*

---

## 8. Plan de implementación

**Cadena por deck:** `Fuente → nivelación → Graves → Medios → Agudos → Filtro → [Voz: seco / húmedo] → cambio-de-graves (interno) → volumen → crossfader`.
Voz húmedo = (izq − der, y der − izq) para cancelar el centro + los graves originales por debajo de 180 Hz + recorte de la banda de la voz; la perilla mezcla seco/húmedo.

- [x] 1 · `store`: `fx` por deck (graves, medios, agudos, filtro, voz) con sus neutros.
- [x] 2 · `AudioEngine`: nodos de efectos por deck, `setFx`, `resetFx` (al cargar), y cambio de graves en `transicion()` con un filtro interno aparte (las perillas del usuario no se mueven solas).
- [x] 3 · `Perilla.tsx`: perilla SVG, arrastre vertical, rueda, doble clic al neutro; sin animación continua.
- [x] 4 · `DeckPanel`: fila de 5 perillas bajo el título (cabe sin crecer la pantalla).
- [x] 5 · `ddj200.rs` + `useMidi`: EQ HI/MID/LOW (CC 0x07/0x0B/0x0F por canal) y CFX (canal 6, CC 0x17/0x18); permitidas con el automix encendido.
- [x] 6 · Probado en el navegador de prueba con tonos sintéticos (ver bitácora). Publicar: 0.4.19.

---

## 9. Bitácora

- **2026-10-18** — Se revisó la cadena de audio, el mapeo DDJ-200 y el espacio en pantalla. Ronda 1 armada.
- **2026-10-18** — Ronda 1: "decide tú" en las 4. Se decidió lo menor (S3–S8) y se insiste una sola vez en las dos críticas (D4, D7) en la ronda 2.
- **2026-10-18 · Construcción y prueba.** Medido con un analizador sobre tonos sintéticos (60 Hz al centro como bombo, 1 kHz al centro como voz, 6 kHz solo a la izquierda): Voz al máximo baja la voz **−31 dB** y conserva el bombo (+3 dB) y los instrumentos laterales; Graves abajo del todo **−23 dB** a 60 Hz; Agudos arriba **+11 dB** a 6 kHz; Filtro a la izquierda **−40 dB** a 6 kHz; a la derecha **−50 dB** a 60 Hz; todo al neutro = idéntico al original (medido). Cambio de graves en la transición: a los 4,6 s de 8 la que entra va en −7 dB y la que sale en −11; a los 6,6 s están intercambiadas (0 / −18); al terminar ambas en 0 y la que salió pausada.
- **Fallo encontrado y arreglado:** la primera versión de Voz mandaba izq−der por un lado y der−izq por el otro. Eso suena bien en estéreo, pero un equipo de sonido **mono** (muchos de eventos) suma los dos lados y **se cancela todo menos el bajo** (el analizador, que suma a mono, lo mostró: −104 dB en los laterales). Ahora la misma resta sale por los dos lados: se pierde anchura estéreo, pero funciona en cualquier equipo.
- **DDJ-200:** números MIDI puestos por documentación (EQ HI/MID/LOW = CC 0x07/0x0B/0x0F en el canal del deck; CFX = canal 6, CC 0x17 deck 1 y 0x18 deck 2). **Pendiente que el usuario los confirme con la controladora**; si alguna perilla no responde, se ajusta el número en `ddj200.rs`.
