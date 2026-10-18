//! Biblioteca sincronizada entre todas las PC (Syncthing manejado desde la app).
//!
//! Diseño completo en `PLAN-SYNC.md` y `.mega-cuestionario/Guía para Sync.md`.
//! Resumen:
//!   - El PC ORIGINAL (el de Camilo) comparte `~/Música` en modo "solo enviar"
//!     y `~/Música/Sin clasificar` en dos direcciones (con papelera de 30 días).
//!   - Las PC del EQUIPO reciben todo en `~/Infiniity DJ/Biblioteca`, no pueden
//!     tocar las carpetas clasificadas, y lo que bajan de YouTube sube a todos.
//!   - Una PC nueva entra con un CÓDIGO (id del original + secreto). El
//!     original la acepta sola si trae el secreto correcto.
//!   - La app instala Syncthing en su carpeta (sin sudo), lo arranca con su
//!     propia configuración y puertos, y lo maneja por su API REST local.
//!     Nunca se usa la interfaz web de Syncthing.

use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use crate::downloader::clean_command;

// Puertos propios para no chocar con un Syncthing instalado a mano.
// INFINIITY_DJ_SYNC_PUERTOS="8395,22011" los cambia (para probar dos
// instancias en el mismo PC: original + "PC del equipo" con otro HOME).
fn puertos() -> (u16, u16) {
    std::env::var("INFINIITY_DJ_SYNC_PUERTOS")
        .ok()
        .and_then(|v| {
            let (a, b) = v.split_once(',')?;
            Some((a.trim().parse().ok()?, b.trim().parse().ok()?))
        })
        .unwrap_or((8385, 22001))
}
fn api() -> String {
    format!("http://127.0.0.1:{}", puertos().0)
}

const CARPETA_BIBLIOTECA: &str = "infiniity-biblioteca";
const CARPETA_SIN_CLASIFICAR: &str = "infiniity-sin-clasificar";
const CARPETA_BPM: &str = "infiniity-bpm";
const SIN_CLASIFICAR: &str = "Sin clasificar";

/// Prefijo del código de emparejamiento. Si cambia el formato, cambia el prefijo.
const PREFIJO_CODIGO: &str = "IDJ1";

/// Límite de velocidad (KB/s) mientras la persona NO ha autorizado sincronizar
/// o mientras suena música: el índice sí viaja (así sabemos qué falta), la
/// música prácticamente no.
const KBPS_FRENADO: i64 = 50;

// ---------------------------------------------------------------------------
// Estado persistente (sync.json en la carpeta de datos de la app)
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Default, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Rol {
    #[default]
    Ninguno,
    Original,
    Equipo,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct SyncConfig {
    pub rol: Rol,
    /// Clave para hablar con la API de Syncthing (la genera la app).
    pub apikey: String,
    /// Original: el secreto que va en el código. Equipo: el secreto que trajo el código.
    pub secreto: String,
    /// Equipo: id de Syncthing del PC original.
    pub id_original: String,
    /// Original: carpeta de música compartida (la raíz de la biblioteca).
    pub raiz: String,
}

static DATOS: OnceLock<PathBuf> = OnceLock::new();
static RT: OnceLock<SyncRuntime> = OnceLock::new();

/// Hay que llamarlo una vez al arrancar (la app con su app_data_dir; el agente
/// con `dir_datos_por_defecto`).
pub fn iniciar(dir: PathBuf) {
    let _ = std::fs::create_dir_all(&dir);
    let _ = DATOS.set(dir);
}

/// La misma carpeta que Tauri usa como app_data_dir en Linux, calculada sin
/// AppHandle (para el agente, que corre sin ventana).
pub fn dir_datos_por_defecto() -> PathBuf {
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("com.infiniityeventos.dj")
}

fn dir_datos() -> PathBuf {
    DATOS.get().cloned().unwrap_or_else(dir_datos_por_defecto)
}

fn runtime() -> &'static SyncRuntime {
    RT.get_or_init(SyncRuntime::default)
}

fn ruta_config() -> PathBuf {
    dir_datos().join("sync.json")
}

pub fn leer_config() -> SyncConfig {
    match std::fs::read_to_string(ruta_config()) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_else(|e| {
            eprintln!("AVISO: sync.json dañado ({e}); se parte de cero");
            SyncConfig::default()
        }),
        Err(_) => SyncConfig::default(),
    }
}

fn guardar_config(c: &SyncConfig) -> Result<(), String> {
    let texto = serde_json::to_string_pretty(c).map_err(|e| e.to_string())?;
    std::fs::write(ruta_config(), texto).map_err(|e| format!("No se pudo guardar sync.json: {e}"))
}

fn aleatorio(n: usize) -> String {
    // Sin dependencias: mezcla de reloj y direcciones de memoria, suficiente
    // para un secreto de emparejamiento (no es criptografía de banco).
    let semilla_pila = 0u8;
    let mut x = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(1)
        ^ (std::process::id() as u64).rotate_left(32)
        ^ (&semilla_pila as *const u8 as u64);
    if x == 0 {
        x = 0x9E37_79B9_7F4A_7C15;
    }
    const ALFABETO: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut s = String::with_capacity(n);
    for _ in 0..n {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        s.push(ALFABETO[(x % ALFABETO.len() as u64) as usize] as char);
    }
    s
}

/// Nombre con el que esta PC se presenta en Syncthing. En modo equipo lleva el
/// secreto: así el original sabe que trae el código correcto (ver vigilar_original).
fn nombre_dispositivo(c: &SyncConfig) -> String {
    let host = std::fs::read_to_string("/etc/hostname")
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| "PC".to_string());
    match c.rol {
        Rol::Original => format!("Infiniity DJ Original|{host}"),
        _ => format!("Infiniity DJ|{host}|{}", c.secreto),
    }
}

// ---------------------------------------------------------------------------
// Instalar y arrancar Syncthing
// ---------------------------------------------------------------------------

fn dir_bin() -> PathBuf {
    let d = dir_datos().join("bin");
    let _ = std::fs::create_dir_all(&d);
    d
}

fn dir_home_syncthing() -> PathBuf {
    let d = dir_datos().join("syncthing-home");
    let _ = std::fs::create_dir_all(&d);
    d
}

/// Carpeta sincronizada con el caché de BPM (un archivo por PC, ver cache.rs).
pub fn dir_bpm_compartido() -> PathBuf {
    let d = dir_datos().join("bpm-compartido");
    let _ = std::fs::create_dir_all(&d);
    d
}

fn ruta_syncthing() -> Option<PathBuf> {
    let p = dir_bin().join("syncthing");
    if p.is_file() {
        Some(p)
    } else {
        None
    }
}

/// Baja la última versión de Syncthing (tar.gz de GitHub, ~11 MB) a la carpeta
/// de la app. Sin sudo. Devuelve la ruta del ejecutable.
pub fn instalar_syncthing() -> Result<PathBuf, String> {
    if let Some(p) = ruta_syncthing() {
        return Ok(p);
    }
    let cliente = reqwest::blocking::Client::builder()
        .user_agent("InfiniityDJ")
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;
    // El nombre del archivo lleva la versión: hay que preguntarle a GitHub cuál es.
    let release: serde_json::Value = cliente
        .get("https://api.github.com/repos/syncthing/syncthing/releases/latest")
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("No se pudo consultar la versión de Syncthing: {e}"))?
        .json()
        .map_err(|e| format!("Respuesta rara de GitHub: {e}"))?;
    let url = release["assets"]
        .as_array()
        .and_then(|a| {
            a.iter().find_map(|x| {
                let n = x["name"].as_str()?;
                (n.starts_with("syncthing-linux-amd64-") && n.ends_with(".tar.gz"))
                    .then(|| x["browser_download_url"].as_str().map(str::to_string))
                    .flatten()
            })
        })
        .ok_or("GitHub no lista el paquete de Syncthing para Linux")?;
    let bytes = cliente
        .get(&url)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("No se pudo bajar Syncthing: {e}"))?
        .bytes()
        .map_err(|e| format!("Se cortó la descarga de Syncthing: {e}"))?;
    let gz = flate2::read::GzDecoder::new(std::io::Cursor::new(bytes));
    let mut tar = tar::Archive::new(gz);
    let destino = dir_bin().join("syncthing");
    let mut encontrado = false;
    for entrada in tar.entries().map_err(|e| format!("Paquete de Syncthing dañado: {e}"))? {
        let mut entrada = entrada.map_err(|e| e.to_string())?;
        let ruta = entrada.path().map_err(|e| e.to_string())?.into_owned();
        // El ejecutable es `<carpeta>/syncthing` (decenas de MB). OJO: el paquete
        // trae OTRO archivo llamado "syncthing" (perfil de firewall de 1,7 KB) en
        // etc/firewall-ufw/; la primera versión de esto se llevó ese.
        let es_ejecutable = ruta.file_name().and_then(|n| n.to_str()) == Some("syncthing")
            && ruta.components().count() == 2
            && entrada.header().entry_type().is_file()
            && entrada.header().size().unwrap_or(0) > 5_000_000;
        if es_ejecutable {
            entrada.unpack(&destino).map_err(|e| format!("No se pudo extraer syncthing: {e}"))?;
            encontrado = true;
            break;
        }
    }
    if !encontrado {
        return Err("El paquete de Syncthing no traía el programa".to_string());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&destino, std::fs::Permissions::from_mode(0o755));
    }
    Ok(destino)
}

pub struct SyncRuntime {
    pub proceso: Mutex<Option<Child>>,
}

impl Default for SyncRuntime {
    fn default() -> Self {
        Self { proceso: Mutex::new(None) }
    }
}

/// Banderas de la sesión (modo equipo). Van en un archivo y no en memoria para
/// que cualquier proceso nuestro (la app, el --sync-cli) vea lo mismo. Se
/// borran al abrir la app: la autorización es por sesión, como se pidió.
#[derive(Serialize, Deserialize, Clone, Copy, Default)]
pub struct Banderas {
    /// La persona autorizó sincronizar en esta sesión.
    pub autorizado: bool,
    /// Hay música sonando: se frena la sincronización.
    pub musica: bool,
    /// Pausa pedida a mano desde el panel.
    pub pausa_manual: bool,
}

fn ruta_banderas() -> PathBuf {
    dir_datos().join("sync-sesion.json")
}

pub fn banderas() -> Banderas {
    std::fs::read_to_string(ruta_banderas())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Empieza una sesión: nada autorizado, nada sonando, sin pausa manual.
pub fn nueva_sesion() {
    let _ = std::fs::remove_file(ruta_banderas());
}

fn cliente_api(apikey: &str) -> Result<reqwest::blocking::Client, String> {
    let mut h = reqwest::header::HeaderMap::new();
    h.insert(
        "X-API-Key",
        reqwest::header::HeaderValue::from_str(apikey).map_err(|e| e.to_string())?,
    );
    reqwest::blocking::Client::builder()
        .default_headers(h)
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())
}

fn api_get(apikey: &str, ruta: &str) -> Result<serde_json::Value, String> {
    cliente_api(apikey)?
        .get(format!("{}{ruta}", api()))
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Syncthing no respondió a GET {ruta}: {e}"))?
        .json()
        .map_err(|e| format!("Respuesta rara de Syncthing en {ruta}: {e}"))
}

fn api_enviar(apikey: &str, metodo: &str, ruta: &str, cuerpo: Option<&serde_json::Value>) -> Result<(), String> {
    let c = cliente_api(apikey)?;
    let req = match metodo {
        "POST" => c.post(format!("{}{ruta}", api())),
        "PUT" => c.put(format!("{}{ruta}", api())),
        "PATCH" => c.patch(format!("{}{ruta}", api())),
        _ => return Err(format!("método {metodo} no soportado")),
    };
    let req = match cuerpo {
        Some(b) => req.json(b),
        None => req,
    };
    let resp = req
        .send()
        .map_err(|e| format!("Syncthing no respondió a {metodo} {ruta}: {e}"))?;
    if !resp.status().is_success() {
        let estado = resp.status();
        let texto = resp.text().unwrap_or_default();
        return Err(format!("Syncthing rechazó {metodo} {ruta}: {estado} {texto}"));
    }
    Ok(())
}

fn api_viva(apikey: &str) -> bool {
    api_get(apikey, "/rest/system/ping").is_ok()
}

/// Arranca Syncthing si no está corriendo ya (puede estar corriendo el del
/// agente del PC original: en ese caso se usa ese).
pub fn asegurar_syncthing() -> Result<(), String> {
    let mut c = leer_config();
    if c.apikey.is_empty() {
        c.apikey = aleatorio(32);
        guardar_config(&c)?;
    }
    if api_viva(&c.apikey) {
        return Ok(());
    }
    let exe = instalar_syncthing()?;
    let home = dir_home_syncthing();
    let log = home.join("syncthing.log");
    // Lo que Syncthing escupa al arrancar (p. ej. un flag que no existe en esta
    // versión) queda en un archivo: la primera vez se mandó a la nada y costó
    // ver por qué "no respondía".
    let err = std::fs::File::create(home.join("syncthing.err")).map_err(|e| e.to_string())?;
    let hijo = clean_command(exe.to_str().unwrap_or("syncthing"))
        .arg("serve")
        .arg(format!("--home={}", home.display()))
        .arg(format!("--gui-address=127.0.0.1:{}", puertos().0))
        .arg(format!("--gui-apikey={}", c.apikey))
        .arg("--no-browser")
        .arg("--no-upgrade")
        .arg("--no-restart")
        .arg("--no-port-probing")
        .arg(format!("--log-file={}", log.display()))
        .arg("--log-max-old-files=1")
        // "--no-default-folder" solo existe en `generate`; en `serve` va por entorno.
        .env("STNODEFAULTFOLDER", "1")
        .stdout(Stdio::null())
        .stderr(err)
        .spawn()
        .map_err(|e| format!("No se pudo arrancar Syncthing: {e}"))?;
    if let Ok(mut p) = runtime().proceso.lock() {
        *p = Some(hijo);
    }
    // Esperar a que conteste (hasta ~20 s la primera vez: genera llaves).
    for _ in 0..40 {
        std::thread::sleep(Duration::from_millis(500));
        if api_viva(&c.apikey) {
            configurar_base(&c)?;
            return Ok(());
        }
    }
    let err_texto = std::fs::read_to_string(home.join("syncthing.err")).unwrap_or_default();
    Err(format!(
        "Syncthing arrancó pero no responde. {}",
        if err_texto.trim().is_empty() { format!("Mira {}", log.display()) } else { err_texto.trim().to_string() }
    ))
}

/// Ajustes que siempre van: puerto de datos propio, nombre de esta PC, sin
/// avisos de versión, sin informes anónimos.
fn configurar_base(c: &SyncConfig) -> Result<(), String> {
    let yo = mi_id(&c.apikey)?;
    api_enviar(
        &c.apikey,
        "PATCH",
        "/rest/config/options",
        Some(&serde_json::json!({
            "listenAddresses": [format!("tcp://0.0.0.0:{}", puertos().1), "dynamic+https://relays.syncthing.net/endpoint"],
            "globalAnnounceEnabled": true,
            "localAnnounceEnabled": true,
            "relaysEnabled": true,
            "natEnabled": true,
            "urAccepted": -1,
            "autoUpgradeIntervalH": 0,
            "crashReportingEnabled": false,
            "startBrowser": false,
            "maxRecvKbps": 0,
            "maxSendKbps": 0,
            // Sin esto, el límite de velocidad NO aplica en la red local (la
            // oficina) y el "frenado hasta autorizar" no frenaría nada.
            "limitBandwidthInLan": true,
        })),
    )?;
    api_enviar(
        &c.apikey,
        "PATCH",
        &format!("/rest/config/devices/{yo}"),
        Some(&serde_json::json!({ "name": nombre_dispositivo(c) })),
    )?;
    Ok(())
}

pub fn parar_syncthing() {
    let c = leer_config();
    // Apagado limpio por la API (aunque lo haya arrancado otro proceso nuestro,
    // p. ej. el agente o una orden anterior del --sync-cli).
    if api_viva(&c.apikey) {
        let _ = api_enviar(&c.apikey, "POST", "/rest/system/shutdown", None);
    }
    if let Ok(mut p) = runtime().proceso.lock() {
        if let Some(mut hijo) = p.take() {
            for _ in 0..20 {
                if let Ok(Some(_)) = hijo.try_wait() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(250));
            }
            let _ = hijo.kill();
        }
    }
}

fn mi_id(apikey: &str) -> Result<String, String> {
    let v = api_get(apikey, "/rest/system/status")?;
    v["myID"]
        .as_str()
        .map(str::to_string)
        .ok_or("Syncthing no dijo su id".to_string())
}

// ---------------------------------------------------------------------------
// Carpetas
// ---------------------------------------------------------------------------

/// `.stignore` NO se sincroniza: cada PC escribe el suyo. Excluye "Sin
/// clasificar" de la carpeta Biblioteca, porque se comparte aparte con otras reglas.
fn escribir_stignore(raiz: &Path) -> Result<(), String> {
    std::fs::create_dir_all(raiz).map_err(|e| e.to_string())?;
    std::fs::write(raiz.join(".stignore"), format!("/{SIN_CLASIFICAR}\n"))
        .map_err(|e| format!("No se pudo escribir .stignore: {e}"))
}

fn definir_carpeta(
    apikey: &str,
    id: &str,
    etiqueta: &str,
    ruta: &Path,
    tipo: &str,
    dispositivos: &[String],
    papelera_dias: Option<u32>,
) -> Result<(), String> {
    let devs: Vec<serde_json::Value> = dispositivos
        .iter()
        .map(|d| serde_json::json!({ "deviceID": d }))
        .collect();
    let mut carpeta = serde_json::json!({
        "id": id,
        "label": etiqueta,
        "path": ruta.to_string_lossy(),
        "type": tipo,
        "devices": devs,
        "rescanIntervalS": 3600,
        "fsWatcherEnabled": true,
        "fsWatcherDelayS": 10,
        "ignorePerms": true,
        "paused": false,
    });
    if let Some(dias) = papelera_dias {
        carpeta["versioning"] = serde_json::json!({
            "type": "trashcan",
            "params": { "cleanoutDays": dias.to_string() },
            "cleanupIntervalS": 3600,
        });
    }
    // PUT crea o reemplaza.
    api_enviar(apikey, "PUT", &format!("/rest/config/folders/{id}"), Some(&carpeta))
}

/// Rutas de las tres carpetas según el rol.
fn rutas_carpetas(c: &SyncConfig) -> (PathBuf, PathBuf, PathBuf) {
    let raiz = if c.rol == Rol::Original {
        PathBuf::from(&c.raiz)
    } else {
        raiz_equipo()
    };
    (raiz.clone(), raiz.join(SIN_CLASIFICAR), dir_bpm_compartido())
}

/// Raíz de la biblioteca sincronizada según el rol (None si esta PC no está en un grupo).
pub fn raiz_sincronizada() -> Option<PathBuf> {
    let c = leer_config();
    match c.rol {
        Rol::Original => Some(PathBuf::from(c.raiz)),
        Rol::Equipo => Some(raiz_equipo()),
        Rol::Ninguno => None,
    }
}

/// Carpeta fija de las PC del equipo.
pub fn raiz_equipo() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    Path::new(&home).join("Infiniity DJ").join("Biblioteca")
}

// ---------------------------------------------------------------------------
// Rol ORIGINAL
// ---------------------------------------------------------------------------

/// Convierte esta PC en el original del grupo y devuelve el código.
pub fn crear_grupo(raiz: &str) -> Result<String, String> {
    let mut c = leer_config();
    if c.rol == Rol::Equipo {
        return Err("Esta PC ya está unida a un grupo como PC del equipo".to_string());
    }
    c.rol = Rol::Original;
    c.raiz = raiz.to_string();
    if c.secreto.is_empty() {
        c.secreto = aleatorio(8);
    }
    guardar_config(&c)?;
    asegurar_syncthing()?;
    // asegurar_syncthing pudo generar la clave de la API: releer, no usar la copia vieja.
    let c = leer_config();
    configurar_base(&c)?;
    let yo = mi_id(&c.apikey)?;
    let (bib, sin, bpm) = rutas_carpetas(&c);
    escribir_stignore(&bib)?;
    std::fs::create_dir_all(&sin).map_err(|e| e.to_string())?;
    // Las carpetas se crean con los dispositivos que YA estén aceptados (si se
    // vuelve a llamar, no se pierde a nadie).
    let otros = dispositivos_conocidos(&c.apikey, &yo)?;
    definir_carpeta(&c.apikey, CARPETA_BIBLIOTECA, "Biblioteca", &bib, "sendonly", &otros, None)?;
    definir_carpeta(&c.apikey, CARPETA_SIN_CLASIFICAR, "Sin clasificar", &sin, "sendreceive", &otros, Some(30))?;
    definir_carpeta(&c.apikey, CARPETA_BPM, "BPM", &bpm, "sendreceive", &otros, None)?;
    Ok(codigo(&yo, &c.secreto))
}

fn codigo(id_original: &str, secreto: &str) -> String {
    format!("{PREFIJO_CODIGO}-{id_original}-{secreto}")
}

pub fn codigo_actual() -> Result<String, String> {
    let c = leer_config();
    if c.rol != Rol::Original {
        return Err("Esta PC no es el original".to_string());
    }
    let yo = mi_id(&c.apikey)?;
    Ok(codigo(&yo, &c.secreto))
}

/// Nuevo secreto: los códigos viejos dejan de servir (las PC ya aceptadas siguen).
pub fn cambiar_secreto() -> Result<String, String> {
    let mut c = leer_config();
    if c.rol != Rol::Original {
        return Err("Esta PC no es el original".to_string());
    }
    c.secreto = aleatorio(8);
    guardar_config(&c)?;
    configurar_base(&c)?;
    codigo_actual()
}

fn dispositivos_conocidos(apikey: &str, yo: &str) -> Result<Vec<String>, String> {
    let v = api_get(apikey, "/rest/config/devices")?;
    Ok(v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|d| d["deviceID"].as_str())
                .filter(|id| *id != yo)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default())
}

/// Original: acepta las PC pendientes que traen el secreto correcto y les
/// comparte las tres carpetas. Se llama cada pocos segundos (ver vigilar).
pub fn aceptar_pendientes() -> Result<usize, String> {
    let c = leer_config();
    if c.rol != Rol::Original {
        return Ok(0);
    }
    let pendientes = api_get(&c.apikey, "/rest/cluster/pending/devices")?;
    let Some(mapa) = pendientes.as_object() else { return Ok(0) };
    let mut aceptados = 0;
    for (id, info) in mapa {
        let nombre = info["name"].as_str().unwrap_or("");
        let trae_secreto = nombre.starts_with("Infiniity DJ|") && nombre.ends_with(&format!("|{}", c.secreto));
        if !trae_secreto {
            eprintln!("sync: PC pendiente sin el código correcto ({nombre}); se ignora");
            continue;
        }
        api_enviar(
            &c.apikey,
            "POST",
            "/rest/config/devices",
            Some(&serde_json::json!({
                "deviceID": id,
                "name": nombre,
                "addresses": ["dynamic"],
                "autoAcceptFolders": false,
            })),
        )?;
        for carpeta in [CARPETA_BIBLIOTECA, CARPETA_SIN_CLASIFICAR, CARPETA_BPM] {
            compartir_carpeta_con(&c.apikey, carpeta, id)?;
        }
        eprintln!("sync: PC aceptada: {nombre}");
        aceptados += 1;
    }
    Ok(aceptados)
}

fn compartir_carpeta_con(apikey: &str, carpeta: &str, dispositivo: &str) -> Result<(), String> {
    let mut f = api_get(apikey, &format!("/rest/config/folders/{carpeta}"))?;
    let mut devs = f["devices"].as_array().cloned().unwrap_or_default();
    if !devs.iter().any(|d| d["deviceID"].as_str() == Some(dispositivo)) {
        devs.push(serde_json::json!({ "deviceID": dispositivo }));
    }
    f["devices"] = serde_json::Value::Array(devs);
    api_enviar(apikey, "PUT", &format!("/rest/config/folders/{carpeta}"), Some(&f))
}

// ---------------------------------------------------------------------------
// Rol EQUIPO
// ---------------------------------------------------------------------------

/// Une esta PC al grupo con el código. Deja todo listo para recibir.
pub fn unirse(codigo_texto: &str) -> Result<(), String> {
    let texto = codigo_texto.trim();
    let partes: Vec<&str> = texto.splitn(3, '-').collect();
    if partes.len() != 3 || partes[0] != PREFIJO_CODIGO {
        return Err("Ese código no tiene la forma esperada. Pídelo de nuevo desde el PC original.".to_string());
    }
    // El id de Syncthing lleva guiones por dentro: el secreto es lo último.
    let (id_original, secreto) = match texto[PREFIJO_CODIGO.len() + 1..].rsplit_once('-') {
        Some(x) => x,
        None => return Err("Código incompleto".to_string()),
    };
    if id_original.len() < 50 || secreto.len() < 4 {
        return Err("Código incompleto o mal copiado. Cópialo entero.".to_string());
    }
    let mut c = leer_config();
    if c.rol == Rol::Original {
        return Err("Esta PC es el original del grupo; no puede unirse como PC del equipo".to_string());
    }
    c.rol = Rol::Equipo;
    c.secreto = secreto.to_string();
    c.id_original = id_original.to_string();
    guardar_config(&c)?;
    asegurar_syncthing()?;
    let c = leer_config(); // la clave de la API pudo generarse recién
    configurar_base(&c)?; // el nombre ahora lleva el secreto
    // Añadir al original como dispositivo de confianza. En cuanto conecte, el
    // original nos acepta (ve el secreto en nuestro nombre) y nos ofrece las
    // carpetas; `aceptar_carpetas_ofrecidas` las toma.
    // INFINIITY_DJ_SYNC_DIRECCION_ORIGINAL=tcp://127.0.0.1:22001 fija la
    // dirección del original (pruebas en el mismo PC, donde el descubrimiento
    // local puede no servir). Normalmente "dynamic": se descubre solo.
    let direccion = std::env::var("INFINIITY_DJ_SYNC_DIRECCION_ORIGINAL").unwrap_or_else(|_| "dynamic".to_string());
    api_enviar(
        &c.apikey,
        "POST",
        "/rest/config/devices",
        Some(&serde_json::json!({
            "deviceID": id_original,
            "name": "PC original",
            "addresses": [direccion],
            "introducer": false,
        })),
    )?;
    let (bib, sin, _) = rutas_carpetas(&c);
    escribir_stignore(&bib)?;
    std::fs::create_dir_all(&sin).map_err(|e| e.to_string())?;
    frenar(true)?; // hasta que la persona autorice
    Ok(())
}

/// Equipo: toma las carpetas que el original ofrece, en las rutas fijas.
pub fn aceptar_carpetas_ofrecidas() -> Result<usize, String> {
    let c = leer_config();
    if c.rol != Rol::Equipo {
        return Ok(0);
    }
    let pendientes = api_get(&c.apikey, "/rest/cluster/pending/folders")?;
    let Some(mapa) = pendientes.as_object() else { return Ok(0) };
    let (bib, sin, bpm) = rutas_carpetas(&c);
    let mut n = 0;
    for (id, info) in mapa {
        let ofrecida_por_original = info["offeredBy"]
            .as_object()
            .map(|o| o.contains_key(&c.id_original))
            .unwrap_or(false);
        if !ofrecida_por_original {
            continue;
        }
        let (etiqueta, ruta, tipo) = match id.as_str() {
            CARPETA_BIBLIOTECA => ("Biblioteca", bib.clone(), "receiveonly"),
            CARPETA_SIN_CLASIFICAR => ("Sin clasificar", sin.clone(), "sendreceive"),
            CARPETA_BPM => ("BPM", bpm.clone(), "sendreceive"),
            _ => continue,
        };
        definir_carpeta(&c.apikey, id, etiqueta, &ruta, tipo, &[c.id_original.clone()], None)?;
        eprintln!("sync: carpeta aceptada: {etiqueta} -> {}", ruta.display());
        n += 1;
    }
    Ok(n)
}

/// Equipo: en Biblioteca (solo recibir) Syncthing NO revierte solo lo que se
/// cambie a mano; lo marca. Esto pide el "revert" para que vuelva a quedar
/// igual que en el original.
pub fn revertir_cambios_locales() -> Result<(), String> {
    let c = leer_config();
    if c.rol != Rol::Equipo {
        return Ok(());
    }
    let estado = api_get(&c.apikey, &format!("/rest/db/status?folder={CARPETA_BIBLIOTECA}"))?;
    let cambiados = estado["receiveOnlyChangedFiles"].as_u64().unwrap_or(0)
        + estado["receiveOnlyChangedDirectories"].as_u64().unwrap_or(0)
        + estado["receiveOnlyChangedDeletes"].as_u64().unwrap_or(0);
    if cambiados > 0 {
        eprintln!("sync: {cambiados} cambios locales en Biblioteca; se revierten");
        api_enviar(&c.apikey, "POST", &format!("/rest/db/revert?folder={CARPETA_BIBLIOTECA}"), None)?;
    }
    Ok(())
}

/// Borra los archivos `*.sync-conflict-*` de la biblioteca. Aparecen cuando dos
/// PC crean el mismo archivo a la vez (dos personas bajando la misma canción):
/// una copia queda con su nombre y la otra marcada como conflicto. La marcada
/// es una copia de más: se borra. (La interfaz ya no la muestra: library.rs.)
pub fn limpiar_conflictos() -> usize {
    let c = leer_config();
    if c.rol == Rol::Ninguno {
        return 0;
    }
    let (raiz, _, bpm) = rutas_carpetas(&c);
    let mut borrados = 0;
    for base in [raiz, bpm] {
        for entrada in walkdir::WalkDir::new(&base)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| {
                // No entrar en .stversions ni .stfolder (son de Syncthing).
                e.depth() == 0 || !e.file_name().to_string_lossy().starts_with(".st")
            })
            .filter_map(|e| e.ok())
        {
            let nombre = entrada.file_name().to_string_lossy();
            if entrada.file_type().is_file() && nombre.contains(".sync-conflict-") {
                match std::fs::remove_file(entrada.path()) {
                    Ok(()) => {
                        eprintln!("sync: copia en conflicto borrada: {nombre}");
                        borrados += 1;
                    }
                    Err(e) => eprintln!("AVISO sync: no se pudo borrar {nombre}: {e}"),
                }
            }
        }
    }
    borrados
}

/// Frenar (límite mínimo) o soltar la velocidad. Se recalcula con
/// `aplicar_velocidad`; esto es el mando directo.
fn frenar(frenado: bool) -> Result<(), String> {
    let c = leer_config();
    let kbps = if frenado { KBPS_FRENADO } else { 0 };
    api_enviar(
        &c.apikey,
        "PATCH",
        "/rest/config/options",
        Some(&serde_json::json!({ "maxRecvKbps": kbps, "maxSendKbps": kbps })),
    )
}

/// Cambia las banderas de la sesión (None = dejar como está).
pub fn marcar(autorizado: Option<bool>, musica: Option<bool>, pausa_manual: Option<bool>) {
    let mut b = banderas();
    if let Some(v) = autorizado {
        b.autorizado = v;
    }
    if let Some(v) = musica {
        b.musica = v;
    }
    if let Some(v) = pausa_manual {
        b.pausa_manual = v;
    }
    if let Err(e) = serde_json::to_string(&b).map_err(|e| e.to_string()).and_then(|t| std::fs::write(ruta_banderas(), t).map_err(|e| e.to_string())) {
        eprintln!("AVISO sync: no se pudieron guardar las banderas de sesión: {e}");
    }
}

/// Decide la velocidad según: autorizado, música sonando, pausa manual.
pub fn aplicar_velocidad() -> Result<(), String> {
    let c = leer_config();
    let frenado = match c.rol {
        Rol::Equipo => {
            let b = banderas();
            !b.autorizado || b.musica || b.pausa_manual
        }
        // El original nunca se frena: es el punto de encuentro.
        _ => false,
    };
    frenar(frenado)
}

// ---------------------------------------------------------------------------
// Estado para la interfaz
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct PcConectada {
    pub nombre: String,
    pub conectado: bool,
    pub ultimo_visto: String,
    /// Porcentaje de lo que esa PC tiene de la Biblioteca (0-100).
    pub completado: f64,
}

#[derive(Serialize, Clone, Default)]
pub struct SyncEstado {
    pub rol: Rol,
    pub activo: bool, // Syncthing responde
    pub original_conectado: bool,
    pub pendientes: u64,      // archivos que faltan por recibir (equipo)
    pub pendientes_mb: f64,
    pub completado: f64,      // % de la Biblioteca que ya está (equipo)
    pub autorizado: bool,
    pub musica: bool,
    pub pausa_manual: bool,
    pub frenado: bool,
    pub pcs: Vec<PcConectada>,
    pub raiz: String,
}

pub fn estado() -> SyncEstado {
    let c = leer_config();
    let b = banderas();
    let mut e = SyncEstado {
        rol: c.rol.clone(),
        autorizado: b.autorizado,
        musica: b.musica,
        pausa_manual: b.pausa_manual,
        raiz: rutas_carpetas(&c).0.to_string_lossy().into_owned(),
        ..Default::default()
    };
    if c.rol == Rol::Ninguno || !api_viva(&c.apikey) {
        return e;
    }
    e.activo = true;
    e.frenado = api_get(&c.apikey, "/rest/config/options")
        .ok()
        .and_then(|o| o["maxRecvKbps"].as_i64())
        .map(|k| k > 0)
        .unwrap_or(false);
    let conexiones = api_get(&c.apikey, "/rest/system/connections").unwrap_or_default();
    let dispositivos = api_get(&c.apikey, "/rest/config/devices").unwrap_or_default();
    let yo = mi_id(&c.apikey).unwrap_or_default();
    if let Some(lista) = dispositivos.as_array() {
        for d in lista {
            let id = d["deviceID"].as_str().unwrap_or("");
            if id == yo {
                continue;
            }
            let con = &conexiones["connections"][id];
            let conectado = con["connected"].as_bool().unwrap_or(false);
            if id == c.id_original {
                e.original_conectado = conectado;
            }
            let completado = api_get(&c.apikey, &format!("/rest/db/completion?folder={CARPETA_BIBLIOTECA}&device={id}"))
                .ok()
                .and_then(|v| v["completion"].as_f64())
                .unwrap_or(0.0);
            let nombre = d["name"].as_str().unwrap_or("PC").to_string();
            e.pcs.push(PcConectada {
                // Sin el secreto, que es privado.
                nombre: nombre.split('|').nth(1).unwrap_or(&nombre).to_string(),
                conectado,
                ultimo_visto: con["at"].as_str().unwrap_or("").to_string(),
                completado,
            });
        }
    }
    if c.rol == Rol::Equipo {
        // Lo que a ESTA PC le falta de la Biblioteca + Sin clasificar.
        let mut faltan = 0;
        let mut bytes = 0.0;
        let mut comp = Vec::new();
        for carpeta in [CARPETA_BIBLIOTECA, CARPETA_SIN_CLASIFICAR] {
            if let Ok(v) = api_get(&c.apikey, &format!("/rest/db/completion?folder={carpeta}")) {
                faltan += v["needItems"].as_u64().unwrap_or(0) + v["needDeletes"].as_u64().unwrap_or(0);
                bytes += v["needBytes"].as_f64().unwrap_or(0.0);
                if carpeta == CARPETA_BIBLIOTECA {
                    comp.push(v["completion"].as_f64().unwrap_or(0.0));
                }
            }
        }
        e.pendientes = faltan;
        e.pendientes_mb = bytes / 1_048_576.0;
        e.completado = comp.first().copied().unwrap_or(0.0);
    }
    e
}

// ---------------------------------------------------------------------------
// Vigilante (hilo): mantiene todo andando sin que nadie haga nada
// ---------------------------------------------------------------------------

/// Cada 5 s: el original acepta PC nuevas; el equipo toma carpetas ofrecidas,
/// revierte cambios locales y recalcula la velocidad. Si Syncthing se cae, se
/// vuelve a arrancar.
pub fn vigilar() {
    std::thread::spawn(move || {
        let mut vuelta: u64 = 0;
        loop {
        std::thread::sleep(Duration::from_secs(5));
        vuelta += 1;
        let c = leer_config();
        if c.rol == Rol::Ninguno {
            continue;
        }
        // Cada minuto: barrer copias en conflicto.
        if vuelta % 12 == 1 {
            limpiar_conflictos();
        }
        if !api_viva(&c.apikey) {
            if let Err(e) = asegurar_syncthing() {
                eprintln!("AVISO sync: no se pudo (re)arrancar Syncthing: {e}");
                continue;
            }
        }
        let r = match c.rol {
            Rol::Original => aceptar_pendientes().map(|_| ()),
            Rol::Equipo => aceptar_carpetas_ofrecidas()
                .and_then(|_| revertir_cambios_locales())
                .and_then(|_| aplicar_velocidad()),
            Rol::Ninguno => Ok(()),
        };
        if let Err(e) = r {
            eprintln!("AVISO sync: {e}");
        }
        }
    });
}

/// Modo `--sync-cli <orden> [arg]`: las mismas funciones desde la terminal, para
/// probar y diagnosticar sin ventana. Imprime JSON o texto y termina (salvo
/// `vigilar`, que se queda vigilando como lo haría la app abierta).
pub fn correr_cli(args: &[String]) -> ! {
    let orden = args.first().map(String::as_str).unwrap_or("estado");
    let arg = args.get(1).cloned().unwrap_or_default();
    let r: Result<String, String> = match orden {
        "estado" => serde_json::to_string_pretty(&estado()).map_err(|e| e.to_string()),
        "crear" => crear_grupo(&arg),
        "codigo" => codigo_actual(),
        "unirse" => unirse(&arg).map(|_| "unida".to_string()),
        "autorizar" => {
            marcar(Some(true), None, Some(false));
            aplicar_velocidad().map(|_| "autorizado".to_string())
        }
        "pausar" => {
            marcar(Some(true), None, Some(true));
            aplicar_velocidad().map(|_| "en pausa".to_string())
        }
        "musica" => {
            marcar(None, Some(arg == "1"), None);
            aplicar_velocidad().map(|_| format!("musica={}", arg == "1"))
        }
        "servicio" => instalar_servicio_agente(),
        "salir" => salir_del_grupo().map(|_| "fuera".to_string()),
        "log" => Ok(ultimas_lineas_log(40)),
        "parar" => {
            parar_syncthing();
            Ok("parado".to_string())
        }
        "vigilar" => {
            // Como la app abierta: sesión nueva, arranca Syncthing y vigila para siempre.
            nueva_sesion();
            if let Err(e) = asegurar_syncthing() {
                eprintln!("{e}");
                std::process::exit(1);
            }
            vigilar();
            loop {
                std::thread::sleep(Duration::from_secs(3600));
            }
        }
        _ => Err(format!("orden desconocida: {orden} (estado|crear <raiz>|codigo|unirse <codigo>|autorizar|pausar|musica 0/1|servicio|salir|log|parar|vigilar)")),
    };
    match r {
        Ok(s) => {
            println!("{s}");
            std::process::exit(0)
        }
        Err(e) => {
            eprintln!("ERROR: {e}");
            std::process::exit(1)
        }
    }
}

/// Modo `--sync-agente`: el PC original mantiene Syncthing encendido y acepta
/// PC nuevas aunque la app esté cerrada. Lo lanza el servicio de usuario.
/// No abre ventana. Nunca termina.
pub fn correr_agente() -> ! {
    eprintln!("Infiniity DJ: agente de sincronización");
    let mut vuelta: u64 = 0;
    loop {
        let c = leer_config();
        if c.rol != Rol::Original {
            eprintln!("agente: esta PC no es el original; nada que hacer");
            std::thread::sleep(Duration::from_secs(60));
            continue;
        }
        if let Err(e) = asegurar_syncthing() {
            eprintln!("agente: {e}");
            std::thread::sleep(Duration::from_secs(30));
            continue;
        }
        if let Err(e) = aceptar_pendientes() {
            eprintln!("agente: {e}");
        }
        vuelta += 1;
        if vuelta % 12 == 1 {
            limpiar_conflictos();
        }
        std::thread::sleep(Duration::from_secs(5));
    }
}

/// Instala (o actualiza) el servicio de usuario que corre el agente al iniciar
/// sesión. Solo tiene sentido en el PC original.
pub fn instalar_servicio_agente() -> Result<String, String> {
    let exe = std::env::var("APPIMAGE")
        .map(PathBuf::from)
        .or_else(|_| std::env::current_exe())
        .map_err(|e| format!("No sé qué programa soy: {e}"))?;
    let home = std::env::var("HOME").map_err(|_| "Sin HOME".to_string())?;
    let dir = Path::new(&home).join(".config/systemd/user");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let unidad = dir.join("infiniity-dj-sync.service");
    let texto = format!(
        "[Unit]\nDescription=Infiniity DJ - sincronización de la biblioteca (agente del PC original)\nAfter=network-online.target\n\n\
         [Service]\nExecStart=\"{}\" --sync-agente\nRestart=always\nRestartSec=10\n\n\
         [Install]\nWantedBy=default.target\n",
        exe.display()
    );
    std::fs::write(&unidad, texto).map_err(|e| format!("No se pudo escribir el servicio: {e}"))?;
    for args in [vec!["--user", "daemon-reload"], vec!["--user", "enable", "--now", "infiniity-dj-sync.service"]] {
        let out = clean_command("systemctl")
            .args(&args)
            .output()
            .map_err(|e| format!("No se pudo ejecutar systemctl: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "systemctl {} falló: {}",
                args.join(" "),
                String::from_utf8_lossy(&out.stderr)
            ));
        }
    }
    Ok(unidad.to_string_lossy().into_owned())
}

/// Deja esta PC fuera del grupo (no borra música). Para empezar de cero.
pub fn salir_del_grupo() -> Result<(), String> {
    parar_syncthing();
    let home = dir_home_syncthing();
    let _ = std::fs::remove_dir_all(&home);
    let _ = std::fs::remove_file(ruta_config());
    Ok(())
}

/// Lee un archivo del log de Syncthing (para diagnóstico).
pub fn ultimas_lineas_log(n: usize) -> String {
    let p = dir_home_syncthing().join("syncthing.log");
    let mut s = String::new();
    if let Ok(mut f) = std::fs::File::open(p) {
        let _ = f.read_to_string(&mut s);
    }
    s.lines().rev().take(n).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n")
}
