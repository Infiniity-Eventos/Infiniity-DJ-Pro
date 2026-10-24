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
            });
            continue;
        }
        let Some(cur) = out.last_mut() else { continue };
        if let Some(v) = t.strip_prefix("Sink: ") {
            cur.sink = v.trim().parse().unwrap_or(u32::MAX);
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
pub fn audio_outputs() -> Result<Vec<AudioOutput>, String> {
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
#[tauri::command]
pub fn audio_set_output(sink: String) -> Result<u32, String> {
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
        match pactl(&["move-sink-input", idx.as_str(), sink.as_str()]) {
            Ok(_) => movidos += 1,
            Err(e) => ultimo_error = Some(e),
        }
    }

    // Si habia flujos nuestros y NINGUNO se pudo mover, es un fallo de verdad:
    // hay que decirlo, no devolver 0 como si no hubiera nada sonando.
    if movidos == 0 {
        if let Some(e) = ultimo_error {
            return Err(format!("No pude mandar el sonido a esa salida: {e}"));
        }
    }
    Ok(movidos)
}

#[cfg(test)]
mod pruebas {
    use super::*;

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
        let salidas = audio_outputs().expect("hace falta pactl (pulseaudio-utils)");
        assert!(!salidas.is_empty(), "el equipo deberia tener alguna salida");
        let activas = salidas.iter().filter(|s| s.active).count();
        assert!(activas <= 1, "no puede haber dos salidas activas a la vez");
        for s in &salidas {
            assert!(!s.name.is_empty());
            assert!(!s.description.is_empty(), "{} sin descripcion", s.name);
        }
    }
}
