# Plan: biblioteca sincronizada entre todas las PC (Sync)

Acordado el 2026-10-17. **Implementado el 2026-10-18 (versión 0.4.0)**; las
decisiones finas están en `.mega-cuestionario/Guía para Sync.md`. Código:
`src-tauri/src/sync.rs` (motor), `src/components/SyncModal.tsx` (panel),
`src/hooks/useSync.ts` (estado y freno por música), `src/components/Welcome.tsx`
(entrar con código). Diagnóstico sin ventana: `Infiniity-DJ.AppImage --sync-cli estado`.

## Qué se quiere

- Todas las PC del equipo usan **la misma biblioteca**. La original vive en el
  PC de Camilo (`~/Música`, hoy 911 MB / 492 canciones).
- El equipo **sí puede agregar** canciones (descargas de YouTube), porque ellos
  saben qué se usa en los eventos. Así la biblioteca crece desde cualquier PC.
- El equipo **no puede modificar** las carpetas ya clasificadas (mover,
  renombrar, borrar). El orden lo controla solo el PC original.
- En las PC del equipo **no se elige carpeta**: la app crea la suya
  (`~/Infiniity DJ/Biblioteca`), es la única biblioteca que existe para ellos y
  el botón "📁 Carpeta" desaparece. Nada de carpetas del PC ni USB.

## Cómo se haría

Con **Syncthing** (gratis, sin cuentas ni nube, PC a PC). Ya está instalado en
el PC original (`~/.local/bin/syncthing`, hoy apagado) y `~/Música` tiene un
`.stfolder` de un intento anterior.

Dos carpetas sincronizadas con reglas distintas:

| Carpeta | PC original | PC del equipo |
|---|---|---|
| **Biblioteca** (todas las carpetas clasificadas) | Solo envía | Solo reciben; cualquier cambio local se revierte solo |
| **Sin clasificar** (descargas de YouTube) | Recibe y envía | Reciben y envían |

Flujo: alguien baja una canción en un evento → cae en su "Sin clasificar" →
al tener internet sube al original y a los demás → Camilo la mueve a su carpeta
desde la app → sale de "Sin clasificar" y aparece clasificada en todas.

Decisiones tomadas:
- En "Sin clasificar" es de dos direcciones: si alguien borra una descarga, se
  borra en todas. Para que no duela: **papelera de 30 días en el PC original**
  (versionado de Syncthing), desde donde se recupera cualquier cosa.
- Técnicamente: "Sin clasificar" se excluye de la carpeta Biblioteca con
  `.stignore` y se comparte como carpeta aparte.
- También se sincroniza el **caché de BPM** para no re-analizar en cada PC.

## Qué hace la app

- **PC del equipo, primera vez**: en vez de "Elige tu carpeta", pide un
  **código de emparejamiento**. Crea la carpeta, empieza a recibir y muestra el
  avance ("312 de 492 canciones"). Sin botón Carpeta.
- **PC original**: sigue usando `~/Música` tal cual. Conserva el botón Carpeta.
  Genera los códigos (uno por PC) y ve la lista de PC conectadas y su último
  sync.
- Botón **Sync** arriba con estado: al día / sincronizando / sin conexión con
  el original.
- La app instala y configura Syncthing sola en cada PC, sin contraseñas (igual
  que hoy baja yt-dlp, Deno y ffmpeg a su carpeta), y lo maneja por su API
  REST local.
- PC que ya tienen la app con carpeta propia: al actualizar, piden el código
  una vez; la carpeta vieja queda en el disco sin usarse. Si tenían canciones
  que valen la pena, copiarlas a "Sin clasificar" para que suban.

## Cosas a tener en cuenta

- Syncthing sincroniza cuando ambas PC están encendidas con internet (misma
  red o por internet vía relés). Regla práctica: **encender la PC de evento con
  internet un rato antes de salir**.
- Primera copia completa a una PC nueva: minutos en la misma Wi-Fi, más por
  internet. Después solo viajan los cambios.
- Si en el PC original se borra algo por error, se borra en todas (de ahí la
  papelera de 30 días).

## Orden de trabajo propuesto

1. Rust: instalar/arrancar/parar Syncthing desde la app; leer estado por REST.
2. Pantalla de emparejamiento (equipo) y de códigos/PC conectadas (original).
3. Configurar las dos carpetas con sus modos; `.stignore`; versionado 30 días.
4. Quitar el selector de carpeta en el modo "equipo"; migración de PC viejas.
5. Caché de BPM sincronizado.
6. Probar entre este PC y una copia simulada antes de publicar; publicar por
   partes.
