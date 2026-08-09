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

## Si algo falla

| Síntoma | Causa casi siempre |
| --- | --- |
| Nadie ve la actualización | El número de versión no subió, o el release quedó como borrador |
| "Signature verification failed" | Se publicó firmado con otra llave |
| El AppImage no abre en Mint | Falta `libfuse2`, o se compiló fuera del contenedor |
| `publicar.sh` dice que ya existe | Ya publicaste ese número; usa el siguiente |
