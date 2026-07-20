//! Conexion nativa con la controladora por MIDI (crate `midir`).
//!
//! No usamos Web MIDI (que no funciona de forma estable dentro del webview de
//! Tauri en Linux). En su lugar, el "cerebro" en Rust escucha la controladora y
//! le reenvia los eventos ya traducidos al frontend mediante un evento de Tauri
//! ("midi://control"). Asi es plug-and-play: al conectar la DDJ-200 el programa
//! la reconoce por su nombre.

use crate::ddj200;
use midir::{Ignore, MidiInput, MidiInputConnection};
use tauri::{AppHandle, Emitter};

#[derive(Default)]
pub struct MidiState {
    pub conn: Option<MidiInputConnection<()>>,
    pub port_name: Option<String>,
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
