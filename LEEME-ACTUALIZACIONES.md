# Instalar en varias PC y actualizarlas a todas

Cómo funciona: tú publicas una versión nueva desde este equipo con un comando.
Las demás PC, al abrir el programa, ven un aviso *"Hay una versión nueva"* y se
actualizan solas si el usuario acepta. Nunca se actualizan a la fuerza, para no
dejar a nadie esperando una descarga en pleno evento.

---

## 1. Publicar una versión nueva (lo haces tú, aquí)

```bash
cd "$HOME/Apps Zeven/Infiniity Dj Pro"
./publicar.sh 0.2.0 "Arreglado el vinilo que se trababa"
```

El número tiene que ser **más alto** que el anterior, o las PC no lo verán como
actualización. El texto entre comillas es lo que la gente lee en el aviso.

El script hace todo solo: pone el número de versión en los 3 archivos que lo
llevan, compila, firma y sube a GitHub. Tarda unos minutos.

## 2. Instalar en una PC nueva

Le pasas a la persona el archivo `instalar-en-pc-nueva.sh` y lo corre:

```bash
bash instalar-en-pc-nueva.sh
```

Baja la última versión, la instala con su ícono en el menú, y de ahí en adelante
esa PC ya queda enganchada a las actualizaciones. **Solo se hace una vez por PC.**

---

## ⚠️ La llave de firma: haz una copia YA

```
~/.tauri/infiniity-dj.key
```

Las PC solo aceptan actualizaciones firmadas con **esta** llave exacta. Es la
prueba de que la actualización viene de ti y no de un tercero.

**Si pierdes este archivo, no hay forma de recuperarlo.** No podrías volver a
actualizar ninguna PC ya instalada: tocaría ir una por una a reinstalar el
programa a mano con una llave nueva.

Guarda una copia en un USB o en tu gestor de contraseñas. **No la subas a
GitHub** — el repositorio es público, y cualquiera con esa llave podría publicar
una actualización falsa que se instalaría sola en todas las PC.

La llave `.pub` (la pública) sí va dentro del programa, esa no es secreta.

---

## Por qué se compila dentro de un contenedor

Este equipo es **Fedora 44**. Un programa compilado aquí exige `GLIBC_2.39`, y
eso deja fuera a **Linux Mint 21** (que trae glibc 2.35): ahí ni siquiera abre.
Mint 22 trae 2.39 exacto, o sea que funciona *de milagro*, sin margen.

Por eso `publicar.sh` compila dentro de un contenedor **Ubuntu 22.04**: el piso
baja a glibc 2.35 y el mismo archivo sirve para Mint 21, Mint 22 y Ubuntu.

> **No subas la versión de Ubuntu en el `Containerfile`** para "modernizar".
> Mientras más vieja la base, en más equipos corre el programa. Subirla solo
> deja PC afuera.

Si algún día quitas el contenedor y compilas directo en Fedora, funcionará en tu
equipo y en Mint 22 *por ahora* — y se romperá silenciosamente en todas las PC
cuando Fedora actualice sus librerías. No lo notarías hasta que alguien te
llame diciendo que el programa no abre.

## Detalles técnicos

- El formato es **AppImage**. Es el único que Tauri sabe actualizar solo en
  Linux; el `.deb` no se puede auto-actualizar.
- Mint 21+ ya no trae `libfuse2` y sin eso ningún AppImage abre.
  `instalar-en-pc-nueva.sh` lo detecta y lo instala.
- El programa revisa si hay actualización **3 segundos después de abrir**, para
  no competir con la carga de la biblioteca de música.
- Si no hay internet, no muestra ningún error: simplemente no revisa.
- El aviso vive en [`src/components/UpdateModal.tsx`](src/components/UpdateModal.tsx).
- La dirección que consultan las PC es el `latest.json` del último release:
  `https://github.com/Infiniity-Eventos/Infiniity-DJ-Pro/releases/latest/download/latest.json`

## ⚠️ Si publicas una version que no abre, esa PC queda atrapada

El aviso de actualizacion vive DENTRO del programa. Si una version no logra
dibujarse en algun equipo, ahi no se puede mostrar ningun aviso: esa PC se
queda clavada en la version rota para siempre, aunque publiques diez arreglos.

**La red de seguridad es reinstalar**, que baja siempre la ultima version:

```bash
curl -fsSL https://raw.githubusercontent.com/Infiniity-Eventos/Infiniity-DJ-Pro/actualizaciones-automaticas/instalar-en-pc-nueva.sh -o /tmp/i.sh && bash /tmp/i.sh
```

Guarda ese comando a mano (en notas de WhatsApp, por ejemplo). Es la solucion
universal para cualquier PC trabada, y evita tener que ir hasta el equipo.

Por eso conviene, antes de publicar algo grande, probar el AppImage en un
equipo distinto al tuyo. Lo que funciona en tu maquina puede morir en otra por
la tarjeta de video (nos paso: ver el historial de la v0.2.1).

### Al mandar comandos por WhatsApp

WhatsApp **se come los asteriscos** (los usa para poner negrita). Un comando con
`*` llega roto y la persona ejecuta algo distinto de lo que creias, sin que
ninguno de los dos se entere. Escribe los nombres de archivo completos en vez
de usar comodines.

## Si algo falla

| Síntoma | Causa casi siempre |
| --- | --- |
| Nadie ve la actualización | El número de versión no subió, o el release quedó como borrador |
| "Signature verification failed" | Se publicó firmado con otra llave |
| El AppImage no abre en Mint | Falta `libfuse2`, o se compiló fuera del contenedor |
| `publicar.sh` dice que ya existe | Ya publicaste ese número; usa el siguiente |
| Pantalla negra al abrir, con `EGL_BAD_PARAMETER` | El paquete se llevó librerías de video adentro. Lo resuelve `arreglar-appimage.sh`; si vuelve a pasar, revisa que ese script siga corriendo en `publicar.sh` |
| El descargador dice "no se pudo instalar" | Las herramientas del sistema heredaron las librerías del AppImage. Lo resuelve `clean_command()` en `downloader.rs` |

## ⚠️ Cuidado con los emojis de color

En Fedora 44, mostrar el emoji de fiesta estrellaba el proceso que dibuja la
ventana y la dejaba **en blanco**:

```
colrv1_configure_skpaint(...) Assertion '__n < this->size()' failed
```

Causa: el AppImage lleva dentro su propio WebKit (Ubuntu 22.04, 85 MB), más
viejo que la fuente `Noto-COLRv1.ttf` del sistema. Al pintar glifos de color con
degradados se sale de rango y aborta.

Los símbolos simples (⬆ ✅ ⚠ ⬇ 🌙 📁) funcionan bien; los emojis elaborados con
degradados, no. **Ante la duda, texto.**

> Se intentó la solución de fondo —quitar el WebKit empaquetado para usar el del
> sistema— y NO funciona: el WebKit de Fedora choca entonces con el GStreamer
> viejo que también viaja dentro. Habría que ir arrancando media docena de
> librerías, con riesgo de romper los equipos con Mint. Queda pendiente.

**Lo peor de este fallo:** el aviso que se dibuja es el de la versión INSTALADA,
así que un equipo con una versión que se estrella al mostrar el aviso no puede
actualizarse solo. Hay que reinstalar por comando una vez.
