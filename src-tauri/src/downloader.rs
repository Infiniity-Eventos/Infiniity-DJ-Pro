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

/// Lanza un programa del sistema con el entorno LIMPIO.
///
/// POR QUE ESTO ES OBLIGATORIO: dentro de un AppImage se inyectan variables
/// que apuntan a las librerias de Ubuntu que viajan en el paquete. Si se las
/// heredamos a los programas del sistema, se rompen antes de arrancar:
///   - python3 -> "Failed to import encodings module" (PYTHONHOME apunta
///     dentro del AppImage, donde no existe la biblioteca estandar)
///   - curl    -> "symbol lookup error ... nghttp2" (mezcla el libcurl del
///     sistema con las librerias viejas del paquete)
/// Sin esta limpieza, instalar el descargador falla siempre en los equipos que
/// usan el AppImage, y ademas yt-dlp y ffmpeg tampoco correrian.
///
/// Nota: afecta SOLO a los procesos que lanzamos; la app sigue usando sus
/// propias librerias para dibujarse.
pub fn clean_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    for var in [
        "LD_LIBRARY_PATH",
        "LD_PRELOAD",
        "PYTHONHOME",
        "PYTHONPATH",
        "GTK_DATA_PREFIX",
        "GTK_EXE_PREFIX",
        "GTK_PATH",
        "GTK_IM_MODULE_FILE",
        "GDK_PIXBUF_MODULE_FILE",
        "GIO_EXTRA_MODULES",
        "GSETTINGS_SCHEMA_DIR",
    ] {
        cmd.env_remove(var);
    }
    cmd
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

    let mut cmd = clean_command(&ytdlp);
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
    let mut child = clean_command("nice")
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

    // Los mensajes de error se leen EN OTRO HILO, a la vez que el avance.
    //
    // POR QUE ES IMPRESCINDIBLE: la tuberia de mensajes de error tiene un
    // limite (unos 64 KB). Si se llena, yt-dlp se queda congelado esperando
    // poder escribir; como no termina, nosotros nunca llegamos a leerla, y como
    // no la leemos, el nunca se destraba. Los dos esperandose para siempre.
    // Eso dejaba la descarga clavada en 0% sin ningun error, y solo pasaba
    // dentro del programa: en una terminal los mensajes van a la pantalla, que
    // nunca se llena, por eso ahi funcionaba.
    let stderr = child.stderr.take();
    let hilo_errores = std::thread::spawn(move || {
        let mut texto = String::new();
        if let Some(mut s) = stderr {
            let _ = s.read_to_string(&mut texto);
        }
        texto
    });

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
    let errbuf = hilo_errores.join().unwrap_or_default();

    if !status.success() {
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

/// Traduce un fallo de red a algo que se entienda sin ser tecnico.
fn explicar_red(e: &reqwest::Error, que_hace: &str) -> String {
    if e.is_timeout() {
        return format!("Falló {que_hace}: se agotó el tiempo de espera. Internet muy lento o caído.");
    }
    if e.is_connect() {
        return format!(
            "Falló {que_hace}: no se pudo conectar. Revisa tu conexión a internet."
        );
    }
    if let Some(estado) = e.status() {
        return format!("Falló {que_hace}: el servidor respondió {estado}. Puede que GitHub esté caído.");
    }
    format!("Falló {que_hace}: {e}")
}

/// Descarga un archivo mostrando el avance.
///
/// Se descarga con el motor propio del programa, NO con curl. Antes se usaba
/// curl del sistema y la instalacion fallaba en unos equipos si y en otros no:
/// en una Fedora ajena daba "curl (77) error adding trust anchors", es decir
/// que el almacen de certificados del equipo estaba roto. Este motor lleva sus
/// propios certificados dentro, asi que no depende del estado del sistema.
fn descargar(
    app: &AppHandle,
    url: &str,
    destino: &Path,
    que_hace: &str,
    desde: f64,
    hasta: f64,
) -> Result<(), String> {
    let cliente = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(900))
        .build()
        .map_err(|e| format!("No se pudo preparar la descarga: {e}"))?;

    let mut resp = cliente
        .get(url)
        .send()
        .map_err(|e| explicar_red(&e, que_hace))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Falló {que_hace}: el servidor respondió {}.",
            resp.status()
        ));
    }

    let total = resp.content_length().unwrap_or(0);
    let mut archivo = std::fs::File::create(destino)
        .map_err(|e| format!("No se pudo guardar el archivo ({}): {e}", destino.display()))?;

    // Copia por trozos para poder ir informando el avance.
    let mut buffer = [0u8; 64 * 1024];
    let mut bajado: u64 = 0;
    loop {
        let n = std::io::Read::read(&mut resp, &mut buffer)
            .map_err(|e| format!("Se cortó {que_hace}: {e}"))?;
        if n == 0 {
            break;
        }
        std::io::Write::write_all(&mut archivo, &buffer[..n])
            .map_err(|e| format!("No se pudo escribir en el disco (¿lleno?): {e}"))?;
        bajado += n as u64;
        if total > 0 {
            let pct = desde + (bajado as f64 / total as f64) * (hasta - desde);
            emit_progress(app, "__install__", pct, "descargando", que_hace);
        }
    }

    Ok(())
}

/// Descomprime un .zip. Antes se llamaba a python3, que dentro del AppImage
/// ni siquiera arrancaba.
fn descomprimir(zip_path: &Path, destino: &Path) -> Result<(), String> {
    let archivo = std::fs::File::open(zip_path)
        .map_err(|e| format!("No se pudo abrir el archivo comprimido: {e}"))?;
    let mut zip = zip::ZipArchive::new(archivo)
        .map_err(|e| format!("El archivo comprimido está dañado: {e}"))?;

    for i in 0..zip.len() {
        let mut entrada = zip
            .by_index(i)
            .map_err(|e| format!("No se pudo leer el comprimido: {e}"))?;
        // enclosed_name() descarta rutas maliciosas tipo "../../algo".
        let Some(nombre) = entrada.enclosed_name() else {
            continue;
        };
        let salida = destino.join(nombre);
        if entrada.is_dir() {
            let _ = std::fs::create_dir_all(&salida);
            continue;
        }
        if let Some(padre) = salida.parent() {
            let _ = std::fs::create_dir_all(padre);
        }
        let mut f = std::fs::File::create(&salida)
            .map_err(|e| format!("No se pudo escribir {}: {e}", salida.display()))?;
        std::io::copy(&mut entrada, &mut f)
            .map_err(|e| format!("No se pudo descomprimir {}: {e}", salida.display()))?;
    }
    Ok(())
}

fn do_install(app: &AppHandle) -> Result<Tools, String> {
    let bin = app_bin_dir(app);
    emit_progress(app, "__install__", 0.0, "descargando", "Instalando descargador...");

    // Comprobar que se puede escribir donde vamos a instalar, antes de bajar
    // 110 MB para nada.
    if let Err(e) = std::fs::create_dir_all(&bin) {
        return Err(format!(
            "No se pudo crear la carpeta de instalación ({}): {e}",
            bin.display()
        ));
    }

    // yt-dlp (binario standalone, no necesita Python en el equipo destino).
    let ytdlp_path = bin.join("yt-dlp");
    if !ytdlp_path.is_file() {
        descargar(app, YTDLP_URL, &ytdlp_path, "la descarga de yt-dlp", 0.0, 45.0)?;
        if !ytdlp_path.is_file() {
            return Err("La descarga de yt-dlp terminó pero el archivo no quedó guardado.".to_string());
        }
        set_executable(&ytdlp_path);
    }

    // deno (viene en .zip).
    let deno_path = bin.join("deno");
    if !deno_path.is_file() {
        let zip_path = bin.join("deno.zip");
        descargar(app, DENO_URL, &zip_path, "la descarga de Deno", 45.0, 90.0)?;

        emit_progress(app, "__install__", 92.0, "descargando", "Descomprimiendo...");
        let resultado = descomprimir(&zip_path, &bin);
        let _ = std::fs::remove_file(&zip_path);
        resultado?;

        if !deno_path.is_file() {
            return Err("Deno se descomprimió pero no apareció el programa esperado.".to_string());
        }
        set_executable(&deno_path);
    }

    emit_progress(app, "__install__", 100.0, "listo", "Descargador instalado");
    Ok(resolve_tools(app))
}

#[cfg(test)]
mod pruebas {
    /// Reproduce el bloqueo que dejaba las descargas clavadas en 0%.
    ///
    /// Se lanza un proceso que escupe MUCHOS mensajes de error (bastante mas
    /// que los 64 KB que aguanta la tuberia). Leyendo los errores solo al final
    /// -como se hacia antes- esto se quedaria colgado para siempre. Leyendolos
    /// en otro hilo a la vez, termina.
    #[test]
    fn muchos_mensajes_de_error_no_cuelgan_la_descarga() {
        use std::io::{BufRead, BufReader, Read};
        use std::process::{Command, Stdio};

        let mut hijo = Command::new("bash")
            .arg("-c")
            // ~300 KB por la salida de errores, y unas lineas por la normal.
            .arg("for i in $(seq 1 5000); do echo 'aviso de prueba de yt-dlp' >&2; done; \
                  echo '[download] 50.0% of 1MiB'; echo '/tmp/x.mp3'")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("no se pudo lanzar el proceso de prueba");

        // La clave: drenar los errores EN PARALELO.
        let stderr = hijo.stderr.take();
        let hilo = std::thread::spawn(move || {
            let mut t = String::new();
            if let Some(mut s) = stderr {
                let _ = s.read_to_string(&mut t);
            }
            t
        });

        let mut lineas = 0;
        if let Some(stdout) = hijo.stdout.take() {
            for _ in BufReader::new(stdout).lines().map_while(Result::ok) {
                lineas += 1;
            }
        }

        let estado = hijo.wait().expect("el proceso no termino");
        let errores = hilo.join().expect("el hilo de errores fallo");

        assert!(estado.success());
        assert_eq!(lineas, 2, "no se leyo la salida normal");
        assert!(
            errores.len() > 64 * 1024,
            "la prueba no genero suficientes mensajes ({} bytes); no probaria nada",
            errores.len()
        );
    }

    /// Comprueba que la descarga funciona SIN depender del almacen de
    /// certificados del equipo. Se fuerza una ruta invalida en las variables
    /// que usan las herramientas del sistema: si el motor propio dependiera de
    /// ellas, esto fallaria igual que le fallo a curl en la Fedora de prueba.
    #[test]
    fn descarga_sin_depender_de_los_certificados_del_sistema() {
        std::env::set_var("SSL_CERT_FILE", "/ruta/que/no/existe.crt");
        std::env::set_var("SSL_CERT_DIR", "/ruta/que/no/existe");
        std::env::set_var("CURL_CA_BUNDLE", "/ruta/que/no/existe.crt");

        let cliente = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .expect("no se pudo crear el cliente");

        let resp = cliente
            .get("https://raw.githubusercontent.com/yt-dlp/yt-dlp/master/README.md")
            .send()
            .expect("la descarga por HTTPS fallo con los certificados propios");

        assert!(resp.status().is_success(), "estado: {}", resp.status());
        let cuerpo = resp.text().expect("no se pudo leer la respuesta");
        assert!(!cuerpo.is_empty(), "la respuesta llego vacia");
    }
}
