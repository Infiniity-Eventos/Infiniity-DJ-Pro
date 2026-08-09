//! Punto central del backend de Infiniity DJ.
//! Registra los comandos que el frontend (React) puede llamar.

mod bpm;
mod cache;
mod ddj200;
mod downloader;
mod library;
mod midi;
mod sysmon;

use cache::{track_key, Cache, TrackMeta};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::Manager;

pub struct AppState {
    pub cache: Mutex<Cache>,
    pub midi: Mutex<midi::MidiState>,
    pub cpu_prev: Mutex<Option<sysmon::CpuSample>>,
}

fn modified_secs(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Biblioteca musical
// ---------------------------------------------------------------------------

#[tauri::command]
fn read_library(root: String, state: tauri::State<AppState>) -> Result<library::LibraryData, String> {
    let cache = state.cache.lock().map_err(|_| "cache ocupado".to_string())?;
    library::read_library(&root, &cache)
}

#[tauri::command]
fn move_track(from: String, to_folder: String) -> Result<String, String> {
    library::move_track(&from, &to_folder)
}

#[tauri::command]
fn create_folder(parent: String, name: String) -> Result<String, String> {
    library::create_folder(&parent, &name)
}

#[tauri::command]
fn ensure_unclassified(root: String) -> Result<String, String> {
    library::ensure_unclassified(&root)
}

/// Lee un archivo de audio y devuelve sus bytes crudos.
/// En Linux/WebKitGTK, el reproductor (GStreamer) no puede leer archivos por el
/// protocolo interno de assets; entregar los bytes y armar un Blob en el frontend
/// es la via mas compatible. La respuesta se envia como bytes crudos (rapido, sin
/// convertir a JSON).
#[tauri::command]
fn read_media(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("No se pudo leer el archivo: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Recursos que consume la app AHORA (RAM real y CPU%), sumando todos sus procesos.
/// Ademas registra la muestra en el archivo de diagnostico (para medir en el
/// equipo real). `note` describe que esta haciendo la app en ese momento.
#[tauri::command]
fn system_stats(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    note: String,
) -> Result<sysmon::Stats, String> {
    let stats = {
        let mut prev = state.cpu_prev.lock().map_err(|_| "monitor ocupado".to_string())?;
        sysmon::read_stats(&mut prev)
    };
    sysmon::log_sample(&app, &stats, &note);
    Ok(stats)
}

/// Abre la carpeta donde queda el archivo de diagnostico (para enviarlo).
#[tauri::command]
fn diag_reveal(app: tauri::AppHandle) -> Result<(), String> {
    let path = sysmon::diag_path(&app);
    let dir = path.parent().unwrap_or(&path);
    std::process::Command::new("xdg-open")
        .arg(dir)
        .spawn()
        .map_err(|e| format!("No se pudo abrir la carpeta: {e}"))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Analisis de BPM
// ---------------------------------------------------------------------------

#[tauri::command]
async fn analyze_bpm(
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<TrackMeta, String> {
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    let key = track_key(&path, meta.len(), modified_secs(&meta));

    // Si ya esta en cache (y no fue borrado), no re-analizar.
    {
        let c = state.cache.lock().map_err(|_| "cache ocupado".to_string())?;
        if let Some(m) = c.get(&key) {
            if m.bpm.is_some() {
                return Ok(m);
            }
        }
    }

    // Trabajo pesado en un hilo aparte: no traba la interfaz.
    let path_for_thread = path.clone();
    let result = tauri::async_runtime::spawn_blocking(move || bpm::analyze(&path_for_thread))
        .await
        .map_err(|e| e.to_string())??;

    let m = TrackMeta {
        bpm: Some(result.bpm),
        duration: Some(result.duration),
        manual: false,
    };
    {
        let mut c = state.cache.lock().map_err(|_| "cache ocupado".to_string())?;
        c.set(key, m.clone());
    }
    Ok(m)
}

#[tauri::command]
fn set_manual_bpm(
    path: String,
    bpm: f32,
    state: tauri::State<AppState>,
) -> Result<TrackMeta, String> {
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    let key = track_key(&path, meta.len(), modified_secs(&meta));
    let mut c = state.cache.lock().map_err(|_| "cache ocupado".to_string())?;
    let mut m = c.get(&key).unwrap_or_default();
    m.bpm = Some((bpm * 10.0).round() / 10.0);
    m.manual = true;
    c.set(key, m.clone());
    Ok(m)
}

// ---------------------------------------------------------------------------
// Controladora DDJ-200 (MIDI)
// ---------------------------------------------------------------------------

#[tauri::command]
fn midi_list() -> Vec<String> {
    midi::list_ports()
}

#[tauri::command]
fn midi_connect(app: tauri::AppHandle, state: tauri::State<AppState>) -> Result<String, String> {
    let (conn, name) = midi::connect(app)?;
    let mut m = state.midi.lock().map_err(|_| "midi ocupado".to_string())?;
    m.conn = Some(conn);
    m.port_name = Some(name.clone());
    Ok(name)
}

#[tauri::command]
fn midi_disconnect(state: tauri::State<AppState>) -> Result<(), String> {
    let mut m = state.midi.lock().map_err(|_| "midi ocupado".to_string())?;
    m.conn = None; // al soltar la conexion se cierra
    m.port_name = None;
    Ok(())
}

// ---------------------------------------------------------------------------
// Control de la ventana
// ---------------------------------------------------------------------------

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn minimize_window(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn toggle_fullscreen(window: tauri::Window) -> Result<bool, String> {
    let is_full = window.is_fullscreen().map_err(|e| e.to_string())?;
    window.set_fullscreen(!is_full).map_err(|e| e.to_string())?;
    Ok(!is_full)
}

// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState {
            cache: Mutex::new(Cache::default()),
            midi: Mutex::new(midi::MidiState::default()),
            cpu_prev: Mutex::new(None),
        })
        .setup(|app| {
            // Cargar el cache de BPM desde la carpeta de datos de la app.
            let dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            let cache_path = dir.join("bpm_cache.json");
            let loaded = Cache::load(cache_path);
            if let Ok(mut c) = app.state::<AppState>().cache.lock() {
                *c = loaded;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_library,
            move_track,
            create_folder,
            ensure_unclassified,
            read_media,
            system_stats,
            diag_reveal,
            downloader::ytdl_tools,
            downloader::ytdl_search,
            downloader::ytdl_download,
            downloader::ytdl_install,
            analyze_bpm,
            set_manual_bpm,
            midi_list,
            midi_connect,
            midi_disconnect,
            quit_app,
            minimize_window,
            toggle_fullscreen
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar Infiniity DJ");
}
