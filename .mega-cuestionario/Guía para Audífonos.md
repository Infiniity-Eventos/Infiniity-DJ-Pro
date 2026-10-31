# Guía para Audífonos

> Documento vivo. Aquí queda **todo lo decidido**, para no depender de la memoria del chat.
> Si se cierra la sesión, se retoma leyendo este archivo.

- **Tarea:** que los audífonos funcionen como la pre-escucha de un mixer de DJ: el público
  oye lo que diga la barra (crossfader) y el DJ, en los audífonos, oye los decks que quiera
  **completos, sin importar la barra**, para saber cuándo hacer el cambio. Además: las columnas
  A/B pasan a ser el volumen de cada deck, y los dos decks quedan siempre del mismo ancho.
- **Inicio:** 2026-10-31
- **Estado:** 🟡 Hecha sin probar en un portátil real (0.4.69, instalación a mano, sin firmar)
- **Versión de partida:** 0.4.68

---

## 1. Objetivo

Palabras del usuario (31-oct): *"necesitamos es ir escuchando la otra canción pero en el mismo
deck para saber cuándo hacer el cambio [...] uno con la barra escoge qué canción suena, pero si
activa los audífonos suena independientemente de esa barra, así uno en los audífonos tiene las
dos canciones sonando para escuchar cuándo hacer el cambio, y luego va moviendo la barra de lado
a lado y ya la gente escucha bien el golpe. Ahorita lo que tiene la opción de audífonos es que
reproduce la música en otro apartado y ya."*

---

## 2. Decisiones CERRADAS

### Ronda 1 (2026-10-31, en el chat)

| # | Decisión | Por qué |
|---|----------|---------|
| D1 | **Un botón de audífonos por deck** (A, B o los dos). Lo que oyen los audífonos es el deck **completo, antes de la barra**, con sus perillas de efecto. | Elegido. Es como funciona un mixer de DJ. |
| D2 | Tiene que funcionar con **las dos conexiones**: cabina Bluetooth + audífonos de cable, y cabina de cable + audífonos Bluetooth. | "Varía según el evento". |
| D3 | Las columnas **A y B del centro pasan a ser el volumen de cada deck** y se quita el «Vol» de abajo de cada deck. | Elegido. Antes solo mostraban cuánto sonaba cada deck y la gente intentaba moverlas. |
| D4 | **Todo sale hoy**, probado solo en el navegador. Si falla en el portátil, se vuelve a la 0.4.68. | Elegido sabiendo el riesgo: hay evento hoy. |
| D5 | Los dos decks **siempre del mismo ancho**, por largo que sea el nombre de la canción. | Pedido: un nombre largo estiraba un deck y a veces sacaba la pantalla del borde. |

---

## 3. Límites encontrados en el código

- **L1 — La pre-escucha de la 0.4.67 era otra cosa:** `pacat` leía el ARCHIVO por su cuenta
  (`preescucha.rs`). No sabía nada del deck: ni velocidad, ni pausa, ni adelantar. Por eso
  "reproduce la música en otro apartado y ya".
- **L2 — El motor web solo tiene UNA salida.** No se puede abrir una segunda conexión del motor
  hacia los audífonos: se midió el 30-oct que el sistema la confunde con la de la cabina
  (`media.role = webaudio`) y la cabina se quedaba muda al rehacer la conexión.
- **L3 — Por eso** el sonido de los audífonos se toma DENTRO del motor (un nodo que copia la
  señal de los decks antes de la barra) y se le pasa en crudo al mismo `pacat` de siempre, con
  su nombre propio. El sistema nunca lo confunde con la cabina.
- **L4 — Un portátil con UNA sola entrada de audífonos no puede mandar dos cosas por cable.**
  Cabina y audífonos tienen que ir por salidas distintas (una Bluetooth, o una tarjeta USB).
  La app ya se niega a mandar la pre-escucha por la salida de la música.

---

## 4. Suposiciones del agente

Válidas mientras el usuario no las desmienta.

- **S1** — Los audífonos se oyen un poco **después** que la cabina de cable (unos 0,2 s). Entre
  los dos decks no hay desfase: los dos llegan juntos a los audífonos, que es lo que importa
  para cuadrar el golpe.
- **S2** — El botón de audífonos de la **lista** de canciones se queda como estaba (oír una
  canción que no está en ningún deck). El del **deck** pasa a ser el de esta guía.
- **S3** — Con el automix encendido, los botones de audífonos de los decks **sí funcionan**:
  solo escuchan, no cambian lo que oye el público.
- **S4** — Con el automix encendido, las columnas de volumen A/B quedan **bloqueadas** con
  aviso, como antes el «Vol» de cada deck (D6/S9 de la guía del Automix).
- **S5** — El volumen de los audífonos es aparte del VOL general: bajar la cabina no baja los
  audífonos.
- **S6** — La salida de los audífonos se elige sola (la que parezca de audífonos, o la última
  usada) y se puede cambiar en la barrita de audífonos.

---

## 5. Descartado

- Una segunda conexión del motor web hacia los audífonos → L2.

---

## 6. Estado de las rondas

- **Ronda 1** ✅ respondida en el chat (4 preguntas).

---

## 7. Pendiente de la vida real

- Probar en un portátil del equipo, en las dos conexiones (D2), que:
  - los audífonos suenan y siguen al deck (pausa, adelantar, velocidad);
  - la cabina **no cambia en nada** al encender o apagar los audífonos;
  - no se corta con la ventana minimizada;
  - el CPU no sube de forma notable con los audífonos encendidos.
