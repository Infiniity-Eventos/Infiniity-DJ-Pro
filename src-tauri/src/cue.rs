//! AUDÍFONOS DE LOS DECKS (pre-escucha "de mixer"; guía
//! `.mega-cuestionario/Guía para Audífonos.md`).
//!
//! Lo que pidió el equipo el 31-oct: con la barra (crossfader) se elige lo que
//! oye el público, y en los audífonos se oyen los decks que el DJ encienda,
//! COMPLETOS y sin importar la barra, para saber cuándo hacer el cambio.
//!
//! La pre-escucha de antes (`preescucha.rs`) leía el ARCHIVO por su cuenta y
//! no sabía nada del deck: ni la velocidad, ni la pausa, ni el adelantar. Aquí
//! el sonido sale del MISMO motor: `AudioEngine` copia la señal de los decks
//! con el botón de audífonos encendido (antes de la barra y del volumen) y la
//! manda en trozos, en crudo (16 bits, estéreo), a `cue_datos`. Este módulo
//! solo se la pasa a `pacat`, con el mismo nombre de programa que la
//! pre-escucha (`preescucha::CLIENTE`): el sistema nunca la confunde con el
//! sonido de la cabina, y `stream_is_ours` la deja fuera de todo lo que mueve
//! o mide la salida principal. (Una segunda conexión del motor web hacia los
//! audífonos NO sirve: medido el 30-oct, ver la cabecera de `preescucha.rs`.)
//!
//! NUNCA SE ESPERA: `cue_datos` deja el trozo en una cola corta y vuelve al
//! instante. Si `pacat` se atasca, se pierden trozos de los AUDÍFONOS (se oye
//! un corte), pero la app y la cabina no se enteran.

use std::io::{Read, Write};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};

use serde::Serialize;

use crate::downloader::clean_command;
use crate::en_otro_hilo;

struct Sesion {
    sink: String,
    rate: u32,
    cola: SyncSender<Vec<u8>>,
    hijo: Arc<Mutex<Option<Child>>>,
    hilo: Option<std::thread::JoinHandle<()>>,
    terminada: Arc<AtomicBool>,
    error: Arc<Mutex<Option<String>>>,
    perdidos: Arc<AtomicU64>,
}

static SESION: Mutex<Option<Sesion>> = Mutex::new(None);

#[derive(Serialize, Clone, Default)]
pub struct EstadoCue {
    pub abierto: bool,
    pub sink: String,
    /// Por qué se cerró sola (falló `pacat`, se desconectaron los audífonos...).
    pub error: Option<String>,
    /// Trozos tirados porque `pacat` no daba abasto (se oye como un corte).
    pub perdidos: u64,
}

fn bloquear() -> std::sync::MutexGuard<'static, Option<Sesion>> {
    SESION.lock().unwrap_or_else(|e| e.into_inner())
}

fn estado_de(s: &Option<Sesion>) -> EstadoCue {
    match s {
        None => EstadoCue::default(),
        Some(s) => EstadoCue {
            abierto: !s.terminada.load(Ordering::Relaxed),
            sink: s.sink.clone(),
            error: s.error.lock().unwrap_or_else(|e| e.into_inner()).clone(),
            perdidos: s.perdidos.load(Ordering::Relaxed),
        },
    }
}

fn cerrar_sesion(g: &mut Option<Sesion>) {
    let Some(mut s) = g.take() else { return };
    // Soltar la cola hace que el hilo termine; matar pacat lo desbloquea si
    // estaba escribiendo.
    drop(s.cola);
    if let Some(h) = s.hijo.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
        if let Err(err) = h.kill() {
            eprintln!("[cue] no se pudo parar pacat: {err}");
        }
        let _ = h.wait();
    }
    if let Some(hilo) = s.hilo.take() {
        let _ = hilo.join();
    }
}

fn abrir_sinc(sink: String, rate: u32) -> Result<EstadoCue, String> {
    // Nunca por donde suena la música: la oiría todo el público.
    if let Some(principal) = crate::salida_audio::salida_principal() {
        if principal == sink {
            return Err("Esa es la misma salida por donde suena la música: el público oiría los audífonos. Los audífonos tienen que ir por otra salida (de cable si la cabina es Bluetooth, o Bluetooth si la cabina va por cable).".to_string());
        }
    }
    let mut g = bloquear();
    if let Some(s) = g.as_ref() {
        if s.sink == sink && s.rate == rate && !s.terminada.load(Ordering::Relaxed) {
            return Ok(estado_de(&g));
        }
    }
    cerrar_sesion(&mut g);

    // Audífonos Bluetooth: más margen (con la cabina se midió el 28-oct que
    // un margen corto por Bluetooth llega en silencio o entrecortado).
    let latencia = if sink.starts_with("bluez") { "--latency-msec=250" } else { "--latency-msec=100" };
    let mut p = clean_command("pacat")
        .args([
            "--playback",
            "--raw",
            "--format=s16le",
            &format!("--rate={rate}"),
            "--channels=2",
            &format!("--device={sink}"),
            &format!("--client-name={}", crate::preescucha::CLIENTE),
            "--stream-name=Audifonos de los decks",
            "--property=media.role=preescucha",
            latencia,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("No se pudieron abrir los audífonos (pacat): {e}"))?;
    let mut entrada = p.stdin.take().ok_or("pacat no abrió su entrada")?;
    let mut errores = p.stderr.take();

    let hijo = Arc::new(Mutex::new(Some(p)));
    let terminada = Arc::new(AtomicBool::new(false));
    let error: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    // ~8 trozos de 2048 muestras = ~0,35 s de reserva. Más sería retraso.
    let (tx, rx) = sync_channel::<Vec<u8>>(8);

    let hilo = {
        let (hijo, terminada, error) = (hijo.clone(), terminada.clone(), error.clone());
        std::thread::spawn(move || {
            let mut fallo: Option<String> = None;
            // Termina cuando se suelta la cola (cerrar) o cuando pacat muere.
            while let Ok(trozo) = rx.recv() {
                if let Err(e) = entrada.write_all(&trozo) {
                    fallo = Some(format!("Los audífonos se desconectaron o su salida se cerró ({e})"));
                    break;
                }
            }
            drop(entrada);
            if fallo.is_some() {
                // Lo que diga pacat suele explicar mejor el porqué.
                if let Some(h) = hijo.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
                    let _ = h.wait();
                }
                let mut t = String::new();
                if let Some(er) = errores.as_mut() {
                    let _ = er.read_to_string(&mut t);
                }
                if !t.trim().is_empty() {
                    fallo = Some(format!("{} — pacat: {}", fallo.unwrap_or_default(), t.trim()));
                }
                eprintln!("[cue] {fallo:?}");
                *error.lock().unwrap_or_else(|e| e.into_inner()) = fallo;
            }
            terminada.store(true, Ordering::Relaxed);
        })
    };

    *g = Some(Sesion {
        sink,
        rate,
        cola: tx,
        hijo,
        hilo: Some(hilo),
        terminada,
        error,
        perdidos: Arc::new(AtomicU64::new(0)),
    });
    Ok(estado_de(&g))
}

/// Deja un trozo en la cola de los audífonos. Nunca espera (ver la cabecera).
fn empujar(trozo: Vec<u8>) -> Result<(), String> {
    let g = bloquear();
    let Some(s) = g.as_ref() else {
        return Err("Los audífonos no están abiertos".to_string());
    };
    if s.terminada.load(Ordering::Relaxed) {
        let e = s.error.lock().unwrap_or_else(|e| e.into_inner()).clone();
        return Err(e.unwrap_or_else(|| "Los audífonos se cerraron".to_string()));
    }
    match s.cola.try_send(trozo) {
        Ok(()) => Ok(()),
        Err(TrySendError::Full(_)) => {
            s.perdidos.fetch_add(1, Ordering::Relaxed);
            Ok(())
        }
        Err(TrySendError::Disconnected(_)) => Err("Los audífonos se cerraron".to_string()),
    }
}

/// Si los audífonos están sonando por `sink`, se cierran. Lo llama el cambio
/// de salida principal: la música va a ir por ahí.
pub fn cerrar_si_usa(sink: &str) {
    let mut g = bloquear();
    if g.as_ref().is_some_and(|s| s.sink == sink) {
        cerrar_sesion(&mut g);
        eprintln!("[cue] cerrado: la salida principal pasa a {sink}");
    }
}

/// Al cerrar la app: que no quede un pacat huérfano.
pub fn cerrar_al_salir() {
    cerrar_sesion(&mut bloquear());
}

// ---------------------------------------------------------------------------
// Comandos (fuera del hilo de la ventana: regla 9)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn cue_abrir(sink: String, rate: u32) -> Result<EstadoCue, String> {
    en_otro_hilo(move || abrir_sinc(sink, rate)).await
}

#[tauri::command]
pub async fn cue_cerrar() -> Result<(), String> {
    en_otro_hilo(|| {
        cerrar_sesion(&mut bloquear());
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn cue_estado() -> Result<EstadoCue, String> {
    en_otro_hilo(|| Ok(estado_de(&bloquear()))).await
}

/// Un trozo de sonido de los audífonos: el cuerpo de la llamada son los bytes
/// en crudo (s16le estéreo intercalado), sin pasar por JSON.
#[tauri::command]
pub async fn cue_datos(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("cue_datos espera bytes en crudo".to_string());
    };
    empujar(bytes.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Con sonido de verdad (salida de pega `module-null-sink`): abre, recibe
    /// trozos sin esperar, y cerrar no deja pacat vivo.
    #[test]
    #[ignore = "necesita pactl y pacat con un servidor de sonido"]
    fn abre_recibe_y_cierra() {
        let _c = crate::CANDADO_SONIDO.lock().unwrap_or_else(|e| e.into_inner());
        let m = clean_command("pactl")
            .args(["load-module", "module-null-sink", "sink_name=cue_prueba"])
            .output()
            .expect("pactl");
        let modulo = String::from_utf8_lossy(&m.stdout).trim().to_string();
        // La "cabina" es otra salida de pega: por la de la música no se abre.
        let mm = clean_command("pactl")
            .args(["load-module", "module-null-sink", "sink_name=cue_musica"])
            .output()
            .expect("pactl");
        let modulo_musica = String::from_utf8_lossy(&mm.stdout).trim().to_string();
        let _ = clean_command("pactl").args(["set-default-sink", "cue_musica"]).output();
        assert!(abrir_sinc("cue_musica".into(), 48000).is_err(), "nunca por la salida de la música");
        let e = abrir_sinc("cue_prueba".into(), 48000).expect("abre");
        assert!(e.abierto);
        let trozo = vec![0u8; 2048 * 4];
        let t0 = std::time::Instant::now();
        for _ in 0..200 {
            empujar(trozo.clone()).expect("empuja");
        }
        // 200 trozos (~8,5 s de sonido) sin esperar nunca a pacat.
        assert!(t0.elapsed() < std::time::Duration::from_millis(500), "empujar no puede esperar");
        std::thread::sleep(std::time::Duration::from_millis(300));
        let flujos = crate::salida_audio::list_streams().unwrap_or_default();
        assert!(flujos.iter().any(|s| s.app == crate::preescucha::CLIENTE), "el flujo existe con su nombre");
        cerrar_al_salir();
        std::thread::sleep(std::time::Duration::from_millis(300));
        let flujos = crate::salida_audio::list_streams().unwrap_or_default();
        assert!(!flujos.iter().any(|s| s.app == crate::preescucha::CLIENTE), "cerrar no deja pacat vivo");
        assert!(empujar(trozo).is_err(), "cerrado, avisa");
        let _ = clean_command("pactl").args(["unload-module", &modulo]).output();
        let _ = clean_command("pactl").args(["unload-module", &modulo_musica]).output();
    }
}
