//! Descarga de audio desde YouTube (y otros sitios) con yt-dlp.
//!
//! Pipeline: yt-dlp descarga el mejor audio -> ffmpeg lo pasa a MP3 -> queda en
//! la carpeta "Sin clasificar" de la biblioteca, listo para mezclar.
//!
//! Herramientas necesarias (se detectan; si faltan, se pueden instalar solas):
//!   - yt-dlp : el descargador.
//!   - deno   : motor JS que yt-dlp necesita para resolver los retos de YouTube.
//!   - ffmpeg : convierte a MP3.

use serde::Serialize;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter, Manager};

const YTDLP_URL: &str =
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";
const DENO_URL: &str =
    "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip";

#[derive(Serialize, Clone)]
pub struct Tools {
    pub ytdlp: Option<String>,
    pub deno: Option<String>,
    pub ffmpeg: Option<String>,
    pub ready: bool, // true si estan yt-dlp + deno + ffmpeg
}

#[derive(Serialize, Clone)]
struct Progress {
    id: String, // identifica la descarga (para varias a la vez)
    percent: f64,
    stage: String, // "descargando" | "convirtiendo" | "listo" | "error"
    message: String,
}

/// Carpeta gestionada por la app donde guardamos las herramientas descargadas.
fn app_bin_dir(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("bin");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Busca un ejecutable por el PATH del sistema.
fn search_path(name: &str) -> Option<String> {
    let path = std::env::var("PATH").ok()?;
    for dir in path.split(':') {
        let p = Path::new(dir).join(name);
        if p.is_file() {
            return Some(p.to_string_lossy().into_owned());
        }
    }
    None
}

/// Devuelve la primera ruta existente entre varias candidatas.
fn first_existing(cands: &[PathBuf]) -> Option<String> {
    cands
        .iter()
        .find(|p| p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
}

pub fn resolve_tools(app: &AppHandle) -> Tools {
    let bin = app_bin_dir(app);
    let home = std::env::var("HOME").unwrap_or_default();
    let h = Path::new(&home);

    let ytdlp = first_existing(&[
        bin.join("yt-dlp"),
        bin.join("yt-dlp_linux"),
        h.join(".local/bin/yt-dlp"),
    ])
    .or_else(|| search_path("yt-dlp"));

    let deno = first_existing(&[bin.join("deno"), h.join(".deno/bin/deno")])
        .or_else(|| search_path("deno"));

    let ffmpeg = search_path("ffmpeg");

    let ready = ytdlp.is_some() && deno.is_some() && ffmpeg.is_some();
    Tools {
        ytdlp,
        deno,
        ffmpeg,
        ready,
    }
}

#[tauri::command]
pub fn ytdl_tools(app: AppHandle) -> Tools {
    resolve_tools(&app)
}

#[derive(Serialize, Clone)]
pub struct SearchResult {
    pub id: String,
    pub title: String,
    pub duration: Option<u64>,
    pub channel: String,
}

/// Busca en YouTube (sin API key: usa la busqueda propia de yt-dlp).
#[tauri::command]
pub async fn ytdl_search(app: AppHandle, query: String) -> Result<Vec<SearchResult>, String> {
    tauri::async_runtime::spawn_blocking(move || do_search(&app, &query))
        .await
        .map_err(|e| e.to_string())?
}

fn do_search(app: &AppHandle, query: &str) -> Result<Vec<SearchResult>, String> {
    let tools = resolve_tools(app);
    let ytdlp = tools.ytdlp.ok_or("yt-dlp no esta instalado")?;
    let q = query.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let search = format!("ytsearch12:{q}");

    let mut cmd = Command::new(&ytdlp);
    cmd.args([
        "--flat-playlist",
        "--no-warnings",
        "--ignore-errors",
        "--print",
        "%(id)s\t%(title)s\t%(duration)s\t%(channel)s",
    ]);
    if let Some(deno) = &tools.deno {
        cmd.args(["--js-runtimes", &format!("deno:{deno}")]);
    }
    cmd.arg(&search);

    let output = cmd
        .output()
        .map_err(|e| format!("No se pudo buscar: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    let mut results = Vec::new();
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 4 || parts[0].is_empty() {
            continue;
        }
        results.push(SearchResult {
            id: parts[0].to_string(),
            title: parts[1].to_string(),
            duration: parts[2].parse::<f64>().ok().map(|d| d as u64),
            channel: parts[3].to_string(),
        });
    }
    Ok(results)
}

/// Descarga el audio de `url` como MP3 dentro de `dest_folder`.
/// Emite eventos "ytdl://progress" para la barra de progreso.
/// Devuelve la ruta del MP3 creado.
#[tauri::command]
pub async fn ytdl_download(
    app: AppHandle,
    url: String,
    dest_folder: String,
    id: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || do_download(&app, &url, &dest_folder, &id))
        .await
        .map_err(|e| e.to_string())?
}

fn emit_progress(app: &AppHandle, id: &str, percent: f64, stage: &str, message: &str) {
    let _ = app.emit(
        "ytdl://progress",
        Progress {
            id: id.to_string(),
            percent,
            stage: stage.to_string(),
            message: message.to_string(),
        },
    );
}

/// Convierte la salida de error de yt-dlp en un mensaje claro para el usuario.
fn friendly_error(stderr: &str) -> String {
    if stderr.contains("429") || stderr.contains("Too Many Requests") {
        return "YouTube limitó las descargas por ahora (demasiadas seguidas). \
                Espera 1-2 minutos y vuelve a intentar."
            .to_string();
    }
    if stderr.contains("Video unavailable") || stderr.contains("This video is unavailable") {
        return "Ese video no está disponible para descargar. Prueba con otro.".to_string();
    }
    if stderr.contains("Private video") {
        return "Ese video es privado. Prueba con otro.".to_string();
    }
    if stderr.contains("age") && stderr.contains("confirm") {
        return "Ese video tiene restricción de edad y no se puede bajar.".to_string();
    }
    // Buscar la última línea "ERROR:" real (ignorando los WARNING).
    if let Some(line) = stderr
        .lines()
        .rev()
        .find(|l| l.trim_start().starts_with("ERROR:"))
    {
        return line.trim().trim_start_matches("ERROR:").trim().to_string();
    }
    "No se pudo descargar (revisa el enlace o tu conexión).".to_string()
}

fn do_download(app: &AppHandle, url: &str, dest_folder: &str, id: &str) -> Result<String, String> {
    let tools = resolve_tools(app);
    let ytdlp = tools.ytdlp.ok_or("yt-dlp no esta instalado")?;
    let deno = tools.deno.ok_or("deno (motor JS) no esta instalado")?;
    let ffmpeg = tools.ffmpeg.ok_or("ffmpeg no esta instalado")?;
    let ffmpeg_dir = Path::new(&ffmpeg)
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();

    emit_progress(app, id, 0.0, "descargando", "Iniciando...");

    let out_template = format!("{dest_folder}/%(title)s.%(ext)s");
    let js_runtime = format!("deno:{deno}");

    // Prioridad BAJA (nice) para que descargar no le quite CPU a la mezcla en vivo.
    let mut child = Command::new("nice")
        .arg("-n")
        .arg("15")
        .arg(&ytdlp)
        .args([
            "-x",
            "--audio-format",
            "mp3",
            "--audio-quality",
            "0",
            "--no-playlist",
            "--newline",
            "--no-part",
            // Reintentos para aguantar los limites temporales de YouTube (429).
            "--extractor-retries",
            "3",
            "--retries",
            "10",
            "--retry-sleep",
            "3",
            "--js-runtimes",
            &js_runtime,
            "--ffmpeg-location",
            &ffmpeg_dir,
            "-o",
            &out_template,
            "--print",
            "after_move:filepath",
            url,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("No se pudo iniciar yt-dlp: {e}"))?;

    let mut final_path: Option<String> = None;
    if let Some(stdout) = child.stdout.take() {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            let l = line.trim();
            if l.starts_with("[download]") {
                // "[download]  15.2% of ..."
                if let Some(pct) = l
                    .split('%')
                    .next()
                    .and_then(|s| s.rsplit(|c: char| c.is_whitespace()).next())
                    .and_then(|s| s.parse::<f64>().ok())
                {
                    emit_progress(app, id, pct, "descargando", "Descargando audio...");
                }
            } else if l.starts_with("[ExtractAudio]") {
                emit_progress(app, id, 100.0, "convirtiendo", "Convirtiendo a MP3...");
            } else if l.starts_with('/') && l.ends_with(".mp3") {
                final_path = Some(l.to_string());
            }
        }
    }

    let status = child.wait().map_err(|e| e.to_string())?;
    if !status.success() {
        let mut errbuf = String::new();
        if let Some(mut s) = child.stderr.take() {
            let _ = s.read_to_string(&mut errbuf);
        }
        emit_progress(app, id, 0.0, "error", "No se pudo descargar");
        return Err(friendly_error(&errbuf));
    }

    emit_progress(app, id, 100.0, "listo", "¡Descarga completa!");
    final_path.ok_or_else(|| "Descarga completa pero no se encontro el archivo".to_string())
}

/// Instala yt-dlp y deno en la carpeta de la app (sin permisos de administrador).
#[tauri::command]
pub async fn ytdl_install(app: AppHandle) -> Result<Tools, String> {
    tauri::async_runtime::spawn_blocking(move || do_install(&app))
        .await
        .map_err(|e| e.to_string())?
}

fn set_executable(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(path) {
            let mut perms = meta.permissions();
            perms.set_mode(0o755);
            let _ = std::fs::set_permissions(path, perms);
        }
    }
}

fn do_install(app: &AppHandle) -> Result<Tools, String> {
    let bin = app_bin_dir(app);
    emit_progress(app, "__install__", 0.0, "descargando", "Instalando descargador...");

    // yt-dlp (binario standalone, no necesita Python en el equipo destino).
    let ytdlp_path = bin.join("yt-dlp");
    if !ytdlp_path.is_file() {
        let ok = Command::new("curl")
            .args(["-L", "-s", YTDLP_URL, "-o"])
            .arg(&ytdlp_path)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !ok || !ytdlp_path.is_file() {
            return Err("No se pudo descargar yt-dlp".to_string());
        }
        set_executable(&ytdlp_path);
    }

    emit_progress(app, "__install__", 50.0, "descargando", "Instalando motor JS (Deno)...");

    // deno (viene en .zip; lo extraemos con python3, que casi siempre esta).
    let deno_path = bin.join("deno");
    if !deno_path.is_file() {
        let zip = bin.join("deno.zip");
        let ok = Command::new("curl")
            .args(["-L", "-s", DENO_URL, "-o"])
            .arg(&zip)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !ok || !zip.is_file() {
            return Err("No se pudo descargar Deno".to_string());
        }
        let unz = Command::new("python3")
            .arg("-m")
            .arg("zipfile")
            .arg("-e")
            .arg(&zip)
            .arg(&bin)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        let _ = std::fs::remove_file(&zip);
        if !unz || !deno_path.is_file() {
            return Err("No se pudo descomprimir Deno".to_string());
        }
        set_executable(&deno_path);
    }

    emit_progress(app, "__install__", 100.0, "listo", "Descargador instalado");
    Ok(resolve_tools(app))
}
