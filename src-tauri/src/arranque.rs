//! Decisiones que hay que tomar ANTES de abrir la ventana, porque GTK/WebKit
//! leen las variables de entorno una sola vez al arrancar.
//!
//! 1. Esconder las fuentes de emojis de color (tumban el motor de dibujo).
//! 2. Decidir si el motor web dibuja con la tarjeta grafica (GPU) o por
//!    software, con una red de seguridad para que ninguna PC quede tirada.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

/// Carpeta propia para marcas y archivos de arranque (~/.cache/infiniity-dj).
pub(crate) fn dir_cache() -> PathBuf {
    let base = std::env::var_os("XDG_CACHE_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".cache")))
        .unwrap_or_else(std::env::temp_dir);
    base.join("infiniity-dj")
}

/// Donde queda apuntada la ultima salida de audio elegida.
const MARCA_SALIDA: &str = "salida-elegida";

/// Apunta la salida elegida para el proximo arranque.
pub fn recordar_salida(sink: &str) {
    let dir = dir_cache();
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    if let Err(e) = std::fs::write(dir.join(MARCA_SALIDA), sink) {
        eprintln!("[arranque] no se pudo apuntar la salida elegida: {e}");
    }
}

/// ¿El programa arranco preparado para una cabina Bluetooth?
pub fn sonido_preparado_para_bluetooth() -> bool {
    std::env::var("PULSE_LATENCY_MSEC").is_ok()
}

/// Prepara el sonido ANTES de abrir la ventana, segun donde vaya a sonar.
///
/// POR QUE: el navegador interno le pide al sistema trozos de sonido de unos
/// 60 ms (medido: `tlength = 21168`). Con cable va de sobra. Una cabina
/// BLUETOOTH trabaja mucho mas lento, y un flujo que no llega a tiempo no
/// suena bajito: aporta SILENCIO a la mezcla. Eso cuadra con lo medido en un
/// evento, donde el motor sacaba sonido (-14.4 dB) y por la cabina no llegaba
/// nada (pico 0.00000) con todo lo demas en orden.
///
/// El tamaño de esos trozos se decide cuando el navegador interno abre su
/// conexion con el sonido, y NO se puede cambiar con el programa ya abierto:
/// por eso se hace aqui, al arrancar, y por eso hay que saber de antemano a
/// donde va a sonar (lo apunta `recordar_salida`).
///
/// Solo se agranda si la ultima salida elegida era Bluetooth: agrandarlo
/// siempre le meteria ese retardo tambien a quien va por cable, donde hoy
/// funciona bien.
pub fn preparar_sonido() {
    let elegida = std::fs::read_to_string(dir_cache().join(MARCA_SALIDA)).unwrap_or_default();
    let elegida = elegida.trim().to_lowercase();
    if !(elegida.starts_with("bluez") || elegida.contains("bluetooth")) {
        return;
    }
    // 250 ms: por encima de lo que suele costar el camino Bluetooth, y todavia
    // razonable para mezclar en vivo (el propio Bluetooth ya añade lo suyo).
    std::env::set_var("PULSE_LATENCY_MSEC", "250");
    eprintln!("[arranque] salida Bluetooth apuntada: sonido en trozos de 250 ms");
}

// ---------------------------------------------------------------------------
// Fuentes de emojis
// ---------------------------------------------------------------------------

/// Esconde las fuentes de emojis DE COLOR del sistema antes de abrir la ventana.
///
/// POR QUE: el WebKit que viaja en el AppImage (Ubuntu 22.04) revienta al pintar
/// emojis de una fuente COLRv1 (`colrv1_configure_skpaint ... Assertion failed`)
/// y la ventana queda en blanco. Fedora 44 paso "Noto Color Emoji" a COLRv1 en
/// septiembre de 2026 y desde ese dia la app se caia AL ABRIR, porque la barra de
/// arriba ya trae 📁 🌙 🔄. Cualquier distro que actualice su fuente caeria igual.
///
/// Con esto fontconfig carga la configuracion normal del equipo y solo descarta
/// las fuentes de color; los emojis salen de la fuente monocroma (la incluida en
/// el programa, ver "Emoji Seguro" en global.css), que no pasa por ese codigo.
pub fn ocultar_fuentes_emoji_color() {
    const SISTEMA: &str = "/etc/fonts/fonts.conf";
    if std::env::var_os("FONTCONFIG_FILE").is_some() || !Path::new(SISTEMA).exists() {
        return;
    }
    let dir = dir_cache();
    let ruta = dir.join("fonts.conf");
    let conf = format!(
        "<?xml version=\"1.0\"?>\n<!DOCTYPE fontconfig SYSTEM \"fonts.dtd\">\n<fontconfig>\n  \
         <include ignore_missing=\"yes\">{SISTEMA}</include>\n  \
         <selectfont><rejectfont><pattern><patelt name=\"color\"><bool>true</bool></patelt></pattern></rejectfont></selectfont>\n\
         </fontconfig>\n"
    );
    match std::fs::create_dir_all(&dir).and_then(|_| std::fs::write(&ruta, conf)) {
        Ok(()) => std::env::set_var("FONTCONFIG_FILE", &ruta),
        // Todavia no hay ventana donde mostrarlo: queda en la terminal / journalctl.
        Err(e) => eprintln!(
            "AVISO: no se pudo escribir {} ({e}). Los emojis de color pueden tumbar la ventana.",
            ruta.display()
        ),
    }
}

// ---------------------------------------------------------------------------
// GPU o software
// ---------------------------------------------------------------------------

/// Como quedo dibujando el motor web en este arranque, y por que.
#[derive(Clone, Copy, serde::Serialize)]
pub struct ModoDibujo {
    pub software: bool,
    pub motivo: &'static str,
}

static MODO: OnceLock<ModoDibujo> = OnceLock::new();

const VAR_WEBKIT: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";
/// Existe mientras dura un arranque CON GPU que todavia no llego a la interfaz.
const MARCA_PROBANDO: &str = "gpu-probando";
/// Existe cuando un arranque con GPU fallo: desde entonces, software.
const MARCA_PROHIBIDA: &str = "gpu-prohibida";
/// Pasado este tiempo se vuelve a intentar la GPU (el equipo pudo cambiar de
/// driver o de tarjeta). Y sirve de escape si la marca se puso por error.
const REINTENTAR_GPU_CADA: Duration = Duration::from_secs(30 * 24 * 3600);

fn hay_nvidia() -> bool {
    Path::new("/proc/driver/nvidia").exists() || Path::new("/sys/module/nvidia").exists()
}

/// Decide si el motor web puede usar la tarjeta grafica.
///
/// POR QUE: durante meses el acceso directo ponia WEBKIT_DISABLE_DMABUF_RENDERER=1
/// en TODAS las PC. Esa variable hace falta en el PC de desarrollo (Wayland +
/// NVIDIA, donde WebKit se cae sin ella), pero en los portatiles de eventos
/// (X11 + Intel) solo sirve para prohibirles la GPU: el desenfoque, el disco
/// giratorio y cada repintado los hacia la CPU, y reproduciendo se iba al 186%
/// en el i5-6300U. Ahora la decision la toma el programa, no el acceso directo:
///
/// - NVIDIA presente           -> software (la variable). Es el caso conocido.
/// - marca "gpu-prohibida"     -> software, hasta que caduque (30 dias).
/// - marca "gpu-probando" viva -> el arranque anterior con GPU NO llego a la
///   interfaz (se cayo antes): se escribe "gpu-prohibida" y va por software.
/// - si no                     -> GPU. Se deja "gpu-probando" y la interfaz la
///   borra al estar lista (`interfaz_lista`). Si ademas el proceso web se cae
///   ya con la ventana abierta, `vigilar_motor_web` marca y reinicia.
///
/// La variable puesta desde fuera se ignora a proposito: los accesos directos
/// viejos la traen y seguirian castigando a los portatiles. Para forzar
/// software a mano: `touch ~/.cache/infiniity-dj/gpu-prohibida`.
pub fn decidir_modo_dibujo() {
    let dir = dir_cache();
    let probando = dir.join(MARCA_PROBANDO);
    let prohibida = dir.join(MARCA_PROHIBIDA);

    // INFINIITY_DJ_PROBAR_GPU=1 salta SOLO la regla de NVIDIA, para probar la GPU
    // a proposito (y verificar la red de seguridad). Una marca de caida sigue
    // mandando; para volver a intentar hay que borrarla a mano.
    let probar_gpu = std::env::var_os("INFINIITY_DJ_PROBAR_GPU").is_some();

    let modo = if hay_nvidia() && !probar_gpu {
        ModoDibujo { software: true, motivo: "nvidia" }
    } else if marca_vigente(&prohibida) {
        ModoDibujo { software: true, motivo: "gpu-prohibida" }
    } else if probando.exists() {
        // El arranque anterior con GPU murio antes de mostrar la interfaz.
        if let Err(e) = std::fs::write(&prohibida, "el arranque anterior con GPU no llego a abrir la ventana\n") {
            eprintln!("AVISO: no se pudo escribir {} ({e})", prohibida.display());
        }
        ModoDibujo { software: true, motivo: "gpu-fallo-al-abrir" }
    } else {
        match std::fs::create_dir_all(&dir).and_then(|_| std::fs::write(&probando, "")) {
            Ok(()) => ModoDibujo { software: false, motivo: "gpu" },
            Err(e) => {
                // Sin marca no hay red de seguridad: mejor no arriesgar la GPU.
                eprintln!("AVISO: no se pudo escribir {} ({e}); se dibuja por software.", probando.display());
                ModoDibujo { software: true, motivo: "sin-marca" }
            }
        }
    };

    if modo.software {
        std::env::set_var(VAR_WEBKIT, "1");
    } else {
        std::env::remove_var(VAR_WEBKIT);
    }
    eprintln!("Infiniity DJ: dibujo por {} ({})", if modo.software { "software" } else { "GPU" }, modo.motivo);
    let _ = MODO.set(modo);
}

fn marca_vigente(ruta: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(ruta) else { return false };
    let caducada = meta
        .modified()
        .ok()
        .and_then(|t| t.elapsed().ok())
        .map(|edad| edad > REINTENTAR_GPU_CADA)
        .unwrap_or(false);
    if caducada {
        eprintln!("Infiniity DJ: la marca gpu-prohibida caduco; se vuelve a probar la GPU.");
        let _ = std::fs::remove_file(ruta);
        return false;
    }
    true
}

pub fn modo_dibujo() -> ModoDibujo {
    *MODO.get().unwrap_or(&ModoDibujo { software: true, motivo: "sin-decidir" })
}

/// La interfaz ya se dibujo: el arranque con GPU salio bien.
pub fn interfaz_lista() {
    let probando = dir_cache().join(MARCA_PROBANDO);
    if probando.exists() {
        if let Err(e) = std::fs::remove_file(&probando) {
            eprintln!("AVISO: no se pudo borrar {} ({e}); el proximo arranque ira por software.", probando.display());
        }
    }
}

/// Si el proceso que dibuja se cae con la ventana ya abierta:
/// - en modo GPU: casi seguro es la GPU. Se marca "gpu-prohibida" y se reinicia
///   el programa solo (vuelve en segundos, ya por software).
/// - en modo software: no es la GPU. Se avisa en pantalla con un dialogo nativo
///   (la ventana web ya no sirve) para que lo cierren y lo vuelvan a abrir.
pub fn vigilar_motor_web(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Some(ventana) = app.webview_windows().values().next().cloned() else {
        eprintln!("AVISO: no hay ventana que vigilar");
        return;
    };
    let app = app.clone();
    let res = ventana.with_webview(move |wv| {
        use webkit2gtk::WebViewExt;
        let app = app.clone();
        wv.inner().connect_web_process_terminated(move |_, motivo| {
            eprintln!("ERROR: el proceso web termino ({motivo:?})");
            let modo = modo_dibujo();
            if !modo.software {
                let prohibida = dir_cache().join(MARCA_PROHIBIDA);
                if let Err(e) = std::fs::write(&prohibida, format!("el proceso web se cayo dibujando con GPU: {motivo:?}\n")) {
                    eprintln!("AVISO: no se pudo escribir {} ({e})", prohibida.display());
                }
                eprintln!("Infiniity DJ: reiniciando por software...");
                app.restart();
            }
            use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
            app.dialog()
                .message(format!(
                    "El motor de dibujo se cerro ({motivo:?}).\n\nCierra Infiniity DJ y vuelve a abrirlo. Si se repite, avisa y manda el archivo de diagnostico."
                ))
                .title("Infiniity DJ")
                .kind(MessageDialogKind::Error)
                .show(|_| {});
        });
    });
    if let Err(e) = res {
        eprintln!("AVISO: no se pudo vigilar el motor web ({e})");
    }
}

// ---------------------------------------------------------------------------
// Acceso directo del menu (icono y .desktop)
// ---------------------------------------------------------------------------

/// Vuelve a copiar el icono y a reescribir el .desktop si el AppImage cambio.
///
/// POR QUE: `instalar-en-pc-nueva.sh` copia el icono a ~/.local/share/icons y
/// escribe el .desktop UNA SOLA VEZ, el dia que se instala. El actualizador
/// automatico solo reemplaza el AppImage, asi que el menu de Linux se queda
/// para siempre con lo que habia ese dia. Costo dos cosas:
///
///   - El icono nuevo (Jimbo, 0.4.31) no llego a NINGUNA PC: todas siguen
///     mostrando el vinilo de agosto aunque el programa este al dia.
///   - Peor: los .desktop escritos antes de la 0.3.6 llevan
///     "env WEBKIT_DISABLE_DMABUF_RENDERER=1" en el Exec. Esa variable prohibe
///     la tarjeta grafica y deja la CPU al 186% reproduciendo en los portatiles
///     Intel. Se quito del instalador, pero las PC ya instaladas la siguen
///     arrastrando porque nadie les reescribio el acceso directo.
///
/// Por eso ahora el propio programa lo refresca al arrancar, en segundo plano.
///
/// Solo toca lo que YA existe: si no hay .desktop, esta PC no se instalo con el
/// guion (alguien corre el AppImage suelto) y no le creamos nada en el menu.
pub fn refrescar_acceso_directo() {
    std::thread::spawn(|| {
        if let Err(e) = refrescar() {
            // No es fatal: la app funciona igual, solo se ve el icono viejo.
            eprintln!("AVISO: no se pudo refrescar el acceso directo del menu ({e})");
        }
    });
}

fn refrescar() -> Result<(), String> {
    // APPDIR solo existe dentro del AppImage: es la carpeta donde se monta.
    let appdir = match std::env::var_os("APPDIR") {
        Some(d) => PathBuf::from(d),
        None => return Ok(()), // en desarrollo no hay nada que refrescar
    };
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or("no hay HOME")?;
    let escritorio = home.join(".local/share/applications/infiniity-dj.desktop");
    if !escritorio.exists() {
        return Ok(()); // AppImage suelto, sin instalar: no tocamos el menu
    }

    let mut cambio = false;
    let iconos = home.join(".local/share/icons/hicolor");

    // El AppImage trae varios tamanos; los copiamos todos (el instalador solo
    // copiaba el de 128 y en el menu de Mint se veia escalado).
    let origen = appdir.join("usr/share/icons/hicolor");
    let dirs = std::fs::read_dir(&origen)
        .map_err(|e| format!("no se pudo leer {} ({e})", origen.display()))?;
    for medida in dirs.flatten() {
        let icono = medida.path().join("apps/infiniity-dj.png");
        if !icono.is_file() {
            continue;
        }
        let destino = iconos
            .join(medida.file_name())
            .join("apps/infiniity-dj.png");
        let nuevo = std::fs::read(&icono)
            .map_err(|e| format!("no se pudo leer {} ({e})", icono.display()))?;
        if std::fs::read(&destino).ok().as_deref() == Some(&nuevo[..]) {
            continue; // ya esta al dia
        }
        if let Some(padre) = destino.parent() {
            std::fs::create_dir_all(padre)
                .map_err(|e| format!("no se pudo crear {} ({e})", padre.display()))?;
        }
        std::fs::write(&destino, &nuevo)
            .map_err(|e| format!("no se pudo escribir {} ({e})", destino.display()))?;
        cambio = true;
    }

    // El .desktop se reescribe con la ruta real del AppImage que esta corriendo.
    // Tiene que quedar IGUAL que el que escribe instalar-en-pc-nueva.sh.
    if let Some(ruta) = std::env::var_os("APPIMAGE") {
        let texto = format!(
            "[Desktop Entry]\n\
             Type=Application\n\
             Name=Infiniity DJ\n\
             Comment=Mezclador de musica para eventos\n\
             Exec=\"{}\"\n\
             Icon=infiniity-dj\n\
             Terminal=false\n\
             Categories=Audio;Music;AudioVideo;\n\
             StartupWMClass=Infiniity DJ\n",
            PathBuf::from(ruta).display()
        );
        if std::fs::read_to_string(&escritorio).ok().as_deref() != Some(texto.as_str()) {
            std::fs::write(&escritorio, &texto)
                .map_err(|e| format!("no se pudo escribir {} ({e})", escritorio.display()))?;
            cambio = true;
        }
    }

    if !cambio {
        return Ok(()); // lo normal en cada arranque: nada que hacer
    }

    // Avisar al escritorio. clean_command porque dentro del AppImage las
    // variables heredadas rompen las herramientas del sistema (ver CLAUDE.md).
    // No son fatales (hay escritorios que no traen gtk-update-icon-cache y se
    // enteran igual), pero si fallan se dice: un icono que no cambia sin
    // explicacion es exactamente lo que nos hizo perder esta semana.
    if let Err(e) = crate::downloader::clean_command("gtk-update-icon-cache")
        .args(["-f", "-t"])
        .arg(&iconos)
        .status()
    {
        eprintln!("AVISO: no se pudo refrescar el cache de iconos ({e})");
    }
    if let Err(e) = crate::downloader::clean_command("update-desktop-database")
        .arg(home.join(".local/share/applications"))
        .status()
    {
        eprintln!("AVISO: no se pudo refrescar el menu de aplicaciones ({e})");
    }
    eprintln!("Infiniity DJ: acceso directo del menu actualizado.");
    Ok(())
}
