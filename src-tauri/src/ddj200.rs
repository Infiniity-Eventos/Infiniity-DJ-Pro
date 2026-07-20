//! Mapeo FIJO de la controladora Pioneer DDJ-200.
//!
//! IMPORTANTE (leer): estos numeros de nota/CC estan basados en el
//! comportamiento conocido de la DDJ-200. Como aun no se ha probado contra la
//! unidad fisica, dejamos el mapeo centralizado aqui para poder ajustarlo en un
//! solo lugar durante la prueba real. Una vez confirmado, queda grabado en el
//! programa y funciona plug-and-play en cualquier portatil (no hay que volver a
//! mapear nada).
//!
//! Convencion de canal MIDI:
//!   - Canal 0 (0x90/0xB0) => Deck A (izquierda)
//!   - Canal 1 (0x91/0xB1) => Deck B (derecha)
//!   - Controles globales (crossfader) llegan en su propio canal.

use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct ControlEvent {
    /// Accion logica: "play", "cue", "volume", "crossfader", "jog", "tempo",
    /// "load", "sync", "cue_hot".
    pub action: String,
    /// 0 = Deck A, 1 = Deck B, 255 = global (ej. crossfader).
    pub deck: u8,
    /// Perillas/faders: 0.0 a 1.0. Botones: 1.0 (presionado) / 0.0 (soltado).
    /// Jog: valor relativo -1.0 a 1.0 (positivo = adelante).
    pub value: f64,
}

const GLOBAL: u8 = 255;

// --- Notas de botones (status 0x9n) ---
const NOTE_PLAY: u8 = 0x0B;
const NOTE_CUE: u8 = 0x0C;
const NOTE_SYNC: u8 = 0x58;
const NOTE_LOAD: u8 = 0x46;

// --- Control Change de perillas/faders (status 0xBn) ---
const CC_TEMPO: u8 = 0x00; // slider de tempo del deck
const CC_VOLUME: u8 = 0x13; // fader de volumen del canal
const CC_JOG: u8 = 0x22; // giro del plato (jog)
const CC_CROSSFADER: u8 = 0x1F; // crossfader (llega como global)

pub fn map_message(msg: &[u8]) -> Option<ControlEvent> {
    if msg.len() < 2 {
        return None;
    }
    let status = msg[0] & 0xF0;
    let channel = msg[0] & 0x0F;
    let data1 = msg[1];
    let data2 = if msg.len() > 2 { msg[2] } else { 0 };

    // Deck segun canal (solo aplica a decks A/B).
    let deck = if channel <= 1 { channel } else { GLOBAL };

    match status {
        // Note On => botones.
        0x90 => {
            let pressed = data2 > 0;
            let v = if pressed { 1.0 } else { 0.0 };
            let action = match data1 {
                NOTE_PLAY => "play",
                NOTE_CUE => "cue",
                NOTE_SYNC => "sync",
                NOTE_LOAD => "load",
                _ => return None,
            };
            Some(ControlEvent {
                action: action.to_string(),
                deck,
                value: v,
            })
        }
        // Control Change => perillas/faders/jog.
        0xB0 => {
            let norm = data2 as f64 / 127.0;
            match data1 {
                CC_VOLUME => Some(ControlEvent {
                    action: "volume".to_string(),
                    deck,
                    value: norm,
                }),
                CC_TEMPO => Some(ControlEvent {
                    action: "tempo".to_string(),
                    deck,
                    value: norm,
                }),
                CC_CROSSFADER => Some(ControlEvent {
                    action: "crossfader".to_string(),
                    deck: GLOBAL,
                    value: norm,
                }),
                CC_JOG => {
                    // Los jog envian valores relativos centrados en 64 (0x40):
                    // >64 = adelante, <64 = atras.
                    let rel = (data2 as i32 - 64) as f64 / 64.0;
                    Some(ControlEvent {
                        action: "jog".to_string(),
                        deck,
                        value: rel,
                    })
                }
                _ => None,
            }
        }
        _ => None,
    }
}
