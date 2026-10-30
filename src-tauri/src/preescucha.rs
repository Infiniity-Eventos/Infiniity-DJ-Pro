//! PRE-ESCUCHA: oír en audífonos de CABLE una canción mientras la cabina
//! sigue con la suya (pedido del equipo el 30-oct: "para saber cómo suena la
//! otra canción que sigue").
//!
//! POR QUE NO VA POR EL MOTOR WEB (medido el 30-oct en este PC): una segunda
//! conexión de sonido del navegador interno sale al sistema IDÉNTICA a la
//! principal (mismo programa, mismo nombre, `media.role = webaudio`), y el
//! sistema recuerda la salida para todas juntas
//! (`sink-input-by-media-role:webaudio`). Mandarla a los audífonos dejaba
//! apuntado "el sonido de la app va a los audífonos": la siguiente vez que la
//! app rehiciera su conexión principal, la cabina se quedaba muda.
//!
//! Por eso la pre-escucha la toca un programa APARTE, `pacat` (viene en el
//! mismo paquete que `pactl`, que la app ya exige), con nombre propio
//! (`CLIENTE`) y dirigido directamente a la salida de los audífonos. El
//! sistema nunca lo confunde con el sonido de la cabina, y `stream_is_ours`
//! lo deja fuera de todo lo que mueve o mide la salida principal.
//!
//! La canción se decodifica aquí (symphonia, como el análisis de BPM) y se le
//! pasa a `pacat` en crudo por su entrada. El ritmo lo marca `pacat`: la
//! tubería se llena y la escritura espera, así que no hace falta reloj.

use std::io::{Read, Write};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymError;
use symphonia::core::formats::{FormatOptions, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::units::Time;

use crate::downloader::clean_command;
use crate::en_otro_hilo;

/// Nombre de programa con el que `pacat` se presenta al sistema
/// (`application.name`). `salida_audio::stream_is_ours` lo excluye por él.
pub const CLIENTE: &str = "infiniity-preescucha";

/// Lo que hay entre lo escrito y lo que ya se oye (tubería + margen de
/// `pacat`), para que la posición en pantalla no vaya adelantada.
const RETARDO_S: f64 = 0.3;

struct Sesion {
    parar: Arc<AtomicBool>,
    hijo: Arc<Mutex<Option<Child>>>,
    hilo: Option<std::thread::JoinHandle<()>>,
    ruta: String,
    sink: String,
    /// Segundo de la canción donde empezó a sonar esta vez.
    inicio: Arc<Mutex<f64>>,
    escritos: Arc<AtomicU64>,
    rate: Arc<AtomicU32>,
    duracion: Arc<Mutex<f64>>,
    error: Arc<Mutex<Option<String>>>,
    terminada: Arc<AtomicBool>,
}

static SESION: Mutex<Option<Sesion>> = Mutex::new(None);
/// Volumen de la pre-escucha en porcentaje (0-100).
static VOLUMEN: AtomicU32 = AtomicU32::new(80);

#[derive(Serialize, Clone, Default)]
pub struct EstadoPreescucha {
    /// Está sonando ahora mismo.
    pub sonando: bool,
    pub ruta: String,
    pub sink: String,
    pub posicion: f64,
    pub duracion: f64,
    /// Por qué se paró sola (falló `pacat`, el formato...). Se muestra.
    pub error: Option<String>,
    pub volumen: u32,
}

fn bloquear() -> std::sync::MutexGuard<'static, Option<Sesion>> {
    SESION.lock().unwrap_or_else(|e| e.into_inner())
}

fn estado_de(s: &Sesion) -> EstadoPreescucha {
    let rate = s.rate.load(Ordering::Relaxed).max(1) as f64;
    let inicio = *s.inicio.lock().unwrap_or_else(|e| e.into_inner());
    let duracion = *s.duracion.lock().unwrap_or_else(|e| e.into_inner());
    let oido = (s.escritos.load(Ordering::Relaxed) as f64 / rate - RETARDO_S).max(0.0);
    let terminada = s.terminada.load(Ordering::Relaxed);
    EstadoPreescucha {
        sonando: !terminada,
        ruta: s.ruta.clone(),
        sink: s.sink.clone(),
        posicion: if duracion > 0.0 { (inicio + oido).min(duracion) } else { inicio + oido },
        duracion,
        error: s.error.lock().unwrap_or_else(|e| e.into_inner()).clone(),
        volumen: VOLUMEN.load(Ordering::Relaxed),
    }
}

/// Para la sesión en curso (si hay) y devuelve cómo quedó.
fn parar_sesion(g: &mut Option<Sesion>) -> EstadoPreescucha {
    let Some(mut s) = g.take() else { return EstadoPreescucha { volumen: VOLUMEN.load(Ordering::Relaxed), ..Default::default() } };
    let mut e = estado_de(&s);
    s.parar.store(true, Ordering::Relaxed);
    if let Some(h) = s.hijo.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
        // Matarlo desbloquea la escritura del hilo (tubería rota).
        if let Err(err) = h.kill() {
            eprintln!("[preescucha] no se pudo parar pacat: {err}");
        }
        let _ = h.wait();
    }
    if let Some(hilo) = s.hilo.take() {
        let _ = hilo.join();
    }
    e.sonando = false;
    e
}

/// Si la pre-escucha está sonando por `sink`, se para. Lo llama el cambio de
/// salida principal: la música va a ir por ahí.
pub fn parar_si_usa(sink: &str) {
    let mut g = bloquear();
    if g.as_ref().is_some_and(|s| s.sink == sink && !s.terminada.load(Ordering::Relaxed)) {
        if let Some(s) = g.as_ref() {
            *s.error.lock().unwrap_or_else(|e| e.into_inner()) =
                Some("Se paró: la música ahora sale por esa misma salida.".to_string());
        }
        let e = parar_sesion(&mut g);
        // Se deja la sesión parada a la vista para que la interfaz lea el porqué.
        eprintln!("[preescucha] parada: la salida principal pasa a {sink} ({:?})", e.error);
        *g = Some(sesion_parada(e));
    }
}

/// Una sesión quieta que recuerda dónde quedó (para la pausa y para decir por
/// qué se paró). Sin ella, el estado volvía a 0:00 y "seguir" empezaba de nuevo.
fn sesion_parada(e: EstadoPreescucha) -> Sesion {
    Sesion {
        parar: Arc::new(AtomicBool::new(true)),
        hijo: Arc::new(Mutex::new(None)),
        hilo: None,
        ruta: e.ruta,
        sink: e.sink,
        inicio: Arc::new(Mutex::new(e.posicion)),
        escritos: Arc::new(AtomicU64::new(0)),
        rate: Arc::new(AtomicU32::new(1)),
        duracion: Arc::new(Mutex::new(e.duracion)),
        error: Arc::new(Mutex::new(e.error)),
        terminada: Arc::new(AtomicBool::new(true)),
    }
}

fn tocar_sinc(ruta: String, desde: f64, sink: String) -> Result<EstadoPreescucha, String> {
    // Nunca por donde suena la música: la oiría todo el público.
    if let Some(principal) = crate::salida_audio::salida_principal() {
        if principal == sink {
            return Err("Esa es la misma salida por donde suena la música: la pre-escucha la oiría todo el mundo. Conecta la cabina por Bluetooth o por otra salida.".to_string());
        }
    }
    let mut g = bloquear();
    parar_sesion(&mut g);

    let parar = Arc::new(AtomicBool::new(false));
    let hijo: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
    let inicio = Arc::new(Mutex::new(desde.max(0.0)));
    let escritos = Arc::new(AtomicU64::new(0));
    let rate = Arc::new(AtomicU32::new(48000));
    let duracion = Arc::new(Mutex::new(0.0));
    let error: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let terminada = Arc::new(AtomicBool::new(false));

    let hilo = {
        let (parar, hijo, inicio, escritos, rate, duracion, error, terminada) = (
            parar.clone(),
            hijo.clone(),
            inicio.clone(),
            escritos.clone(),
            rate.clone(),
            duracion.clone(),
            error.clone(),
            terminada.clone(),
        );
        let (ruta, sink) = (ruta.clone(), sink.clone());
        std::thread::spawn(move || {
            let r = sonar(&ruta, desde, &sink, &parar, &hijo, &inicio, &escritos, &rate, &duracion);
            if let Err(e) = r {
                if !parar.load(Ordering::Relaxed) {
                    eprintln!("[preescucha] {e}");
                    *error.lock().unwrap_or_else(|e| e.into_inner()) = Some(e);
                }
            }
            terminada.store(true, Ordering::Relaxed);
        })
    };

    *g = Some(Sesion {
        parar,
        hijo,
        hilo: Some(hilo),
        ruta,
        sink,
        inicio,
        escritos,
        rate,
        duracion,
        error,
        terminada,
    });
    Ok(estado_de(g.as_ref().unwrap()))
}

/// Decodifica `ruta` desde `desde` y se lo pasa a `pacat` hasta el final o
/// hasta que pidan parar.
#[allow(clippy::too_many_arguments)]
fn sonar(
    ruta: &str,
    desde: f64,
    sink: &str,
    parar: &AtomicBool,
    hijo: &Mutex<Option<Child>>,
    inicio: &Mutex<f64>,
    escritos: &AtomicU64,
    rate_out: &AtomicU32,
    duracion: &Mutex<f64>,
) -> Result<(), String> {
    let file = std::fs::File::open(ruta).map_err(|e| format!("No se pudo abrir la canción: {e}"))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(ruta).extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions { enable_gapless: true, ..Default::default() }, &MetadataOptions::default())
        .map_err(|e| format!("La pre-escucha solo lee MP3 y WAV ({e})"))?;
    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or("La canción no tiene pista de audio")?;
    let track_id = track.id;
    let rate = track.codec_params.sample_rate.unwrap_or(44100);
    let canales = track.codec_params.channels.map(|c| c.count()).unwrap_or(2).clamp(1, 2);
    if let Some(n) = track.codec_params.n_frames {
        *duracion.lock().unwrap_or_else(|e| e.into_inner()) = n as f64 / rate as f64;
    }
    rate_out.store(rate, Ordering::Relaxed);
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("No se pudo decodificar: {e}"))?;

    if desde > 0.2 {
        match format.seek(SeekMode::Coarse, SeekTo::Time { time: Time::from(desde), track_id: Some(track_id) }) {
            Ok(fue) => {
                *inicio.lock().unwrap_or_else(|e| e.into_inner()) = fue.actual_ts as f64 / rate as f64;
                decoder.reset();
            }
            // Sin poder saltar, empieza desde el principio (y la posición lo dice).
            Err(e) => {
                eprintln!("[preescucha] no se pudo saltar a {desde:.1} s: {e}");
                *inicio.lock().unwrap_or_else(|e| e.into_inner()) = 0.0;
            }
        }
    }

    let mut p = clean_command("pacat")
        .args([
            "--playback",
            "--raw",
            "--format=float32le",
            &format!("--rate={rate}"),
            &format!("--channels={canales}"),
            &format!("--device={sink}"),
            &format!("--client-name={CLIENTE}"),
            "--stream-name=Pre-escucha",
            "--property=media.role=preescucha",
            "--latency-msec=150",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("No se pudo arrancar la pre-escucha (pacat): {e}"))?;
    let mut entrada = p.stdin.take().ok_or("pacat no abrió su entrada")?;
    let mut errores = p.stderr.take();
    *hijo.lock().unwrap_or_else(|e| e.into_inner()) = Some(p);

    let mut sbuf: Option<SampleBuffer<f32>> = None;
    let mut bytes: Vec<u8> = Vec::new();
    let mut fallo: Option<String> = None;
    while !parar.load(Ordering::Relaxed) {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymError::IoError(ref e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(e) => {
                fallo = Some(format!("Se cortó la lectura de la canción: {e}"));
                break;
            }
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(SymError::DecodeError(_)) => continue, // un trozo dañado: se salta
            Err(e) => {
                fallo = Some(format!("No se pudo decodificar: {e}"));
                break;
            }
        };
        let spec = *decoded.spec();
        let ch = spec.channels.count().max(1);
        if sbuf.as_ref().map_or(true, |b| b.capacity() < decoded.capacity() * ch) {
            sbuf = Some(SampleBuffer::<f32>::new(decoded.capacity() as u64, spec));
        }
        let b = sbuf.as_mut().unwrap();
        b.copy_interleaved_ref(decoded);
        let vol = VOLUMEN.load(Ordering::Relaxed) as f32 / 100.0;
        bytes.clear();
        let muestras = b.samples();
        let frames = muestras.len() / ch;
        for f in 0..frames {
            for c in 0..canales {
                let v = muestras[f * ch + c.min(ch - 1)] * vol;
                bytes.extend_from_slice(&v.to_le_bytes());
            }
        }
        if let Err(e) = entrada.write_all(&bytes) {
            if !parar.load(Ordering::Relaxed) {
                fallo = Some(format!("La salida de los audífonos se cerró ({e})"));
            }
            break;
        }
        escritos.fetch_add(frames as u64, Ordering::Relaxed);
    }
    // Fin: cerrar la entrada deja a pacat terminar lo que tiene y salir solo.
    drop(entrada);
    if !parar.load(Ordering::Relaxed) {
        if let Some(h) = hijo.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
            match h.wait() {
                Ok(st) if !st.success() && fallo.is_none() => {
                    let mut t = String::new();
                    if let Some(er) = errores.as_mut() {
                        let _ = er.read_to_string(&mut t);
                    }
                    fallo = Some(format!("pacat terminó con error: {}", t.trim()));
                }
                Ok(_) => {}
                Err(e) => eprintln!("[preescucha] esperando a pacat: {e}"),
            }
        }
    }
    match fallo {
        Some(f) => Err(f),
        None => Ok(()),
    }
}

// ---------------------------------------------------------------------------
// Comandos (todos fuera del hilo de la ventana: regla 9)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn preescucha_opciones() -> Result<crate::salida_audio::OpcionesPreescucha, String> {
    en_otro_hilo(crate::salida_audio::opciones_preescucha_sinc).await
}

#[tauri::command]
pub async fn preescucha_tocar(ruta: String, desde: f64, sink: String) -> Result<EstadoPreescucha, String> {
    en_otro_hilo(move || tocar_sinc(ruta, desde, sink)).await
}

#[tauri::command]
pub async fn preescucha_parar() -> Result<EstadoPreescucha, String> {
    en_otro_hilo(|| {
        let mut g = bloquear();
        let e = parar_sesion(&mut g);
        if !e.ruta.is_empty() {
            *g = Some(sesion_parada(e.clone()));
        }
        Ok(e)
    })
    .await
}

/// Async a propósito: mientras se arranca o se para la pre-escucha el candado
/// está tomado un momento, y el hilo de la ventana no puede esperar (regla 9).
#[tauri::command]
pub async fn preescucha_estado() -> Result<EstadoPreescucha, String> {
    en_otro_hilo(|| {
        Ok(match bloquear().as_ref() {
            Some(s) => estado_de(s),
            None => EstadoPreescucha { volumen: VOLUMEN.load(Ordering::Relaxed), ..Default::default() },
        })
    })
    .await
}

#[tauri::command]
pub fn preescucha_volumen(volumen: u32) {
    VOLUMEN.store(volumen.min(100), Ordering::Relaxed);
}

/// Al cerrar la app: que no quede un pacat sonando huérfano en los audífonos.
pub fn parar_al_salir() {
    parar_sesion(&mut bloquear());
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn pactl(args: &[&str]) -> String {
        let o = clean_command("pactl").env("LC_ALL", "C").args(args).output().expect("hace falta pactl");
        String::from_utf8_lossy(&o.stdout).to_string()
    }

    /// Índice y salida del flujo de la pre-escucha, si existe.
    fn flujo_preescucha() -> Option<(u32, String)> {
        let sinks = pactl(&["list", "short", "sinks"]);
        let streams = crate::salida_audio::list_streams().ok()?;
        let s = streams.iter().find(|s| s.app == CLIENTE)?;
        let sink = sinks
            .lines()
            .find_map(|l| {
                let mut c = l.split('\t');
                let i: u32 = c.next()?.parse().ok()?;
                let n = c.next()?;
                (i == s.sink).then(|| n.to_string())
            })
            .unwrap_or_default();
        Some((s.index, sink))
    }

    /// Lo que se le prometió al equipo, medido con el sonido de verdad (en
    /// salidas de pega, `module-null-sink`, y a volumen 0: no se oye nada):
    /// - la pre-escucha no puede ir por la salida de la música;
    /// - suena en la salida elegida, con su nombre propio;
    /// - la app NO la cuenta como suya (si no, al elegir la cabina la
    ///   arrastraría a la cabina);
    /// - pausar recuerda dónde iba;
    /// - si la música pasa a esa salida, la pre-escucha se para y lo dice.
    #[test]
    #[ignore = "necesita pactl, pacat y una canción en ~/Música"]
    fn preescucha_va_aparte_de_la_musica() {
        let _candado = crate::CANDADO_SONIDO.lock().unwrap_or_else(|e| e.into_inner());
        let mp3 = std::path::PathBuf::from(std::env::var("HOME").unwrap())
            .join("Música/Infiniity Dj Pro/Bachata/Amigo - Romeo Santos.mp3");
        assert!(mp3.is_file(), "falta la canción de prueba: {}", mp3.display());
        let mp3 = mp3.to_string_lossy().to_string();

        let m1 = pactl(&["load-module", "module-null-sink", "sink_name=djpre_cabina"]).trim().to_string();
        let m2 = pactl(&["load-module", "module-null-sink", "sink_name=djpre_audif"]).trim().to_string();
        struct Limpieza(Vec<String>, Option<Child>);
        impl Drop for Limpieza {
            fn drop(&mut self) {
                parar_al_salir();
                if let Some(h) = self.1.as_mut() {
                    let _ = h.kill();
                    let _ = h.wait();
                }
                for m in &self.0 {
                    let _ = clean_command("pactl").args(["unload-module", m]).status();
                }
            }
        }
        // La "música": un hijo nuestro sonando (silencio) en la cabina de pega.
        let musica = clean_command("pacat")
            .args(["--playback", "--raw", "--device=djpre_cabina"])
            .stdin(std::fs::File::open("/dev/zero").unwrap())
            .spawn()
            .expect("hace falta pacat");
        let _limpieza = Limpieza(vec![m1, m2], Some(musica));
        for _ in 0..50 {
            if crate::salida_audio::salida_principal().as_deref() == Some("djpre_cabina") {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        assert_eq!(crate::salida_audio::salida_principal().as_deref(), Some("djpre_cabina"));

        // 1. Nunca por la salida de la música.
        assert!(tocar_sinc(mp3.clone(), 30.0, "djpre_cabina".into()).is_err());

        // 2. Suena en los audífonos, con su nombre, desde el segundo 30.
        VOLUMEN.store(0, Ordering::Relaxed);
        tocar_sinc(mp3.clone(), 30.0, "djpre_audif".into()).expect("no arrancó");
        let mut visto = None;
        for _ in 0..50 {
            std::thread::sleep(Duration::from_millis(100));
            visto = flujo_preescucha();
            if visto.is_some() {
                break;
            }
        }
        let (_, sink) = visto.expect("el flujo de la pre-escucha no apareció");
        assert_eq!(sink, "djpre_audif");

        // 3. La app no la cuenta como suya: la principal sigue siendo la cabina
        //    y entre "nuestros" flujos no está la pre-escucha.
        let nuestros: Vec<_> = crate::salida_audio::list_streams()
            .unwrap()
            .into_iter()
            .filter(crate::salida_audio::stream_is_ours)
            .collect();
        assert!(nuestros.iter().all(|s| s.app != CLIENTE));
        assert_eq!(crate::salida_audio::salida_principal().as_deref(), Some("djpre_cabina"));

        // 4. Avanza al ritmo de la canción y pausar recuerda dónde iba.
        std::thread::sleep(Duration::from_secs(2));
        let e = bloquear().as_ref().map(estado_de).unwrap();
        assert!(e.sonando, "{:?}", e.error);
        assert!(e.posicion > 30.5 && e.posicion < 34.0, "posición rara: {}", e.posicion);
        assert!(e.duracion > 60.0, "duración rara: {}", e.duracion);
        let parada = {
            let mut g = bloquear();
            let p = parar_sesion(&mut g);
            *g = Some(sesion_parada(p.clone()));
            p
        };
        std::thread::sleep(Duration::from_millis(300));
        assert!(flujo_preescucha().is_none(), "pacat siguió sonando tras pausar");
        let quieta = bloquear().as_ref().map(estado_de).unwrap();
        assert!(!quieta.sonando);
        assert!((quieta.posicion - parada.posicion).abs() < 0.01);

        // 5. Si la música pasa a la salida de los audífonos, se para y lo dice.
        tocar_sinc(mp3, quieta.posicion, "djpre_audif".into()).unwrap();
        std::thread::sleep(Duration::from_millis(800));
        parar_si_usa("djpre_audif");
        std::thread::sleep(Duration::from_millis(300));
        assert!(flujo_preescucha().is_none());
        let e = bloquear().as_ref().map(estado_de).unwrap();
        assert!(!e.sonando && e.error.is_some());
    }
}
