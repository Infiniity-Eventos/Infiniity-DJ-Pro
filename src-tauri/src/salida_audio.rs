//! Elegir POR DONDE suena la app: cabina, HDMI, parlante Bluetooth, USB...
//!
//! POR QUE ESTO NO SE PUEDE HACER DESDE EL FRONTEND:
//! en Linux la app corre sobre WebKitGTK, que NO implementa `setSinkId()` ni
//! enumera salidas de audio (eso solo existe en Chrome). Desde JavaScript no
//! hay absolutamente ninguna forma de cambiar la salida. Hay que hablar con el
//! servidor de sonido del sistema (PulseAudio o PipeWire) por fuera, con
//! `pactl`.
//!
//! POR QUE MOVEMOS NUESTRO FLUJO Y NO LA SALIDA GENERAL DEL SISTEMA:
//! el sintoma real era "conecto la cabina, otro programa SI suena por la
//! cabina y este sigue sonando por el portatil". Eso pasa porque el servidor
//! de sonido recuerda la salida POR PROGRAMA (module-stream-restore): el
//! nuestro quedo marcado con los parlantes del portatil y ahi se queda,
//! aunque la salida general del equipo sea otra. Mover nuestro flujo arregla
//! exactamente eso, y el servidor lo recuerda para las proximas veces.
//! Cambiar la salida general del sistema NO lo arreglaria.
//!
//! QUIEN crea el flujo de sonido: no el proceso principal, sino el proceso del
//! navegador interno (WebKitWebProcess), que es hijo nuestro. Por eso para
//! saber si un flujo es nuestro se sube por la cadena de padres.

use serde::Serialize;

use crate::downloader::clean_command;
use crate::en_otro_hilo;

/// Una salida de audio del equipo, como se la muestra al usuario.
#[derive(Serialize, Clone)]
pub struct AudioOutput {
    /// Nombre tecnico (el que entiende `pactl`).
    pub name: String,
    /// Nombre para mostrar ("Audio interno analogico", "JBL Charge 5"...).
    pub description: String,
    /// "bluetooth" | "hdmi" | "usb" | "analogica" | "digital" | "otra"
    pub kind: String,
    /// true en la salida por la que suena la app AHORA.
    pub active: bool,
}

/// Ejecuta `pactl` y devuelve su salida de texto.
///
/// El idioma se fija en ingles a proposito: `pactl` traduce sus etiquetas al
/// idioma del equipo ("Nombre:" en vez de "Name:"), asi que el analisis del
/// texto se rompia o no segun en que PC corriera.
///
/// Entorno limpio (`clean_command`): dentro del AppImage, las librerias que
/// hereda el proceso rompen cualquier programa del sistema que se lance.
fn pactl(args: &[&str]) -> Result<String, String> {
    let mut cmd = clean_command("pactl");
    cmd.env("LC_ALL", "C");
    cmd.env("LANG", "C");
    cmd.args(args);
    let out = cmd.output().map_err(|e| {
        format!(
            "No pude hablar con el sonido del equipo (no se pudo ejecutar «pactl»: {e}). \
             Falta instalar pulseaudio-utils (o pipewire-pulse)."
        )
    })?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(format!(
            "El sonido del equipo rechazo la orden{}",
            if err.is_empty() {
                String::new()
            } else {
                format!(": {err}")
            }
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// Una salida tal como la lista el servidor de sonido.
struct Sink {
    index: u32,
    name: String,
    description: String,
    /// "RUNNING" | "IDLE" | "SUSPENDED". Solo RUNNING significa que por ahi
    /// esta saliendo sonido de verdad AHORA MISMO.
    state: String,
    /// El equipo tiene esta salida muda. Otra forma de "todo bien y no se oye".
    muted: bool,
    /// Volumen del equipo para esta salida, en crudo (65536 = 100%).
    volume: u32,
}

fn list_sinks() -> Result<Vec<Sink>, String> {
    Ok(parse_sinks(&pactl(&["list", "sinks"])?))
}

/// El analisis del texto, aparte de la llamada: asi se puede probar sin
/// depender de que el equipo tenga `pactl` ni de que salidas tenga enchufadas.
fn parse_sinks(text: &str) -> Vec<Sink> {
    let mut out: Vec<Sink> = Vec::new();
    for line in text.lines() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("Sink #") {
            out.push(Sink {
                index: rest.trim().parse().unwrap_or(u32::MAX),
                name: String::new(),
                description: String::new(),
                state: String::new(),
                muted: false,
                volume: u32::MAX,
            });
            continue;
        }
        let Some(cur) = out.last_mut() else { continue };
        // Solo la PRIMERA aparicion de cada campo: mas abajo, en la lista de
        // propiedades, vuelven a aparecer nombres parecidos.
        if cur.name.is_empty() {
            if let Some(v) = t.strip_prefix("Name: ") {
                cur.name = v.trim().to_string();
                continue;
            }
        }
        if cur.description.is_empty() {
            if let Some(v) = t.strip_prefix("Description: ") {
                cur.description = v.trim().to_string();
                continue;
            }
        }
        if cur.state.is_empty() {
            if let Some(v) = t.strip_prefix("State: ") {
                cur.state = v.trim().to_string();
                continue;
            }
        }
        if let Some(v) = t.strip_prefix("Mute: ") {
            cur.muted = v.trim() == "yes";
            continue;
        }
        // "Volume: front-left: 72089 / 110% / 2.48 dB,   front-right: ..."
        // Se toma el primer canal: con el equipo desbalanceado igual hace falta
        // subirlo, y el volumen se pone en los dos a la vez.
        if cur.volume == u32::MAX {
            if let Some(v) = t.strip_prefix("Volume: ") {
                cur.volume = v
                    .split_once(": ")
                    .and_then(|(_, resto)| resto.split('/').next())
                    .and_then(|n| n.trim().parse::<u32>().ok())
                    .unwrap_or(u32::MAX);
            }
        }
    }
    out.retain(|s| s.index != u32::MAX && !s.name.is_empty());
    out
}

/// Salida general del equipo (la que usan los programas que no eligieron otra).
fn default_sink() -> Option<String> {
    let text = pactl(&["info"]).ok()?;
    text.lines()
        .filter_map(|l| l.trim().strip_prefix("Default Sink: "))
        .map(|v| v.trim().to_string())
        .next()
}

/// Un flujo de sonido en curso (un programa sonando).
struct Stream {
    index: u32,
    sink: u32,
    pid: Option<u32>,
    app: String,
    /// El servidor de sonido tiene el flujo en pausa (no pide muestras).
    corked: bool,
}

fn list_streams() -> Result<Vec<Stream>, String> {
    Ok(parse_streams(&pactl(&["list", "sink-inputs"])?))
}

fn parse_streams(text: &str) -> Vec<Stream> {
    let mut out: Vec<Stream> = Vec::new();
    for line in text.lines() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("Sink Input #") {
            out.push(Stream {
                index: rest.trim().parse().unwrap_or(u32::MAX),
                sink: u32::MAX,
                pid: None,
                app: String::new(),
                corked: false,
            });
            continue;
        }
        let Some(cur) = out.last_mut() else { continue };
        if let Some(v) = t.strip_prefix("Sink: ") {
            cur.sink = v.trim().parse().unwrap_or(u32::MAX);
        } else if let Some(v) = t.strip_prefix("Corked: ") {
            cur.corked = v.trim() == "yes";
        } else if let Some(v) = t.strip_prefix("application.process.id = ") {
            cur.pid = v.trim().trim_matches('"').parse().ok();
        } else if let Some(v) = t.strip_prefix("application.name = ") {
            cur.app = v.trim().trim_matches('"').to_lowercase();
        } else if let Some(v) = t.strip_prefix("application.process.binary = ") {
            if cur.app.is_empty() {
                cur.app = v.trim().trim_matches('"').to_lowercase();
            }
        }
    }
    out.retain(|s| s.index != u32::MAX);
    out
}

/// ¿`pid` es nuestro proceso o un descendiente?
///
/// El flujo de sonido lo abre el proceso del navegador interno, que es hijo
/// nuestro; comparar solo contra nuestro propio PID no encontraria nada.
fn is_ours(pid: u32) -> bool {
    let me = std::process::id();
    let mut p = pid;
    // Tope de saltos: si algo raro pasara, no se queda dando vueltas.
    for _ in 0..16 {
        if p == me {
            return true;
        }
        if p <= 1 {
            return false;
        }
        let Ok(stat) = std::fs::read_to_string(format!("/proc/{p}/stat")) else {
            return false;
        };
        // El nombre del proceso va entre parentesis y puede contener espacios
        // y parentesis; por eso se corta despues del ULTIMO ')'.
        let Some((_, after)) = stat.rsplit_once(')') else {
            return false;
        };
        let mut campos = after.split_whitespace();
        let _estado = campos.next();
        let Some(ppid) = campos.next().and_then(|v| v.parse::<u32>().ok()) else {
            return false;
        };
        p = ppid;
    }
    false
}

/// ¿Este flujo de sonido es de la app?
fn stream_is_ours(s: &Stream) -> bool {
    if let Some(pid) = s.pid {
        if is_ours(pid) {
            return true;
        }
    }
    // Respaldo por nombre, para el caso de que no se pueda leer /proc.
    s.app.contains("infiniity")
}

/// Tipo de salida, solo para mostrar una etiqueta entendible.
fn kind_of(name: &str) -> &'static str {
    let n = name.to_lowercase();
    if n.starts_with("bluez") || n.contains("bluetooth") {
        "bluetooth"
    } else if n.contains("hdmi") || n.contains("displayport") {
        "hdmi"
    } else if n.contains("usb") {
        "usb"
    } else if n.contains("iec958") || n.contains("spdif") {
        "digital"
    } else if n.contains("analog") {
        "analogica"
    } else {
        "otra"
    }
}

// ---------------------------------------------------------------------------
// Comandos que llama la interfaz
// ---------------------------------------------------------------------------

/// Salidas de audio disponibles ahora mismo.
///
/// Un parlante Bluetooth aparece aqui solo si ya esta emparejado y conectado
/// desde el sistema; el emparejamiento no se hace desde la app.
#[tauri::command]
pub async fn audio_outputs() -> Result<Vec<AudioOutput>, String> {
    en_otro_hilo(audio_outputs_sinc).await
}

fn audio_outputs_sinc() -> Result<Vec<AudioOutput>, String> {
    let sinks = list_sinks()?;
    // Por donde suena la app AHORA: manda su propio flujo. Si todavia no esta
    // sonando, la referencia es la salida general del equipo.
    let streams = list_streams().unwrap_or_default();
    let nuestra = streams
        .iter()
        .find(|s| stream_is_ours(s) && s.sink != u32::MAX)
        .map(|s| s.sink);
    let general = default_sink();

    Ok(sinks
        .iter()
        .map(|s| AudioOutput {
            name: s.name.clone(),
            description: if s.description.is_empty() {
                s.name.clone()
            } else {
                s.description.clone()
            },
            kind: kind_of(&s.name).to_string(),
            active: match nuestra {
                Some(i) => i == s.index,
                None => general.as_deref() == Some(s.name.as_str()),
            },
        })
        .collect())
}

/// Manda el sonido de la app a la salida elegida.
///
/// Devuelve CUANTOS flujos se movieron. Cero no es un fallo: significa que la
/// app todavia no esta sonando, asi que no habia nada que mover (al darle play
/// se vuelve a intentar). Se devuelve el numero en vez de callarlo para que la
/// interfaz pueda decir la verdad: "ya suena por ahi" o "dale play".
/// Como fue el cambio de salida.
#[derive(Serialize, Clone)]
pub struct ResultadoSalida {
    /// Cuantos flujos de sonido se movieron (0 = la app aun no sonaba).
    pub movidos: u32,
    /// Lo que hubo que arreglar para que se oiga. Se dice en pantalla: si la
    /// app corrige algo a espaldas del usuario y no lo cuenta, la proxima vez
    /// que pase nadie sabra por que a veces suena y a veces no.
    pub arreglos: Vec<String>,
}

#[tauri::command]
pub async fn audio_set_output(sink: String) -> Result<ResultadoSalida, String> {
    en_otro_hilo(move || audio_set_output_sinc(&sink)).await
}

fn audio_set_output_sinc(sink: &str) -> Result<ResultadoSalida, String> {
    // ANTES de mover nada: dejar la salida en condiciones de sonar.
    //
    // El orden importa. Cambiar el modo de trabajo de una cabina Bluetooth
    // REHACE su salida en el sistema, asi que si se movieran los flujos antes,
    // irian a una salida que deja de existir un instante despues.
    let mut arreglos: Vec<String> = Vec::new();
    if let Some(aviso) = asegurar_modo_musica(sink) {
        arreglos.push(aviso);
        // La salida acaba de rehacerse: darle un momento al sistema.
        std::thread::sleep(std::time::Duration::from_millis(600));
    }
    if let Some(aviso) = quitar_silencio(sink) {
        arreglos.push(aviso);
    }
    if let Some(aviso) = asegurar_volumen(sink) {
        arreglos.push(aviso);
    }

    // Dejar esta salida como la general del equipo.
    //
    // POR QUE SE AÑADIO (0.4.39): mover el flujo que ya suena funciona con
    // cable, pero con la cabina Bluetooth el informe de un evento mostro que
    // el flujo queda enganchado a la salida, la salida en RUNNING... y por la
    // cabina no sale NADA (grabando esa salida: pico 0.00000), mientras el
    // motor si estaba produciendo sonido (-14.4 dB). O sea: se pierde entre el
    // navegador interno y el sonido del sistema, justo en el tramo del
    // arrastre.
    //
    // Poniendola como salida general, la conexion NUEVA que abre el navegador
    // al rehacerse NACE ya en la cabina, en vez de nacer en otro sitio y que
    // haya que arrastrarla. No sustituye al arrastre (ver la cabecera: el
    // sistema recuerda la salida POR PROGRAMA y por eso el arrastre sigue
    // haciendo falta); se hacen las dos cosas.
    //
    // Que no se pueda no es motivo para parar: el arrastre de abajo puede
    // bastar. Pero queda dicho.
    if let Err(e) = pactl(&["set-default-sink", sink]) {
        eprintln!("[salida_audio] no se pudo poner «{sink}» como salida general: {e}");
    }

    let sinks = list_sinks()?;
    if !sinks.iter().any(|s| s.name == sink) {
        return Err(format!(
            "Esa salida ya no esta disponible. Revisa que siga conectada: {sink}"
        ));
    }

    let streams = list_streams()?;
    let mut movidos = 0u32;
    let mut ultimo_error: Option<String> = None;
    for s in streams.iter().filter(|s| stream_is_ours(s)) {
        let idx = s.index.to_string();
        match pactl(&["move-sink-input", idx.as_str(), sink]) {
            Ok(_) => movidos += 1,
            Err(e) => ultimo_error = Some(e),
        }
    }

    // Dejar apuntada la salida elegida para el PROXIMO arranque: el tamaño de
    // los trozos de sonido se decide al abrir el programa y no se puede cambiar
    // despues, asi que el arranque necesita saber si va a una cabina Bluetooth
    // (ver `arranque::preparar_sonido`).
    crate::arranque::recordar_salida(sink);

    // Si habia flujos nuestros y NINGUNO se pudo mover, es un fallo de verdad:
    // hay que decirlo, no devolver 0 como si no hubiera nada sonando.
    if movidos == 0 {
        if let Some(e) = ultimo_error {
            return Err(format!("No pude mandar el sonido a esa salida: {e}"));
        }
    }
    Ok(ResultadoSalida { movidos, arreglos })
}

// ---------------------------------------------------------------------------
// Cabinas Bluetooth: modo de trabajo y silencio
// ---------------------------------------------------------------------------

/// Una tarjeta de sonido (en Bluetooth, el aparato) y su modo de trabajo.
struct Tarjeta {
    name: String,
    perfil_activo: String,
    perfiles: Vec<String>,
}

fn parse_cards(texto: &str) -> Vec<Tarjeta> {
    let mut out: Vec<Tarjeta> = Vec::new();
    let mut en_perfiles = false;
    for linea in texto.lines() {
        let t = linea.trim();
        if t.starts_with("Card #") {
            en_perfiles = false;
            out.push(Tarjeta {
                name: String::new(),
                perfil_activo: String::new(),
                perfiles: Vec::new(),
            });
            continue;
        }
        let Some(cur) = out.last_mut() else { continue };
        if t == "Profiles:" {
            en_perfiles = true;
            continue;
        }
        if let Some(v) = t.strip_prefix("Active Profile: ") {
            en_perfiles = false;
            cur.perfil_activo = v.trim().to_string();
            continue;
        }
        // Cualquier otro encabezado cierra la lista de modos.
        if t.ends_with(':') && !t.contains(' ') {
            en_perfiles = false;
        }
        if cur.name.is_empty() {
            if let Some(v) = t.strip_prefix("Name: ") {
                cur.name = v.trim().to_string();
                continue;
            }
        }
        if en_perfiles {
            if let Some((id, _)) = t.split_once(": ") {
                if !id.is_empty() && !id.contains(' ') {
                    cur.perfiles.push(id.to_string());
                }
            }
        }
    }
    out.retain(|c| !c.name.is_empty());
    out
}

/// La parte de la direccion que comparten la salida y la tarjeta de una misma
/// cabina: `bluez_output.41_42_AE_0F_D5_CD.1` y `bluez_card.41_42_AE_0F_D5_CD`.
fn direccion_de_sink(sink: &str) -> Option<String> {
    let resto = sink.strip_prefix("bluez_output.")?;
    let dir = resto.split('.').next()?;
    if dir.is_empty() {
        None
    } else {
        Some(dir.to_string())
    }
}

/// ¿Este modo de trabajo es el de musica (A2DP) o el de "manos libres"?
fn es_modo_musica(perfil: &str) -> bool {
    perfil.contains("a2dp")
}

/// Pone la cabina en modo MUSICA si se quedo en modo "manos libres".
///
/// POR QUE ESTO ES IMPRESCINDIBLE: una cabina Bluetooth anuncia dos modos, el
/// de musica (A2DP, estereo y buena calidad) y el de manos libres (HSP/HFP,
/// pensado para llamadas). El sistema a veces se queda en el de manos libres.
/// Cuando pasa, TODO parece correcto —la cabina sale conectada, la salida
/// aparece en la lista, la app manda el sonido ahi— y por la cabina NO SE OYE
/// NADA. Es exactamente el fallo que se reporto desde un evento.
///
/// Devuelve que se hizo, para poder decirlo en pantalla (regla 4).
fn asegurar_modo_musica(sink: &str) -> Option<String> {
    let dir = direccion_de_sink(sink)?;
    let tarjetas = parse_cards(&pactl(&["list", "cards"]).ok()?);
    let tarjeta = tarjetas
        .iter()
        .find(|c| c.name.starts_with("bluez_card.") && c.name.contains(&dir))?;
    if es_modo_musica(&tarjeta.perfil_activo) {
        return None; // ya esta bien
    }
    // Entre los modos de musica, el que la cabina prefiera primero.
    let destino = tarjeta
        .perfiles
        .iter()
        .find(|p| es_modo_musica(p))
        .cloned()?;
    match pactl(&["set-card-profile", &tarjeta.name, &destino]) {
        Ok(_) => Some(format!(
            "La cabina estaba en modo manos libres («{}»), que no reproduce música.              Se pasó a modo música («{destino}»).",
            tarjeta.perfil_activo
        )),
        Err(e) => Some(format!(
            "La cabina está en modo manos libres («{}»), que no reproduce música,              y no se pudo cambiar: {e}",
            tarjeta.perfil_activo
        )),
    }
}

/// Quita el silencio de la salida si el sistema la tenia muda.
///
/// Una salida muda es otra forma de "todo correcto y no se oye nada": el flujo
/// llega, el sistema lo da por bueno, y no sale sonido. El sistema recuerda el
/// silencio por aparato, asi que una cabina puede llegar muda de otra vez.
fn quitar_silencio(sink: &str) -> Option<String> {
    let sinks = parse_sinks(&pactl(&["list", "sinks"]).ok()?);
    let s = sinks.iter().find(|s| s.name == sink)?;
    if !s.muted {
        return None;
    }
    match pactl(&["set-sink-mute", sink, "0"]) {
        Ok(_) => Some("La salida estaba silenciada en el equipo; se le quitó el silencio.".to_string()),
        Err(e) => Some(format!("La salida está silenciada en el equipo y no se pudo quitar: {e}")),
    }
}

/// 100% en la escala del servidor de sonido.
const VOLUMEN_NORMAL: u32 = 65536;

/// Sube el volumen que el EQUIPO le da a esta salida si lo encuentra bajo.
///
/// POR QUE: el volumen del sistema es un segundo volumen, invisible desde la
/// app. Alguien lo baja desde los ajustes del equipo —o se quedo bajo de otro
/// dia, porque el sistema lo recuerda por aparato— y entonces en la app se ve
/// todo al 100% y por la cabina no sale nada. Buscarlo en mitad de un evento,
/// entrando a la configuracion del sistema, es justo lo que esta app existe
/// para evitar.
///
/// En un equipo de DJ este volumen tiene que estar arriba SIEMPRE: el volumen
/// se maneja desde la app (VOL general) y desde la perilla de la cabina. Por
/// eso se pone al 100% en vez de solo avisar. Y se DICE, que es la diferencia
/// entre ayudar y toquetear a escondidas.
fn asegurar_volumen(sink: &str) -> Option<String> {
    let sinks = parse_sinks(&pactl(&["list", "sinks"]).ok()?);
    let s = sinks.iter().find(|s| s.name == sink)?;
    if s.volume == u32::MAX || s.volume >= VOLUMEN_NORMAL {
        return None; // no se pudo leer, o ya esta arriba
    }
    let antes = (f64::from(s.volume) / f64::from(VOLUMEN_NORMAL) * 100.0).round();
    match pactl(&["set-sink-volume", sink, "100%"]) {
        Ok(_) => Some(format!(
            "El equipo tenía esta salida al {antes}% de volumen; se subió al 100%."
        )),
        Err(e) => Some(format!(
            "El equipo tiene esta salida al {antes}% de volumen y no se pudo subir: {e}"
        )),
    }
}

/// Lo que esta pasando AHORA MISMO con el sonido de la app.
///
/// POR QUE HACE FALTA: que `pactl` acepte la orden de mover el flujo NO
/// significa que por el parlante salga sonido. Con Bluetooth pasaba
/// exactamente eso: la orden salia bien, la app decia "sonido enviado" y por
/// la cabina no se oia nada. Esto permite comprobarlo y decir la verdad.
#[derive(Serialize, Clone)]
pub struct EstadoSalida {
    /// La app tiene abierta una conexion de sonido con el sistema.
    pub hay_flujo: bool,
    /// Salida por la que va esa conexion (nombre tecnico), si se pudo saber.
    pub salida: Option<String>,
    /// El servidor de sonido tiene el flujo en pausa.
    pub pausado: bool,
    /// Estado de esa salida: "RUNNING" solo si esta saliendo sonido de verdad.
    pub estado: String,
    /// Volumen que el EQUIPO le da a esa salida, en %. Es un segundo volumen,
    /// aparte del de la app, y si esta bajo no se oye nada.
    pub volumen: u32,
    /// El equipo tiene esa salida muda.
    pub silenciada: bool,
}

/// Comprueba por donde va el sonido de la app y si de verdad esta saliendo.
#[tauri::command]
pub async fn audio_output_status() -> Result<EstadoSalida, String> {
    en_otro_hilo(audio_output_status_sinc).await
}

fn audio_output_status_sinc() -> Result<EstadoSalida, String> {
    let streams = list_streams()?;
    let Some(nuestro) = streams
        .iter()
        .find(|s| stream_is_ours(s) && s.sink != u32::MAX)
    else {
        // Sin flujo no hay nada que comprobar: la app no esta sonando.
        return Ok(EstadoSalida {
            hay_flujo: false,
            salida: None,
            pausado: false,
            estado: String::new(),
            volumen: 0,
            silenciada: false,
        });
    };
    let sinks = list_sinks()?;
    let sink = sinks.iter().find(|s| s.index == nuestro.sink);
    Ok(EstadoSalida {
        hay_flujo: true,
        salida: sink.map(|s| s.name.clone()),
        pausado: nuestro.corked,
        estado: sink.map(|s| s.state.clone()).unwrap_or_default(),
        volumen: sink
            .filter(|s| s.volume != u32::MAX)
            .map(|s| (f64::from(s.volume) / f64::from(VOLUMEN_NORMAL) * 100.0).round() as u32)
            .unwrap_or(0),
        silenciada: sink.map(|s| s.muted).unwrap_or(false),
    })
}

#[cfg(test)]
mod pruebas {
    use super::*;

    /// Donde queda apuntada la salida elegida (ver `arranque::recordar_salida`).
    fn dirs_cache_salida() -> std::path::PathBuf {
        let base = std::env::var_os("XDG_CACHE_HOME")
            .map(std::path::PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".cache"))
            })
            .unwrap_or_else(std::env::temp_dir);
        base.join("infiniity-dj").join("salida-elegida")
    }

    /// Salida real de `LC_ALL=C pactl list sinks` (recortada) en un equipo con
    /// salidas virtuales, HDMI e interna. Se guarda tal cual, con la seccion
    /// Properties incluida, porque ahi vuelven a aparecer campos parecidos
    /// (`alsa.name`, `device.icon_name`) y el analisis no debe confundirse.
    const SINKS: &str = r#"Sink #40
	State: RUNNING
	Name: salida_parlantes
	Description: Parlantes (verde)
	Properties:
		device.icon_name = "audio-card-analog"
		alsa.name = "no es esta"
Sink #63
	State: SUSPENDED
	Name: alsa_output.pci-0000_01_00.1.hdmi-stereo
	Description: GB206 High Definition Audio Controller Digital Stereo (HDMI)
	Properties:
		alsa.card_name = "HDA NVidia"
		alsa.name = "HP Z27n G2"
	Active Port: hdmi-output-0
"#;

    /// Salida real de `pactl list sink-inputs`: el primer flujo es una salida
    /// virtual (NO trae ningun `application.*`, caso que se vio de verdad) y el
    /// segundo es un programa con su PID.
    const STREAMS: &str = r#"Sink Input #39
	Driver: protocol-native.c
	Sink: 64
Sink Input #210
	Driver: protocol-native.c
	Sink: 40
	Corked: yes
	Properties:
		application.name = "paplay"
		application.process.id = "1267609"
		application.process.binary = "pacat"
"#;

    #[test]
    fn parse_sinks_toma_el_primer_name_y_no_el_de_properties() {
        let s = parse_sinks(SINKS);
        assert_eq!(s.len(), 2);
        assert_eq!(s[0].index, 40);
        assert_eq!(s[0].name, "salida_parlantes");
        assert_eq!(s[0].description, "Parlantes (verde)");
        assert_eq!(s[1].index, 63);
        assert_eq!(s[1].name, "alsa_output.pci-0000_01_00.1.hdmi-stereo");
        assert!(
            s[1].description.contains("HDMI"),
            "la descripcion no debe venir de alsa.name: {}",
            s[1].description
        );
        // El estado es lo que delata si por esa salida esta saliendo sonido.
        assert_eq!(s[0].state, "RUNNING");
        assert_eq!(s[1].state, "SUSPENDED");
    }

    #[test]
    fn parse_streams_saca_pid_y_aguanta_flujos_sin_aplicacion() {
        let f = parse_streams(STREAMS);
        assert_eq!(f.len(), 2);
        // Las salidas virtuales no traen application.*: ni PID ni nombre.
        assert_eq!(f[0].index, 39);
        assert_eq!(f[0].sink, 64);
        assert_eq!(f[0].pid, None);
        assert!(f[0].app.is_empty());
        // Un programa de verdad: PID sin las comillas y nombre en minusculas.
        assert_eq!(f[1].index, 210);
        assert_eq!(f[1].sink, 40);
        assert_eq!(f[1].pid, Some(1_267_609));
        assert_eq!(f[1].app, "paplay");
        // "Corked: yes" = el sistema lo tiene en pausa (no pide muestras).
        assert!(!f[0].corked);
        assert!(f[1].corked);
    }

    /// Descarga los modulos de prueba aunque la prueba falle a medias: si no,
    /// quedarian salidas de pega en el equipo del usuario.
    struct Limpieza(Vec<String>);
    impl Drop for Limpieza {
        fn drop(&mut self) {
            for m in &self.0 {
                let _ = pactl(&["unload-module", m]);
            }
        }
    }

    /// Un WAV de verdad (sinusoide bajita) para tener algo que suene.
    fn wav_de_prueba(ruta: &std::path::Path, segundos: u32) {
        let (tasa, canales) = (48_000u32, 1u16);
        let muestras = tasa * segundos;
        let datos = muestras * 2;
        let mut w: Vec<u8> = Vec::with_capacity(44 + datos as usize);
        w.extend(b"RIFF");
        w.extend(&(36 + datos).to_le_bytes());
        w.extend(b"WAVEfmt ");
        w.extend(&16u32.to_le_bytes());
        w.extend(&1u16.to_le_bytes()); // PCM
        w.extend(&canales.to_le_bytes());
        w.extend(&tasa.to_le_bytes());
        w.extend(&(tasa * 2).to_le_bytes()); // bytes por segundo
        w.extend(&2u16.to_le_bytes()); // bytes por bloque
        w.extend(&16u16.to_le_bytes()); // bits por muestra
        w.extend(b"data");
        w.extend(&datos.to_le_bytes());
        for n in 0..muestras {
            let t = n as f64 / tasa as f64;
            let v = (t * 440.0 * std::f64::consts::TAU).sin() * 6000.0;
            w.extend(&(v as i16).to_le_bytes());
        }
        std::fs::write(ruta, w).unwrap();
    }

    /// LA PRUEBA QUE IMPORTA: contra el sonido de verdad del equipo, comprobar
    /// que `audio_set_output` mueve el flujo y que `audio_output_status` lo
    /// confirma. Es la base de todo el arreglo de Bluetooth: si la
    /// comprobacion mintiera, la app volveria a decir "sonido enviado"
    /// mientras por el parlante no se oye nada.
    ///
    /// Suena en salidas de pega (`module-null-sink`), asi que no se oye nada.
    #[test]
    #[ignore = "necesita pactl y el sonido del equipo"]
    fn mover_el_sonido_se_puede_comprobar_de_verdad() {
        let m1 = pactl(&["load-module", "module-null-sink", "sink_name=djprueba1"])
            .expect("hace falta pactl")
            .trim()
            .to_string();
        let m2 = pactl(&["load-module", "module-null-sink", "sink_name=djprueba2"])
            .expect("hace falta pactl")
            .trim()
            .to_string();
        let _limpieza = Limpieza(vec![m1, m2]);
        // `audio_set_output` ahora tambien cambia la salida GENERAL del equipo,
        // asi que hay que devolverla como estaba: si no, la prueba dejaria el
        // sonido de esta PC apuntando a una salida de pega que ya no existe.
        // `audio_set_output` tiene dos efectos que salen de la prueba: cambia la
        // salida GENERAL del equipo y apunta la salida elegida para el proximo
        // arranque. Las dos se devuelven como estaban: una prueba no puede
        // dejarle el sonido tocado a quien la corre.
        let general_antes = default_sink();
        let apuntada_antes =
            std::fs::read_to_string(dirs_cache_salida()).ok();
        struct Restaurar(Option<String>, Option<String>);
        impl Drop for Restaurar {
            fn drop(&mut self) {
                if let Some(s) = &self.0 {
                    let _ = pactl(&["set-default-sink", s]);
                }
                match &self.1 {
                    Some(v) => crate::arranque::recordar_salida(v),
                    None => {
                        let _ = std::fs::remove_file(dirs_cache_salida());
                    }
                }
            }
        }
        let _restaurar = Restaurar(general_antes, apuntada_antes);

        let wav = std::env::temp_dir().join("infiniity-dj-prueba-salida.wav");
        wav_de_prueba(&wav, 20);

        // Hijo NUESTRO sonando: asi `stream_is_ours` lo reconoce subiendo por
        // la cadena de padres, igual que hace con el navegador interno.
        let mut hijo = clean_command("paplay")
            .env("PULSE_SINK", "djprueba1")
            .arg(&wav)
            .spawn()
            .expect("hace falta paplay (pulseaudio-utils)");

        // Darle tiempo a que abra el flujo de sonido. Margen amplio a
        // proposito: con todas las pruebas de hardware corriendo a la vez, el
        // equipo va cargado y `paplay` tarda mas en arrancar. Una prueba que
        // falla a ratos no sirve para nada.
        let mut estado = None;
        for _ in 0..100 {
            std::thread::sleep(std::time::Duration::from_millis(100));
            let e = audio_output_status_sinc().unwrap();
            if e.hay_flujo && e.salida.as_deref() == Some("djprueba1") {
                estado = Some(e);
                break;
            }
        }
        let e = estado.expect("el flujo de sonido no aparecio en djprueba1");
        assert!(!e.pausado, "el flujo no deberia estar en pausa");
        assert_eq!(
            e.estado, "RUNNING",
            "si esta sonando, la salida tiene que estar RUNNING"
        );

        // Y ahora lo que hace la app al cambiar de salida.
        let r = audio_set_output_sinc("djprueba2").unwrap();
        assert!(r.movidos >= 1, "deberia haber movido al menos un flujo");
        let mut llego = false;
        for _ in 0..30 {
            std::thread::sleep(std::time::Duration::from_millis(100));
            if audio_output_status_sinc().unwrap().salida.as_deref() == Some("djprueba2") {
                llego = true;
                break;
            }
        }
        assert!(llego, "el estado deberia confirmar que el sonido se mudo");

        // Y que la comprobacion DETECTA el problema: sin flujo, no hay sonido.
        let _ = hijo.kill();
        let _ = hijo.wait();
        let mut sin_flujo = false;
        for _ in 0..30 {
            std::thread::sleep(std::time::Duration::from_millis(100));
            if !audio_output_status_sinc().unwrap().hay_flujo {
                sin_flujo = true;
                break;
            }
        }
        assert!(sin_flujo, "al parar el sonido tiene que verse que no hay flujo");
        let _ = std::fs::remove_file(&wav);
    }

    /// Salida real de `pactl list cards` con una cabina Bluetooth atascada en
    /// modo manos libres: exactamente el caso que deja todo "correcto" y mudo.
    const CARDS: &str = r#"Card #55
	Name: alsa_card.pci-0000_00_1f.3
	Profiles:
		off: Apagado (sinks: 0, sources: 0, priority: 0, available: yes)
		output:analog-stereo: Estereo (sinks: 1, sources: 0, priority: 6500, available: yes)
	Active Profile: output:analog-stereo
Card #88
	Name: bluez_card.41_42_AE_0F_D5_CD
	Profiles:
		off: Apagado (sinks: 0, sources: 0, priority: 0, available: yes)
		a2dp-sink: Alta fidelidad (A2DP Sink) (sinks: 1, sources: 0, priority: 40, available: yes)
		headset-head-unit: Manos libres (HSP/HFP) (sinks: 1, sources: 1, priority: 30, available: yes)
	Active Profile: headset-head-unit
	Ports:
		speaker-output: Altavoz (type: Speaker, priority: 0)
"#;

    #[test]
    fn parse_cards_saca_el_modo_de_trabajo_de_la_cabina() {
        let c = parse_cards(CARDS);
        assert_eq!(c.len(), 2);
        let cabina = c
            .iter()
            .find(|x| x.name.starts_with("bluez_card."))
            .expect("deberia encontrar la cabina");
        assert_eq!(cabina.perfil_activo, "headset-head-unit");
        assert!(
            cabina.perfiles.iter().any(|p| p == "a2dp-sink"),
            "tiene que ver el modo musica entre los disponibles: {:?}",
            cabina.perfiles
        );
        // "Ports:" no debe colarse como si fuera un modo de trabajo.
        assert!(
            !cabina.perfiles.iter().any(|p| p.contains("speaker-output")),
            "se colo un puerto entre los modos: {:?}",
            cabina.perfiles
        );
    }

    #[test]
    fn modo_manos_libres_no_cuenta_como_modo_musica() {
        assert!(es_modo_musica("a2dp-sink"));
        assert!(es_modo_musica("a2dp-sink-sbc-xq"));
        assert!(!es_modo_musica("headset-head-unit"));
        assert!(!es_modo_musica("off"));
    }

    #[test]
    fn direccion_de_sink_empareja_la_salida_con_su_tarjeta() {
        assert_eq!(
            direccion_de_sink("bluez_output.41_42_AE_0F_D5_CD.1").as_deref(),
            Some("41_42_AE_0F_D5_CD")
        );
        // Una salida con cable no tiene tarjeta Bluetooth que mirar.
        assert_eq!(direccion_de_sink("alsa_output.pci-0000_00_1f.3.analog-stereo"), None);
    }

    #[test]
    fn parse_sinks_lee_el_volumen_del_equipo() {
        let s = parse_sinks(
            "Sink #7\n\tState: RUNNING\n\tName: cabina\n\tMute: no\n\tVolume: front-left: 32768 /  50% / -6.02 dB,   front-right: 32768 /  50% / -6.02 dB\n",
        );
        assert_eq!(s[0].volume, 32768, "el volumen del equipo es un segundo volumen, hay que leerlo");
        // Sin linea de volumen no se inventa un valor: queda marcado como «no se sabe».
        let sin = parse_sinks("Sink #8\n\tName: otra\n");
        assert_eq!(sin[0].volume, u32::MAX);
    }

    #[test]
    fn parse_sinks_ve_cuando_una_salida_esta_muda() {
        let s = parse_sinks("Sink #7
	State: IDLE
	Name: muda
	Mute: yes
");
        assert!(s[0].muted, "«Mute: yes» tiene que verse");
    }

    #[test]
    fn kind_of_reconoce_cada_tipo_de_salida() {
        assert_eq!(kind_of("bluez_output.AC_12_2F.1"), "bluetooth");
        assert_eq!(kind_of("alsa_output.pci-0000_01_00.1.hdmi-stereo"), "hdmi");
        assert_eq!(kind_of("alsa_output.usb-Generic_USB_Audio-00.analog-stereo"), "usb");
        assert_eq!(kind_of("alsa_output.pci-0000_00_1f.3.iec958-stereo"), "digital");
        assert_eq!(kind_of("alsa_output.pci-0000_00_1f.3.analog-surround-40"), "analogica");
        // Las salidas que crea el usuario a mano no dicen de que son.
        assert_eq!(kind_of("salida_parlantes"), "otra");
    }

    /// Habla con el `pactl` DE VERDAD de este equipo. Pesada y depende de que
    /// haya pulseaudio-utils y alguna salida: solo con `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn audio_outputs_real_lista_las_salidas_del_equipo() {
        let salidas = audio_outputs_sinc().expect("hace falta pactl (pulseaudio-utils)");
        assert!(!salidas.is_empty(), "el equipo deberia tener alguna salida");
        let activas = salidas.iter().filter(|s| s.active).count();
        assert!(activas <= 1, "no puede haber dos salidas activas a la vez");
        for s in &salidas {
            assert!(!s.name.is_empty());
            assert!(!s.description.is_empty(), "{} sin descripcion", s.name);
        }
    }

    /// Contra el sonido de verdad del equipo (como la de arriba, se salta en
    /// CI con `#[ignore]`): comprueba que el estado se puede leer y que lo que
    /// dice cuadra consigo mismo.
    #[test]
    #[ignore = "necesita pactl y el sonido del equipo"]
    fn audio_output_status_real_cuadra_consigo_mismo() {
        let e = audio_output_status_sinc().expect("hace falta pactl (pulseaudio-utils)");
        if !e.hay_flujo {
            // La app no esta sonando: entonces no hay salida ni estado que dar.
            assert!(e.salida.is_none(), "sin flujo no puede haber salida");
            assert!(e.estado.is_empty(), "sin flujo no puede haber estado");
            return;
        }
        let salida = e.salida.expect("con flujo hay que saber por donde va");
        let sinks = list_sinks().unwrap();
        assert!(
            sinks.iter().any(|s| s.name == salida),
            "la salida «{salida}» no esta entre las del equipo"
        );
        assert!(
            ["RUNNING", "IDLE", "SUSPENDED"].contains(&e.estado.as_str()),
            "estado raro: «{}»",
            e.estado
        );
    }
}
