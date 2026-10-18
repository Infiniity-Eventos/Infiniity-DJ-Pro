# Guía para la skill /Organizar_Canciones

> Documento vivo. Aquí queda **todo lo decidido**, para no depender de la memoria del chat.
> Si se cierra la sesión, se retoma leyendo este archivo.

- **Tarea:** una skill del repositorio que, cada semana, toma lo que hay en "Sin clasificar", identifica cada canción por internet, le escribe todos los metadatos dentro del MP3 (título, artista, género, BPM, etc.) y la mueve a su carpeta de género.
- **Inicio:** 2026-10-18
- **Estado:** ✅ Terminada (primera corrida real hecha el 2026-10-18)
- **Proyecto:** `~/Apps Zeven/Infiniity Dj Pro` · biblioteca `~/Música/Infiniity Dj Pro` (Sync: PC original)

---

## 1. Objetivo

Que la biblioteca quede "súper completa": cada canción en su carpeta de género y con su información
dentro del archivo (nombre, artista, género, BPM…), sin que haya que escanearla en cada PC. Camilo
invoca la skill cada semana sobre "Sin clasificar" (lo que el equipo bajó de YouTube o agregó).

---

## 2. Decisiones CERRADAS

### Del contexto (antes del cuestionario)

| # | Decisión | Por qué |
|---|----------|---------|
| D1 | Corre solo en el PC original. | Es el único donde escribir archivos de la biblioteca no se revierte (Sync: carpetas clasificadas "solo enviar"). |
| D2 | Trabaja sobre "Sin clasificar" en cada invocación. | Es la bandeja de entrada acordada en Sync. |
| D3 | Los metadatos se escriben dentro del MP3 (etiquetas ID3v2). | Pedido explícito: que viajen con la canción y no haya que escanear en cada PC. |

### De la ronda 1 (2026-10-18)

| # | Decisión | Por qué |
|---|----------|---------|
| D4 | **Catálogo fijo de carpetas** (lista en ronda 2). La skill recomienda el género; si no existe carpeta, la canción va a una carpeta comodín y se **recuerda** el género sugerido. Cuando ese género junte varias canciones, la skill propone crear la carpeta y **mueve allí todas las que estaban esperando**. | Carpetas útiles para eventos, sin que se pierda lo que internet sabe. |
| D5 | Mueve y etiqueta sola lo seguro; **las dudosas se listan** para que Camilo decida. | Equilibrio trabajo/errores. |
| D6 | **Renombrar** con el formato **`Nombre De La Cancion - Artista x Colaborador 1 x Colaborador 2.mp3`**. | Mismo orden en todas las canciones. |
| D7 | **Todo a MP3**: lo que llegue en otro formato se convierte antes de etiquetar. | WAV y otros no guardan etiquetas bien y pesan más. |
| D8 | **Mixes** (sets largos): se categorizan por género y se nombran **`Mix Infiniity <Género> 01`**, `02`… por género. | Pedido explícito. |
| D9 | La **app lee el BPM de la etiqueta** (TBPM) y solo analiza si no hay. | Nunca más escanear en cada PC. |
| D10 | Etiquetar reescribe el archivo y Sync lo reenvía: aceptado. | |
| D11 | El **descargador** mete título/artista de YouTube al bajar, pero la skill **lo reemplaza todo** con lo de internet para que quede uniforme. | YouTube muchas veces solo trae el nombre. |
| D12 | **Repetidas**: se detectan y se listan; los remixes no cuentan como repetidas (hay que ver cada caso). | |
| D13 | **Sin carátula**: si el archivo trae una, **se borra**. Todas las canciones llevan la misma información. | |

---

### De la ronda 2 (2026-10-18)

| # | Decisión | Por qué |
|---|----------|---------|
| D14 | **Catálogo "colombianizado"**, géneros muy por encima: Merengue · Salsa · Salsa Choque · Bachata · Vallenato · Reggaeton · Champeta · Boleros · Viejoteca · Cumbia · Pop · Rock · Electronica · Crossover · Trap · Hora Loca · **Otros** (comodín). Nada de subgéneros (ni "Trap Dark", ni "Trap Soul"): todo eso es "Trap". Lo raro/novedad (Gangnam Style) → Hora Loca. "Música tropical" vieja → Viejoteca (la skill lo comprueba por año/artista). | Carpetas que sirven en un evento colombiano. |
| D15 | **Metadatos que se escriben**: Título (TIT2) · Artista con colaboradores (TPE1 "A x B x C") · Género (TCON = carpeta) · BPM (TBPM) · Año (TDRC) · Duración (TLEN) · ISRC (TSRC) · Comentario (COMM "Organizada por Infiniity · YouTube: <id> · <fecha>") · ReplayGain (TXXX:REPLAYGAIN_TRACK_GAIN). **Todo campo que no se use lleva "Creado por Infiniity Eventos"** (TALB, TPE2, TCOM, TPUB, TCOP, TENC): firma por si roban las canciones. | Pedido explícito. |
| D16 | **Mayúscula Inicial En Cada Palabra**, sin tildes ni símbolos raros, en nombre de archivo y etiquetas. | Uniforme y buscable. |
| D17 | Carpeta nueva cuando un género "en espera" junta **3** canciones. | |
| D18 | Los mixes van **dentro de la carpeta de su género**. | |
| D19 | Dudosas y repetidas: **lista numerada en el chat** al final, se responde ahí y la skill aplica. Además una **página HTML de revisión con reproductor** por canción (clic y suena) para comprobar repetidas. | "Las pueda escuchar con un click". |
| D20 | Sin tonalidad por ahora. **Sí ReplayGain** y la app lo usa. | |
| D21 | **Panel de carpetas de la app con dos modos**: *Géneros* (lista plana de carpetas de género, "Sin clasificar" de primera) y *Artistas* (lista de artistas sacada de la etiqueta; clic = todas las canciones de ese artista). Sin botón "Nueva carpeta": las carpetas las crea la skill. | Los gestores buscan "Romeo Santos" y ven todo lo suyo. |
| D22 | La skill **normaliza nombres de artista** (un solo "Romeo Santos", nunca "Romeo santos" / "Romeo Santos "), usando el nombre canónico de Deezer y una lista de alias en `.organizar/artistas.json`. | Un artista = una entrada. |

## 3. Suposiciones del agente

- **S1** — Herramientas: Python 3 con **mutagen 1.47** (ya instalado; lee/escribe ID3 completo) y **ffprobe/ffmpeg 8** para duración y, si hiciera falta, conversión. *(verificado en este PC)*
- **S2** — Fuentes de internet, todas gratis y sin cuenta, probadas con "Aventura - Los Infieles": **Deezer** (título, artista, álbum, fecha, **BPM 132.94**, ISRC, portada; género por álbum), **iTunes Search** (género "Música tropical", fecha), **MusicBrainz** (título/artista; etiquetas escasas). Orden: Deezer → iTunes → MusicBrainz. *(probado 2026-10-18)*
- **S3** — Identificación por **nombre de archivo limpiado** (quitar "(Video Oficial)", "[Official Audio]", "｜ Discos Fuentes", "ft."…), no por huella de audio (AcoustID exige clave de API y un binario extra). Si no hay coincidencia clara, cuenta como "no reconocida".
- **S4** — El BPM lo da Deezer cuando existe; si no, se calcula localmente (el mismo análisis que la app, vía `infiniity-dj --sync-cli`… no: vía un cálculo propio en Python/ffmpeg o reutilizando `bpm.rs` con un modo CLI). *(se define al construir)*
- **S5** — Los 149 archivos actuales son MP3 sin ninguna etiqueta (solo `encoder=Lavf`). No hay WAV hoy; si aparecen, se convierten a MP3 320k antes de etiquetar (WAV no guarda bien etiquetas y pesa 10×).
- **S6** — Escribir etiquetas cambia el archivo → Syncthing lo reenvía entero a todas las PC (una vez por canción). Renombrar, en cambio, no vuelve a copiar el audio.
- **S7** — Nunca se toca lo que ya está en una carpeta de género salvo que se pida explícitamente ("solo Sin clasificar" cada semana).
- **S8** — La skill deja un informe `.organizar/informe-<fecha>.md` con lo hecho, lo dudoso y lo no reconocido.

---

## 4. Qué datos se pueden escribir en un MP3 (etiquetas ID3v2.4, con mutagen)

| Etiqueta | Qué es | Comentario |
|---|---|---|
| TIT2 | Título | |
| TPE1 | Artista(s) | varios separados por `/` o lista |
| TPE2 | Artista del álbum | |
| TALB | Álbum | |
| TDRC / TYER | Fecha / año | |
| TCON | Género | texto libre; lo leen todos los programas |
| TBPM | BPM | lo leen Rekordbox, VirtualDJ, Serato, Traktor |
| TKEY | Tonalidad (clave musical) | Deezer no la da; se podría calcular |
| TRCK / TPOS | Nº de pista / disco | |
| TCOM | Compositor | |
| TPUB | Sello / discográfica | |
| TLEN | Duración (ms) | |
| TLAN | Idioma | |
| TSRC | ISRC (código único de la grabación) | lo da Deezer; sirve para detectar repetidas |
| TCOP | Copyright | |
| TMOO | Estado de ánimo (v2.4) | |
| COMM | Comentarios | texto libre |
| USLT | Letra | |
| APIC | Carátula (imagen) | 50–300 KB |
| POPM | Valoración (0–255) + contador de reproducciones | |
| TXXX:* | **Campos propios ilimitados** | p. ej. `TXXX:ENERGIA`, `TXXX:USADA_EN_EVENTOS`, `TXXX:ORIGEN=youtube:ID` |
| WOAR / WXXX | Enlaces (artista, fuente) | |

WAV solo admite unos pocos (INFO: título, artista, género, fecha, comentario); por eso S5.

---

## 5. Descartado (no volver a proponer)

- Archivo de datos aparte en vez de etiquetas → el usuario quiere la información pegada a la canción.
- Huella de audio (AcoustID) → requiere clave y binario externo; se parte de nombre + internet.

---

## 6. Estado de las rondas

- **Ronda 1 — Visión general** ✅ respondida · `Cuestionario-1-Organizar.html`
- **Ronda 2 — Detalle** 🟡 entregada, esperando · `Cuestionario-2-Organizar.html` (carpetas, metadatos exactos, mayúsculas, umbral de carpeta nueva, dónde van los mixes, cómo se resuelven las dudosas).

---

## 7. Incógnitas abiertas

1. Lista concreta de carpetas (catálogo inicial). *(ronda 2)*
2. Qué metadatos exactos se escriben (el usuario pidió verlos todos listados). *(ronda 2)*
3. Mayúsculas del nombre de archivo. *(ronda 2)*
4. Cuántas canciones de un género nuevo justifican crear su carpeta. *(ronda 2)*
5. Los mixes: ¿dentro de la carpeta del género o en una carpeta "Mixes"? *(ronda 2)*
6. Cómo se resuelven las dudosas: en el chat una por una, o informe. *(ronda 2)*

---

## 8. Plan de implementación

**A. La app lee etiquetas** (Rust + React) — para que el panel por artistas y el BPM de etiqueta funcionen en todas las PC.
- [x] A1 · `read_library` lee ID3 (crate `id3`): título, artista, género, TBPM, REPLAYGAIN_TRACK_GAIN → `TrackInfo { artist, bpm_tag, gain_db }`. BPM: etiqueta > caché > "?".
- [x] A2 · Motor de audio: si la canción trae ReplayGain, usarlo en vez de medir (`computeNormGain` solo si no hay).
- [x] A3 · Panel de carpetas: pestañas **Géneros** / **Artistas**; "Sin clasificar" primera; sin "Nueva carpeta". La lista muestra "Título · Artista".
- [x] A4 · Descargador: `--embed-metadata` (título/artista de YouTube) + comentario con el id del video (`youtube:<id>`) para trazabilidad.
- [x] A5 · `infiniity-dj --bpm-cli <archivo>`: BPM y duración desde la terminal (la skill lo usa cuando Deezer no da BPM).
- [x] A6 · Publicar.

**B. La skill `/Organizar_Canciones`** (`.claude/skills/Organizar_Canciones/`)
- [x] B1 · `SKILL.md`: el procedimiento semanal, el catálogo D14, reglas de mapeo de géneros, formato D6/D16, firma D15, dudosas D19, carpeta comodín D4/D17, mixes D8/D18, alias de artistas D22.
- [x] B2 · `scripts/identificar.py`: por cada archivo de Sin clasificar → limpia el nombre, consulta Deezer/iTunes/MusicBrainz, devuelve candidatos con confianza (JSON). Detecta mixes (>15 min o "mix/megamix/set").
- [x] B3 · `scripts/aplicar.py`: convierte a MP3 320k si hace falta, calcula ReplayGain (ffmpeg ebur128), BPM (Deezer o `--bpm-cli`), escribe etiquetas (mutagen), borra carátula, renombra y mueve. Idempotente: no toca lo ya firmado salvo que se pida.
- [x] B4 · `scripts/revision.py`: genera `.organizar/Revision-<fecha>.html` con reproductor por canción (dudosas y repetidas) y botón copiar respuestas.
- [x] B5 · Estado: `.organizar/estado.json` (géneros en espera con sus canciones, contadores de mixes por género, alias de artistas).
- [x] B6 · Prueba con copias de 5–10 canciones reales en una carpeta de prueba (nunca sobre la biblioteca).

**C. Primera corrida real** sobre "Sin clasificar" (148 canciones), con Camilo resolviendo dudosas.

---

## 9. Bitácora

- **2026-10-18** — Investigación: mutagen y ffprobe disponibles; APIs probadas (S2); 149 MP3 sin etiquetas. Ronda 1 entregada.
- **2026-10-18** — Ronda 1 respondida (D4–D13). Supuestos nuevos: carpeta comodín provisional "Otros" (nombre a confirmar en ronda 2); mix = archivo de más de 15 min o con "mix/megamix/set" en el nombre; conversión a MP3 320 kbps; la memoria de géneros "en espera" vive en `.organizar/pendientes-genero.json`. Ronda 2 entregada.
- **2026-10-18** — Ronda 2 respondida (D14–D22, incluida la petición del panel con dos modos). Sin ronda 3. Plan escrito; se empieza por A (la app) porque la skill depende de que la app lea etiquetas.
- **2026-10-18** — Construido. App 0.4.13 (lee etiquetas, panel Géneros/Artistas, ReplayGain, `--bpm-cli`, descargador con etiquetas) y 0.4.14 (duración real en el analizador: antes reportaba 120 s y la lista decía "2:00"). Skill en `.claude/skills/Organizar_Canciones/` con `comun.py`, `identificar.py`, `aplicar.py`, `revision.py`. Probada sobre copias de 6 canciones reales: 3 seguras quedaron etiquetadas/renombradas/movidas; 3 dudosas (género genérico "dance", choque Deezer-vs-artista en "Dardos", no reconocida por un "?") fueron a la página de revisión. Decidido sobre la marcha: cuando internet y el artista chocan, propone el artista pero pide confirmación; géneros genéricos ("dance", "latino", "pop") no cuentan como seguros; respaldo "Artista - Título" desde el nombre de YouTube; etiquetas en ID3 v2.3 (compatibilidad); ReplayGain con referencia -18 LUFS; TXXX:INFINIITY_ORGANIZADA como marca de "ya firmada". Cuestionarios HTML borrados.
- **2026-10-18 (primera corrida real)** — 149 canciones en Sin clasificar. 43 seguras solas (Claude corrigió 5 géneros mal etiquetados por internet y pasó 4 a dudosas). 106 dudosas: Claude dejó su recomendación pre-marcada en la página de revisión; Camilo aprobó todo, autorizó crear **Mexicana** (6) y **Carranga** (4) y borrar 1 repetida exacta. Resultado: 148 canciones en 17 carpetas, Sin clasificar vacía. Decidido sobre la marcha: `/.organizar` entra en `.stignore` (no viaja a las PC del equipo); dos emparejamientos de Deezer corregidos a mano (un karaoke y un riddim). La limpieza corrió con Sharon apagada: bajará lo nuevo al volver.
