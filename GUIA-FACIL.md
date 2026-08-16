# 🎧 Cómo instalar Infiniity DJ — Guía fácil

> Para alguien que **nunca ha usado Linux**. No hay que entender nada:
> solo copiar, pegar y esperar.
> Esta guía sirve para computadoras con **Fedora** (40, 41, 42, 43 y 44).

---

## Antes de empezar

Necesitas 3 cosas:

1. **Internet** en esa computadora (solo durante la instalación; después el programa
   funciona sin internet).
2. La **clave** de la computadora (la misma con la que inicias sesión).
3. **Media hora** de tranquilidad. La mayor parte del tiempo es solo esperar.

---

## PASO 1 — Abrir la terminal

La "terminal" es una ventana negra donde se escriben comandos. Se abre así:

1. Aprieta la **tecla de Windows** (la que tiene el logo, abajo a la izquierda del teclado).
2. Escribe la palabra **terminal**.
3. Dale **Enter**.

Se abre una ventana con texto. Esa es la terminal. Déjala abierta.

> 💡 Si aparece una ventana negra con letras, vas bien.

---

## PASO 2 — Copiar y pegar el comando

Copia **todo** el bloque de abajo (desde `cd ~` hasta el final), pégalo en la terminal
y dale **Enter**.

```bash
cd ~ && \
rm -rf ~/infiniity-dj-instalador && \
sudo dnf install -y git && \
git clone https://github.com/Infiniity-Eventos/Infiniity-DJ-Pro.git ~/infiniity-dj-instalador && \
cd ~/infiniity-dj-instalador && \
git checkout claude/fedora-44-installation-qkv6pm && \
chmod +x scripts/instalar-fedora.sh && \
./scripts/instalar-fedora.sh
```

> 💡 **Para pegar en la terminal** se usa `Ctrl + Shift + V` (con la tecla Shift),
> o clic derecho → Pegar. El `Ctrl + V` normal a veces no funciona ahí.

---

## PASO 3 — Escribir la clave

Casi de inmediato va a aparecer algo así:

```
[sudo] password for usuario:
```

Escribe la **clave de la computadora** y dale **Enter**.

> ⚠️ **Mientras escribes la clave no se ve nada**: ni puntitos, ni asteriscos, nada.
> **Es normal, no está dañado.** Escríbela igual y dale Enter.

---

## PASO 4 — Esperar

Ahora la computadora va a trabajar sola. Vas a ver **muchísimo texto pasando rápido**,
con palabras en verde, amarillo y a veces avisos. **Todo eso es normal.**

- Tarda entre **5 y 15 minutos** (en computadoras lentas puede ser hasta 25).
- **No cierres la ventana.** No toques nada. Puedes dejarla y volver.
- Si en algún momento pregunta algo y no sabes qué responder, dale **Enter**.

Cuando termine bien, aparece un mensaje verde grande que dice:

```
==============================================
 LISTO. Infiniity DJ quedó instalado.
==============================================
```

Cuando veas eso, ya está. Puedes cerrar la terminal.

---

## PASO 5 — Abrir el programa

1. Aprieta la **tecla de Windows**.
2. Escribe **infiniity**.
3. Le das clic al ícono de **Infiniity DJ**.

> 💡 Si no aparece en el menú: reinicia la computadora y busca otra vez.

---

## PASO 6 — La primera vez que se abre

El programa te va a pedir que elijas **la carpeta donde está la música**.

- Busca la carpeta donde están los MP3 y dale **Aceptar / Abrir**.
- Eso se hace **una sola vez**. Después el programa la recuerda.
- Si te equivocaste, se cambia con el botón **📁 Carpeta** de arriba.

Ya está: el programa está listo para usarse. 🎉

---

# 🆘 Si algo sale mal

Busca en esta lista lo que te salió:

### ➤ "No se ve nada cuando escribo la clave"
Es normal, Linux funciona así por seguridad. Escríbela igual y dale Enter.

### ➤ Sale un error que menciona `fuse` o `libfuse.so.2`
Copia y pega esto, y vuelve a abrir el programa:
```bash
sudo dnf install -y fuse fuse-libs
```

### ➤ Sale `cargo: command not found` o `command not found`
Cierra la terminal, abre una nueva y **vuelve a pegar el comando del Paso 2**.

### ➤ Se cortó el internet a mitad
No pasa nada. Conecta el internet otra vez y **vuelve a pegar el comando del Paso 2**.
Empieza de nuevo sin dañar nada.

### ➤ Sale `no space left on device` (no hay espacio)
Se llenó el disco. Copia y pega esto para liberar espacio:
```bash
rm -rf ~/infiniity-dj-instalador/src-tauri/target
```
Después borra archivos que no uses (videos, descargas viejas) y vuelve al Paso 2.

### ➤ El programa está instalado pero no se escucha nada
Ve a **Configuración → Sonido** y revisa que la salida elegida sea la correcta
(los parlantes o la consola conectada).

### ➤ No detecta la controladora DDJ-200
Conéctala por USB **antes** de abrir el programa, y una vez adentro dale al
botón **DDJ-200** de arriba a la derecha (se debe poner verde).

### ➤ Cualquier otra cosa
Sácale una **foto a la pantalla** con el error y mándasela a Stiven.
No intentes arreglarlo adivinando.

---

# 🔄 Otras cosas útiles

### Actualizar a una versión nueva del programa
Pega **el mismo comando del Paso 2**. Se actualiza solo.

### Instalarlo en OTRA computadora sin esperar los 15 minutos

En la computadora donde ya funciona, pega esto. Te deja el programa en un solo archivo
dentro de tu **Carpeta personal** (la que se abre al hacer clic en "Archivos"):
```bash
cp ~/.local/bin/infiniity-dj.AppImage ~/
```
Pasa ese archivo `infiniity-dj.AppImage` por USB a la otra computadora, ponlo también en
su Carpeta personal, y allá pega esto:
```bash
sudo dnf install -y fuse fuse-libs && \
mkdir -p ~/.local/bin && \
cp ~/infiniity-dj.AppImage ~/.local/bin/ && \
chmod +x ~/.local/bin/infiniity-dj.AppImage && \
~/.local/bin/infiniity-dj.AppImage
```
Eso tarda **menos de un minuto**, no hace falta compilar nada.

### Desinstalar el programa
```bash
rm -f ~/.local/bin/infiniity-dj.AppImage ~/.local/bin/infiniity-dj
rm -f ~/.local/share/applications/infiniity-dj.desktop
rm -rf ~/infiniity-dj-instalador
```
La música **no se borra**, queda intacta en su carpeta.

### Liberar espacio después de instalar (opcional)
Cuando ya compruebes que el programa abre bien, puedes borrar los archivos temporales
de la instalación (ocupan como 2 GB):
```bash
rm -rf ~/infiniity-dj-instalador
```
El programa sigue funcionando igual.

---

Hecho con cariño para Infiniity Eventos 💜
