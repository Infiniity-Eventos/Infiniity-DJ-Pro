# Guía para Sync (biblioteca sincronizada entre todas las PC)

> Documento vivo. Aquí queda **todo lo decidido**, para no depender de la memoria del chat.
> Si se cierra la sesión, se retoma leyendo este archivo. Complementa a `PLAN-SYNC.md` (raíz).

- **Tarea:** que todas las PC del equipo usen la misma biblioteca de música, con el original en el PC de Camilo, sincronizada con Syncthing y manejada desde la app.
- **Inicio:** 2026-10-18 (diseño acordado el 2026-10-17)
- **Estado:** ✅ Terminada (0.4.0, 2026-10-18)
- **Proyecto:** `~/Apps Zeven/Infiniity Dj Pro` (Tauri v2 + React)

---

## 1. Objetivo

El equipo (varias PC con Linux Mint, portátiles flojos) debe tener siempre la misma música que el PC
de Camilo (`~/Música`, 911 MB / 492 canciones hoy). El equipo **sí agrega** canciones (descargas de
YouTube en "Sin clasificar") porque sabe qué se usa en los eventos; **no toca** las carpetas ya
clasificadas. El orden lo controla solo Camilo. En las PC del equipo no existe "elegir carpeta".

---

## 2. Decisiones CERRADAS

### Del acuerdo del 2026-10-17 (chat, antes del cuestionario)

| # | Decisión | Por qué |
|---|----------|---------|
| D1 | Syncthing como motor (PC a PC, sin cuentas ni nube). La app lo instala, configura y controla por su API REST local. | Gratis, estable, ya instalado en el PC original. Igual que hoy baja yt-dlp/Deno/ffmpeg a su carpeta. |
| D2 | Dos carpetas: **Biblioteca** (clasificadas) = original solo envía / equipo solo recibe; **Sin clasificar** = dos direcciones. | El equipo agrega pero no reordena. |
| D3 | Papelera (versionado) de 30 días en el PC original. | Un borrado por error en "Sin clasificar" se propaga; así se recupera. |
| D4 | En las PC del equipo no hay selector de carpeta: la app crea `~/Infiniity DJ/Biblioteca` y quita el botón 📁. | Que nadie apunte la app a un USB o carpeta suelta. |
| D5 | Entrada de una PC nueva con un código generado en la app original; muestra avance de la primera copia. | |
| D6 | El caché de BPM también se sincroniza. | No re-analizar en cada PC. |
| D7 | En el PC original todo sigue en `~/Música` tal cual, y conserva el botón Carpeta. | No mover nada; es la fuente. |

### De la ronda 1 (2026-10-18)

| # | Decisión | Por qué |
|---|----------|---------|
| D8 | **Empezar limpio**: se borra la configuración anterior de Syncthing del PC original. La app usa su propia instancia (carpeta de datos y puertos propios), independiente de cualquier Syncthing manual. | Convivir con una config a mano es más enredado. No se toca la música. |
| D9 | **El código acepta solo** a la PC nueva, sin que Camilo haga nada. | Comodidad; el código se puede cambiar desde la app original. |
| D10 | En el **PC original** la sincronización corre **siempre** (servicio de usuario al iniciar sesión), aunque la app esté cerrada. | El PC original es el punto de encuentro. |
| D11 | En las **PC del equipo** corre **solo con la app abierta**, y **con autorización**: al abrir, si hay cosas pendientes, la app avisa "Te falta sincronizar con la carpeta madre: N canciones" y la persona decide sincronizar ahora o más tarde. | Pedido explícito: que ellos autoricen. |
| D12 | **Toda la biblioteca** en todas las PC. | Cualquier PC sirve para cualquier evento. |
| D13 | En modo equipo se **bloquea** mover/arrastrar a carpeta y crear carpeta. | Con D2, mover una canción allá la borraría en todas. |
| D14 | La app **evita duplicados** por nombre al descargar y **limpia los conflictos** (`*.sync-conflict-*`) sola. | Dos PC bajando la misma canción. |
| D15 | La sincronización **se pausa sola mientras suene un deck**, **avisando en pantalla** que está en pausa por eso (no es un bug), y la persona puede **pausar/continuar a mano** desde el panel de Sync. | CPU/disco en portátiles flojos en pleno evento; que no parezca un fallo. |

---

## 3. Suposiciones del agente

Válidas mientras no las desmienta.

- **S1** — El caché de BPM hoy usa la ruta absoluta como clave (`cache.rs: track_key = path|size|mtime`); para que viaje entre PC se pasará a **ruta relativa a la raíz** + tamaño + mtime (Syncthing conserva el mtime). *(deducido de `src-tauri/src/cache.rs`)*
- **S2** — "Sin clasificar" se excluye de la carpeta Biblioteca con `.stignore` y se comparte como carpeta aparte. *(técnica de Syncthing)*
- **S3** — Una carpeta "solo recibir" de Syncthing **no revierte sola** los cambios locales: los marca y hay que pedir el "revert". La app lo pedirá automáticamente (cada pocos minutos y al arrancar). *(comportamiento de Syncthing)*
- **S4** — Descubrimiento global y relés de Syncthing activados: las PC se encuentran en la misma red o por internet. *(valor por defecto; no cambia el diseño)*
- **S5** — Interfaz web de Syncthing (puerto 8384) oculta/solo local; el usuario nunca la ve. La app es la única cara.
- **S6** — PC del equipo que ya tenían carpeta propia: al actualizar piden el código una vez; la carpeta vieja queda en disco sin usarse. Si tenía canciones que valen, se copian a "Sin clasificar" a mano (quien instala).
- **S8** — El código de emparejamiento es texto largo (lleva el ID del PC original + un secreto corto): se **copia y pega** (botón Copiar en la app original; se manda por WhatsApp). No se teclea a mano. Formato `IDJ1-<id>-<secreto>`.
- **S9** — Cómo "acepta solo" (D9): la PC nueva se registra en Syncthing con nombre `Infiniity DJ|<nombre-pc>|<secreto>`; un vigilante en el PC original ve las PC pendientes y acepta las que traen el secreto correcto, compartiéndoles las carpetas. Cambiar el secreto en la app original invalida los códigos viejos.
- **S10** — El vigilante del PC original corre como **servicio de usuario** (`infiniity-dj --sync-agente`, el mismo AppImage sin ventana), que además mantiene Syncthing encendido (D10).
- **S11** — Para poder decir "te falta sincronizar N canciones" antes de que la persona autorice (D11), Syncthing arranca con un **límite de velocidad mínimo** (50 KB/s: el índice sí viaja, la música prácticamente no). Autorizar = quitar el límite. Pausa por música (D15) = volver al límite. Es más fiable que "pausar" las carpetas, que impide saber qué falta.
- **S12** — El aviso de "te falta sincronizar" solo aparece cuando de verdad hay algo pendiente; si está al día, no molesta.
- **S13** — El caché de BPM compartido se hace con **un archivo por PC** (`bpm-<id>.json`) en una carpeta sincronizada pequeña; cada PC lee todos y los junta. Así nunca hay conflicto de escritura. Clave por ruta relativa (S1).
- **S14** — Puertos propios para no chocar con un Syncthing manual: API `127.0.0.1:8385`, datos `22001`.
- **S15** — Carpeta del equipo: `~/Infiniity DJ/Biblioteca`, con `Sin clasificar` adentro; cada PC escribe su propio `.stignore` (no se sincroniza) para excluir `Sin clasificar` de la carpeta Biblioteca.
- **S7** — El PC original es este Fedora con la app instalada (AppImage). Ya tiene Syncthing v2.1.2 en `~/.local/bin` (apagado), con una configuración anterior en `~/.local/state/syncthing/config.xml`: carpeta `infiniity-musica` → `~/Música` compartida con el equipo "PORTATIL INTEL CORE I5 Vpro". *(encontrado el 2026-10-18; se pregunta qué hacer en la ronda 1)*

---

## 4. Descartado (no volver a proponer)

- Nube (Drive/Dropbox) → requiere cuentas y espacio pago; se prefirió Syncthing.
- Que el PC original sea "solo enviar" también en "Sin clasificar" → se descartó el 2026-10-17 porque el equipo debe poder agregar descargas.
- Dos direcciones en TODA la biblioteca → descartado: un error en una PC borraría en todas.

---

## 5. Estado de las rondas

- **Ronda 1 — Visión general** ✅ respondida · `Cuestionario-1-Sync.html`
- **Ronda 2** ❌ no se hace: con la ronda 1 más las suposiciones S8–S15 no queda nada que adivinar.

---

## 6. Incógnitas abiertas

Ninguna. Todo lo demás son decisiones técnicas internas anotadas como suposiciones.

---

## 7. Plan de implementación

Fase A — motor (Rust, `src-tauri/src/sync.rs`)
- [x] A1 · Instalar Syncthing en la carpeta de la app (bajar release de GitHub, .tar.gz, 100% Rust) si no está.
- [x] A2 · Arrancar/parar Syncthing con home propio (`app_data/syncthing`), API key propia, puertos S14, sin navegador; leer su API REST.
- [x] A3 · Estado `sync.json`: rol (original/equipo/ninguno), secreto, id del original, autorizado-esta-sesión.
- [x] A4 · Original: "crear grupo" → carpetas `biblioteca` (sendonly, `~/Música`, .stignore "Sin clasificar"), `sinclasificar` (sendreceive, papelera 30 d), `bpm` (sendreceive). Generar código.
- [x] A5 · Original: vigilante que acepta PC pendientes con el secreto (S9) y les comparte las 3 carpetas. Modo `--sync-agente` + servicio de usuario (S10). Borrar config anterior (D8).
- [x] A6 · Equipo: "unirse con código" → añade el original, acepta las 3 carpetas en `~/Infiniity DJ/Biblioteca` (receiveonly / sendreceive / sendreceive), escribe .stignore, revert automático de cambios locales en Biblioteca (S3).
- [x] A7 · Equipo: límite 50 KB/s hasta autorizar (S11); pausa por música (D15); contar pendientes (`/rest/db/completion`).
- [x] A8 · Limpieza de `*.sync-conflict-*` y no bajar duplicados (D14).
- [x] A9 · Caché de BPM por PC en carpeta `bpm` (S13), clave relativa (S1).

Fase B — interfaz (React)
- [x] B1 · Rol equipo: pantalla de bienvenida pide el código en vez de carpeta; sin botón Carpeta; sin mover/crear carpetas (D13); biblioteca fija.
- [x] B2 · Botón **Sync** en la barra con estado (al día / N pendientes / sincronizando / en pausa por música / sin conexión con el original) y panel: Sincronizar ahora / Pausar / Continuar.
- [x] B3 · Aviso al abrir "Te falta sincronizar con la carpeta madre: N canciones" (D11, S12).
- [x] B4 · Rol original: panel con código (Copiar), cambiar secreto, lista de PC conectadas y último sync, "Crear grupo".
- [x] B5 · Avance de la primera copia.

Fase C — prueba y publicación
- [x] C1 · Probar en este PC: original (app instalada) + "PC del equipo" simulada (el AppImage con otro HOME).
- [x] C2 · Publicar; en las PC del equipo todo queda inactivo hasta que se meta un código.

---

## 8. Bitácora

- **2026-10-18** — Se abre la guía. Investigación previa: la app ya instala herramientas en su carpeta sin sudo (`downloader.rs`), el caché de BPM es por ruta absoluta (S1), la pantalla de bienvenida (`Welcome.tsx`) es donde iría el código de emparejamiento, y existe una configuración previa de Syncthing en este PC (S7). Ronda 1 entregada.
- **2026-10-18** — Ronda 1 respondida. No hace falta ronda 2. Plan escrito; se empieza por la fase A.
- **2026-10-18** — Construido y probado con dos instancias en este PC (ver mensaje del commit). Decidido sobre la marcha: (1) `limitBandwidthInLan: true`, sin eso el freno no aplicaba en la red local; (2) las banderas de sesión (autorizado/música/pausa) van en `sync-sesion.json` y se borran al abrir la app, para que la app y `--sync-cli` vean lo mismo; (3) la dirección del original se puede fijar con `INFINIITY_DJ_SYNC_DIRECCION_ORIGINAL` (solo pruebas); (4) `--sync-cli` quedó como herramienta de diagnóstico. Tropiezos: el tar.gz trae otro archivo llamado "syncthing" (perfil de firewall); `--no-default-folder` no existe en `serve`; la config se guardaba antes de generar la clave de la API. Publicado como 0.4.0. Cuestionario HTML borrado (ya respondido).
