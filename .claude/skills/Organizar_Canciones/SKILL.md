---
name: Organizar_Canciones
description: Organiza SEMANALMENTE la biblioteca de Infiniity DJ en el PC original. Toma lo que haya en "Sin clasificar", identifica cada canción por internet (Deezer, iTunes), escribe TODOS los metadatos dentro del MP3 (título, artista con colaboradores, género, BPM, año, ISRC, ReplayGain, firma "Creado por Infiniity Eventos"), la renombra "Nombre De La Cancion - Artista x Colab1 x Colab2.mp3" y la mueve a su carpeta de género (catálogo colombianizado). Lo seguro lo hace sola; lo dudoso y las repetidas te las lista en el chat con una página para escucharlas con un clic. Úsala cuando el usuario diga "/Organizar_Canciones", "organiza las canciones", "clasifica lo de Sin clasificar", "pon los metadatos", "ordena la biblioteca", o cada semana como rutina.
---

# /Organizar_Canciones

Diseño completo y decisiones (D1–D22) en `.mega-cuestionario/Guía para Organizar_Canciones.md`.
Léela si algo de aquí no cuadra: **la guía manda**.

## Dónde corre y sobre qué

- **Solo en el PC original** (el de Camilo, Fedora). Biblioteca: `~/Música/Infiniity Dj Pro`.
  Verifica el rol antes de tocar nada: `~/Applications/Infiniity-DJ.AppImage --sync-cli estado`
  debe decir `"rol": "original"`. Si no, **párate**: en una PC del equipo todo cambio se revierte.
- Trabaja sobre `~/Música/Infiniity Dj Pro/Sin clasificar`. **Nunca** toca lo que ya está en
  carpetas de género salvo que el usuario lo pida explícitamente (entonces `--forzar`).
- Sync reenvía cada archivo etiquetado a las demás PC (aceptado, D10). Avísalo en el resumen.

## Catálogo de carpetas (D14) — "colombianizado", muy por encima

`Merengue · Salsa · Salsa Choque · Bachata · Vallenato · Reggaeton · Champeta · Boleros ·
Viejoteca · Cumbia · Pop · Rock · Electronica · Crossover · Trap · Hora Loca · Mexicana · Carranga` y la comodín `Otros`.
(Mexicana y Carranga se crearon el 2026-10-18 al juntar 6 y 4 canciones.)

Reglas de criterio (tú decides cuando el script dice `genero_seguro: false` o `?`):
- Nada de subgéneros: "Trap Dark", "Trap Soul", "Drill" → **Trap**. "Rap/hip hop" latino → Trap.
- "Urbano latino", "dembow", "perreo" → **Reggaeton**.
- "Música tropical" / "tropical" / artistas viejos (Pastor López, Rodolfo Aicardi, Los Hispanos,
  Joselito, Sonora Dinamita antigua, Aniceto Molina, baladas de los 70–90) → **Viejoteca**, salvo
  que sea claramente cumbia moderna o salsa.
- Novedades/temas de animación (Gangnam Style, Macarena, Payaso de Rodeo, Waka Waka, El Meneaito,
  Chicken Dance, Caballo Dorado, cumpleaños, Navidad) → **Hora Loca**.
- Mezclas de géneros/crossover de fiesta sin género claro → **Crossover**.
- Lo que de verdad no encaje → **Otros**, anotando `genero_sugerido` (lo que creas que es): cuando
  tres canciones esperen el mismo género sugerido, propones crear la carpeta y moverlas (D4/D17).
- Si internet y el artista **chocan**, suele mandar el artista (Deezer etiqueta álbumes raro), pero
  **pregunta**.
- **Mixes** (> 15 min o "mix/megamix/set/enganchado" en el nombre): van a la carpeta de su género con
  nombre `Mix Infiniity <Género> NN` (lo pone `aplicar.py`), artista "Infiniity Eventos" (D8/D18).

## Procedimiento (cada corrida)

Scripts en `scripts/` (Python 3 + mutagen + ffmpeg; el BPM local lo da el AppImage con `--bpm-cli`).
`BIB="$HOME/Música/Infiniity Dj Pro"`; carpeta de trabajo `$BIB/.organizar/` (oculta: la app y Sync
la ignoran… Sync NO la ignora: es pequeña, no importa).

1. **Identificar** (no toca archivos; tarda ~2 s por canción, internet):
   ```bash
   python3 -I .claude/skills/Organizar_Canciones/scripts/identificar.py "$BIB/Sin clasificar" --biblioteca "$BIB" --salida "$BIB/.organizar/candidatos-$(date +%F).json"
   ```
   Si hay más de ~60 canciones, dilo y hazlo igual (avisa del tiempo).
2. **Leer el JSON y armar el plan** (`plan-<fecha>.json`, formato en la cabecera de `aplicar.py`):
   - **Seguras** → al plan sin preguntar: `confianza >= 0.75` **y** `genero_seguro: true` **y**
     `deezer` presente **y** sin `repetida_de`. Título/artistas de Deezer (`titulo`, `colaboradores`),
     `fecha`, `isrc`, `bpm`, `youtube_id`, `genero = genero_propuesto`.
   - **Dudosas** (todo lo demás, incluidos mixes y repetidas): NO van al plan todavía. Para las que
     internet no reconoció usa `desde_nombre` (artista/título del propio nombre de YouTube) como
     propuesta.
   - Un título o artista que Deezer devuelva en otro idioma/forma rara: usa tu criterio; el script
     deja Cada Palabra Con Mayúscula y sin tildes (D16), tú no tienes que hacerlo.
3. **Aplicar las seguras**, primero simulado y mirando que las rutas tengan sentido:
   ```bash
   python3 -I .claude/skills/Organizar_Canciones/scripts/aplicar.py "$BIB/.organizar/plan-<fecha>.json" --biblioteca "$BIB" --simular
   python3 -I .claude/skills/Organizar_Canciones/scripts/aplicar.py "$BIB/.organizar/plan-<fecha>.json" --biblioteca "$BIB"
   ```
   Convierte a MP3 lo que no lo sea, escribe etiquetas (borra carátula, firma los campos vacíos),
   ReplayGain, BPM si falta y **copia** la versión organizada a su carpeta; la original queda en
   "Sin clasificar" **a propósito** (fase 1): así las PC del equipo arman la copia nueva a partir
   de la vieja sin volver a bajar ~5 MB por canción. Las ya firmadas se saltan.
   **Fase 2 — limpiar, EN LA MISMA CORRIDA**: espera a que las PC **conectadas** lleguen al 100 %
   (tope 20 min) y borra las originales. Las PC apagadas **no cuentan**: bajarán lo nuevo cuando
   vuelvan; nada queda duplicado "por culpa" de una PC apagada.
   ```bash
   python3 -I .claude/skills/Organizar_Canciones/scripts/aplicar.py /dev/null --biblioteca "$BIB" --limpiar --esperar 20
   ```
   Corre esto después de aplicar las seguras Y otra vez después de aplicar las dudosas (paso 4).
   "/Organizar_Canciones limpiar" corre solo esta orden (por si una vez quedó pendiente).
4. **Dudosas y repetidas** (D19): genera la página y ábrela:
   ```bash
   python3 -I .claude/skills/Organizar_Canciones/scripts/revision.py "$BIB/.organizar/candidatos-<fecha>.json" --salida "$BIB/.organizar/Revision-<fecha>.html" && xdg-open "$BIB/.organizar/Revision-<fecha>.html"
   ```
   En el chat, además, pon la **lista numerada** (mismo orden que la página) con lo que internet
   cree, tu recomendación y por qué. Para repetidas: di de cuál parece repetida y si puede ser un
   remix (duración distinta, "remix" en el nombre) — los remixes **no** son repetidas (D12).
   Espera la respuesta ("1 salsa, 2 borrar, 3 dejar · es un remix…"). Con ella, arma un segundo
   plan y aplícalo (`Borrar` = `rm` del archivo, avisando; `Dejar` = no tocar).
5. **Géneros en espera** (D4/D17): si `aplicar.py` reporta un género con 3+ canciones en `Otros`,
   propón crear la carpeta; si el usuario dice sí, crea la carpeta, mueve esas canciones, reescribe
   `TCON` y quita `INFINIITY_GENERO_SUGERIDO` (usa `aplicar.py --forzar` con un plan de esas
   canciones y el género nuevo), y bórralas de `en_espera` en `estado.json`.
6. **Resumen final** en el chat (y si quedaron originales por borrar, decirlo): cuántas organizadas por carpeta, cuántas quedaron en Sin clasificar
   y por qué, repetidas resueltas, carpetas nuevas, y recordar que Sync reenviará los archivos.
   Luego, en la app, "Actualizar lista" muestra todo con BPM y artista (la app lee las etiquetas).

## Reglas que no se negocian

- **Ninguna canción queda con artista "Desconocido".** Si Deezer no la reconoce: prueba variantes
  de búsqueda (sin signos, "Título Artista", solo el título), compara la **duración** del archivo
  con la de los candidatos (±5 s = la misma), y busca en la web ("<título> canción" / "quién canta
  <título>"). Solo un mix o un beat instrumental sin autor lleva "Infiniity Eventos". Si de verdad
  no aparece, pregunta al usuario (él suele saberlo) antes de aplicar.

- **La duración manda sobre el nombre.** Si `duracion_coincide` es `false`, internet encontró OTRA
  canción con el mismo título (pasó con "Abusadora": Deezer dio Wisin & Yandel 3:00, el archivo era
  el merengue de Oro Sólido 4:39). No la recomiendes así: busca "<título> <artista de iTunes>" o en la
  web hasta que la duración cuadre (±8 s), y en la lista del chat dilo explícito.
- **Nunca** correr sobre la biblioteca sin el `--simular` previo del paso 3.
- **Nunca** borrar una canción sin que el usuario lo haya dicho para ESA canción.
- Si `identificar.py` falla por internet (muchos `AVISO:`), no inventes: repite más tarde.
- Un artista = una sola forma escrita (D22): `comun.artista_canonico` lo garantiza con
  `estado.json → alias_artistas`. Si ves dos formas para el mismo artista en la biblioteca
  (`--lib-cli` o pestaña Artistas de la app), corrige el alias y re-etiqueta con `--forzar`.
- Las carpetas las crea **esta skill** (o Camilo con el explorador). La app ya no tiene "Nueva carpeta".

## Diagnóstico rápido

- Qué ve la app de una carpeta: `~/Applications/Infiniity-DJ.AppImage --lib-cli "<carpeta>"`.
- BPM y duración de un archivo: `~/Applications/Infiniity-DJ.AppImage --bpm-cli "<archivo>"`.
- Etiquetas de un archivo: `python3 -c "from mutagen.id3 import ID3; print(ID3('<archivo>').pprint())"`.
