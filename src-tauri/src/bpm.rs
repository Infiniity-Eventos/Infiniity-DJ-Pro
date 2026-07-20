//! Analisis de BPM (pulsos por minuto) 100% en Rust.
//!
//! Decodifica MP3/WAV con `symphonia` (sin dependencias del sistema, para que
//! compile igual en Mint y Fedora) y estima el tempo con un metodo de
//! auto-correlacion + filtro peine sobre la "envolvente de ataques" (onsets).
//!
//! Se ejecuta en un hilo aparte (ver `analyze_bpm` en lib.rs) para NO trabar
//! la interfaz. Para equipos de gama baja limitamos el analisis a los primeros
//! ~120 segundos, que es mas que suficiente para generos de tempo constante
//! (merengue, salsa, vallenato, etc.).

use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

pub struct AnalyzeResult {
    pub bpm: f32,
    pub duration: f32,
}

// Rango de tempos considerado. Fuera de aqui casi nunca cae musica bailable.
const MIN_BPM: f32 = 70.0;
const MAX_BPM: f32 = 180.0;
// Tamano de ventana para la envolvente de energia (en muestras).
const HOP: usize = 512;
// Cuantos segundos analizar como maximo (rendimiento en gama baja).
const MAX_SECONDS: f32 = 120.0;

pub fn analyze(path: &str) -> Result<AnalyzeResult, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("No se pudo abrir: {e}"))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(path).extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions {
                enable_gapless: true,
                ..Default::default()
            },
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("Formato no reconocido: {e}"))?;

    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| "El archivo no tiene pista de audio".to_string())?;
    let track_id = track.id;
    let sample_rate = track.codec_params.sample_rate.unwrap_or(44100) as f32;

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("No se pudo decodificar: {e}"))?;

    // Envolvente de energia (una muestra RMS cada HOP muestras) y acumuladores.
    let mut envelope: Vec<f32> = Vec::new();
    let mut acc = 0.0f32;
    let mut acc_count = 0usize;
    let mut total_frames: u64 = 0;

    let frame_rate = sample_rate / HOP as f32; // cuadros de envolvente por segundo
    let max_env_frames = (MAX_SECONDS * frame_rate) as usize;

    let mut sample_buf: Option<SampleBuffer<f32>> = None;

    'outer: loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymError::IoError(ref e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(SymError::ResetRequired) => break,
            Err(_) => break,
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(SymError::DecodeError(_)) => continue,
            Err(_) => break,
        };

        let spec = *decoded.spec();
        let channels = spec.channels.count().max(1);

        // (Re)usar un buffer de muestras intercaladas en f32.
        if sample_buf.is_none() {
            let dur = decoded.capacity() as u64;
            sample_buf = Some(SampleBuffer::<f32>::new(dur, spec));
        }
        let sbuf = sample_buf.as_mut().unwrap();
        sbuf.copy_interleaved_ref(decoded);
        let samples = sbuf.samples();
        let frames = samples.len() / channels;
        total_frames += frames as u64;

        for f in 0..frames {
            // Mezclar canales a mono.
            let mut mono = 0.0f32;
            for c in 0..channels {
                mono += samples[f * channels + c];
            }
            mono /= channels as f32;

            acc += mono * mono;
            acc_count += 1;
            if acc_count == HOP {
                envelope.push((acc / HOP as f32).sqrt());
                acc = 0.0;
                acc_count = 0;
                if envelope.len() >= max_env_frames {
                    // Seguimos contando la duracion total mas abajo si hiciera falta,
                    // pero para el tempo con 2 minutos basta.
                    break 'outer;
                }
            }
        }
    }

    // Si cortamos temprano, estimamos la duracion total leyendo el resto del
    // conteo aproximado ya acumulado. Para mostrar duracion exacta el frontend
    // usa el propio reproductor; aqui damos una estimacion util.
    let duration = if total_frames > 0 {
        total_frames as f32 / sample_rate
    } else {
        0.0
    };

    let bpm = estimate_bpm(&envelope, frame_rate);
    Ok(AnalyzeResult { bpm, duration })
}

/// Estima el BPM a partir de la envolvente de ataques.
fn estimate_bpm(envelope: &[f32], frame_rate: f32) -> f32 {
    if envelope.len() < 32 {
        return 0.0;
    }

    // Envolvente de ataques (onsets): solo los aumentos de energia.
    let mut onset: Vec<f32> = Vec::with_capacity(envelope.len());
    onset.push(0.0);
    for i in 1..envelope.len() {
        let d = envelope[i] - envelope[i - 1];
        onset.push(if d > 0.0 { d } else { 0.0 });
    }

    // Quitar la media para centrar la senal (mejora la auto-correlacion).
    let mean = onset.iter().sum::<f32>() / onset.len() as f32;
    for v in onset.iter_mut() {
        *v -= mean;
    }

    let n = onset.len();
    // Lag maximo: cubre hasta 4 veces el periodo del tempo mas lento (para el peine).
    let max_lag = ((frame_rate * 60.0 / MIN_BPM).ceil() as usize * 4 + 2).min(n - 1);

    // Auto-correlacion.
    let mut ac = vec![0.0f32; max_lag + 1];
    for lag in 1..=max_lag {
        let mut s = 0.0f32;
        for i in lag..n {
            s += onset[i] * onset[i - lag];
        }
        ac[lag] = s;
    }

    // Filtro peine: para cada tempo candidato sumamos la correlacion en el
    // periodo y sus multiplos. Esto ancla el tempo "fundamental" y evita el
    // clasico error de detectar el doble o la mitad.
    let mut best_bpm = 0.0f32;
    let mut best_score = f32::MIN;
    let mut bpm = MIN_BPM;
    while bpm <= MAX_BPM {
        let period = frame_rate * 60.0 / bpm; // en cuadros
        let mut score = 0.0f32;
        for k in 1..=4 {
            let lag = period * k as f32;
            let li = lag.floor() as usize;
            if li >= 1 && li + 1 <= max_lag {
                let frac = lag - li as f32;
                let v = ac[li] * (1.0 - frac) + ac[li + 1] * frac;
                score += v / k as f32; // los multiplos altos pesan menos
            }
        }
        if score > best_score {
            best_score = score;
            best_bpm = bpm;
        }
        bpm += 0.1;
    }

    // Redondear a 1 decimal.
    (best_bpm * 10.0).round() / 10.0
}
