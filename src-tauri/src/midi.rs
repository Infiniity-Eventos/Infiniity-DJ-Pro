//! Conexion nativa con la controladora por MIDI (crate `midir`).
//!
//! No usamos Web MIDI (que no funciona de forma estable dentro del webview de
//! Tauri en Linux). En su lugar, el "cerebro" en Rust escucha la controladora y
//! le reenvia los eventos ya traducidos al frontend mediante un evento de Tauri
//! ("midi://control"). Asi es plug-and-play: al conectar la DDJ-200 el programa
//! la reconoce por su nombre.

use crate::ddj200;
use midir::{Ignore, MidiInput, MidiInputConnection};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub struct MidiState {
    pub conn: Option<MidiInputConnection<()>>,
    pub port_name: Option<String>,
    /// true = el programa busca y conecta la controladora solo (por defecto).
    /// false = el usuario la desconecto a mano; no insistir hasta que la pida.
    pub auto: bool,
}

impl Default for MidiState {
    fn default() -> Self {
        Self { conn: None, port_name: None, auto: true }
    }
}

/// Lo que se le cuenta al frontend cuando la controladora aparece o se va.
#[derive(serde::Serialize, Clone)]
pub struct MidiStatus {
    pub connected: bool,
    pub port: Option<String>,
}

/// Cada cuanto se revisa si la controladora aparecio o se fue.
const CADA: Duration = Duration::from_secs(3);

/// Hilo que vigila la controladora mientras el programa esta abierto:
/// - si no esta conectada (y el usuario no la apago a mano), la busca y conecta;
/// - si estaba conectada y su puerto desaparece (cable suelto), lo avisa y
///   vuelve a buscarla.
///
/// POR QUE: en un evento nadie se acuerda de pulsar "DDJ-200" despues de
/// enchufarla, y si el cable se mueve el boton seguia diciendo "conectada" sin
/// estarlo. `midir` no avisa de desconexiones, por eso se consulta la lista.
pub fn vigilar(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(CADA);
        let state = app.state::<crate::AppState>();
        let Ok(mut m) = state.midi.lock() else { continue };
        if !m.auto {
            continue;
        }
        match m.port_name.clone() {
            Some(name) => {
                if !list_ports().iter().any(|p| *p == name) {
                    m.conn = None;
                    m.port_name = None;
                    eprintln!("MIDI: la controladora {name} se desconecto");
                    if let Err(e) = app.emit("midi://status", MidiStatus { connected: false, port: Some(name) }) {
                        eprintln!("AVISO: no se pudo avisar la desconexion MIDI ({e})");
                    }
                }
            }
            None => {
                // Sin controladora es lo normal la mayor parte del tiempo: no se
                // registra nada para no llenar el log cada 3 segundos.
                if let Ok((conn, name)) = connect(app.clone()) {
                    m.conn = Some(conn);
                    m.port_name = Some(name.clone());
                    eprintln!("MIDI: controladora conectada: {name}");
                    if let Err(e) = app.emit("midi://status", MidiStatus { connected: true, port: Some(name) }) {
                        eprintln!("AVISO: no se pudo avisar la conexion MIDI ({e})");
                    }
                }
            }
        }
    });
}

/// Lista los nombres de los puertos MIDI de entrada disponibles.
pub fn list_ports() -> Vec<String> {
    match MidiInput::new("InfiniityDJ-list") {
        Ok(mi) => mi
            .ports()
            .iter()
            .filter_map(|p| mi.port_name(p).ok())
            .collect(),
        Err(_) => Vec::new(),
    }
}

/// Busca la DDJ-200 (por nombre) y se conecta. Devuelve la conexion (para
/// mantenerla viva) y el nombre del puerto encontrado.
pub fn connect(app: AppHandle) -> Result<(MidiInputConnection<()>, String), String> {
    let mut midi_in =
        MidiInput::new("InfiniityDJ-in").map_err(|e| format!("No se pudo iniciar MIDI: {e}"))?;
    midi_in.ignore(Ignore::None);

    let ports = midi_in.ports();
    let port = ports
        .iter()
        .find(|p| {
            midi_in
                .port_name(p)
                .map(|n| {
                    let up = n.to_uppercase();
                    up.contains("DDJ") || up.contains("DDJ-200")
                })
                .unwrap_or(false)
        })
        .ok_or_else(|| "No se encontro la DDJ-200 conectada".to_string())?;

    let port_name = midi_in.port_name(port).unwrap_or_else(|_| "DDJ-200".to_string());

    let conn = midi_in
        .connect(
            port,
            "infiniity-ddj200",
            move |_stamp, message, _| {
                if let Some(ev) = ddj200::map_message(message) {
                    let _ = app.emit("midi://control", ev);
                }
            },
            (),
        )
        .map_err(|e| format!("No se pudo conectar a la controladora: {e}"))?;

    Ok((conn, port_name))
}
