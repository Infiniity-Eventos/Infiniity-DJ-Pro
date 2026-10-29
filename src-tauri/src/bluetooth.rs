//! Buscar y conectar la cabina por Bluetooth DESDE la app.
//!
//! POR QUE EXISTE: antes, para sonar por una cabina Bluetooth habia que salir
//! del programa, abrir la configuracion de Bluetooth del sistema (distinta en
//! cada PC del equipo), emparejar ahi, y recien entonces volver a la app a
//! elegir la salida. En un evento, con gente esperando, eso es un via crucis y
//! encima cada quien lo hace distinto. Desde aqui es un boton.
//!
//! POR QUE `bluetoothctl` Y NO D-BUS DIRECTO: es la misma decision que con
//! `pactl` para el sonido (ver `salida_audio.rs`): una herramienta que ya esta
//! en todas las PC, sin librerias nuevas que compilar ni que empaquetar. Lo
//! que se analiza es TEXTO, asi que el analisis va aparte y con pruebas.
//!
//! POR QUE CADA LLAMADA LLEVA SU PROPIO LIMITE DE TIEMPO: `bluetoothctl` SE
//! CUELGA. Comprobado: pidiendole conectar un aparato que no existe, se queda
//! esperando para siempre en vez de terminar. Si la app lo llamara sin limite,
//! se congelaria entera en mitad de un evento. Por eso nunca se le llama "a
//! pelo": se le da un plazo y, si se pasa, se le mata y se avisa.

use std::io::Read;
use std::process::Stdio;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::downloader::clean_command;
use crate::en_otro_hilo;

/// Un aparato Bluetooth, como se lo muestra al usuario.
#[derive(Serialize, Clone)]
pub struct DispositivoBt {
    /// Direccion del aparato (lo que entiende `bluetoothctl`).
    pub mac: String,
    /// Nombre para mostrar ("AP3000BT", "JBL Charge 5"...).
    pub nombre: String,
    /// Esta conectado AHORA.
    pub conectado: bool,
    /// Ya esta emparejado (no hay que volver a emparejarlo).
    pub emparejado: bool,
    /// Sirve para sacar sonido: tiene el servicio "Audio Sink". Asi se
    /// distingue una cabina de un teclado, un raton o un celular.
    pub altavoz: bool,
}

/// Cuanto esperar a cada orden. Conectar tarda de verdad (el aparato tiene que
/// despertar y negociar), asi que lleva mas plazo que una simple consulta.
const PLAZO_CONSULTA: Duration = Duration::from_secs(10);
const PLAZO_CONEXION: Duration = Duration::from_secs(30);

/// Llama a `bluetoothctl` con un plazo. Devuelve su salida de texto.
///
/// La salida se recoge en un archivo y no por una tuberia a proposito: con una
/// tuberia, si el programa escribe mucho y nadie lee, los dos se quedan
/// esperando al otro para siempre. Con un archivo no puede pasar.
fn bluetoothctl(args: &[&str], plazo: Duration) -> Result<String, String> {
    let archivo = std::env::temp_dir().join(format!(
        "infiniity-dj-bt-{}-{}.txt",
        std::process::id(),
        Instant::now().elapsed().as_nanos()
    ));
    let salida = std::fs::File::create(&archivo)
        .map_err(|e| format!("No pude preparar la consulta al Bluetooth: {e}"))?;
    let errores = salida
        .try_clone()
        .map_err(|e| format!("No pude preparar la consulta al Bluetooth: {e}"))?;

    let mut cmd = clean_command("bluetoothctl");
    cmd.env("LC_ALL", "C");
    cmd.env("LANG", "C");
    cmd.args(args);
    cmd.stdout(Stdio::from(salida));
    cmd.stderr(Stdio::from(errores));
    // Sin entrada: si no, `bluetoothctl` se pone en modo interactivo y espera
    // que alguien le escriba ordenes, cosa que aqui no va a pasar nunca.
    cmd.stdin(Stdio::null());

    let mut hijo = cmd.spawn().map_err(|e| {
        format!(
            "No pude hablar con el Bluetooth (no se pudo ejecutar «bluetoothctl»: {e}). \
             Falta instalar bluez en este equipo."
        )
    })?;

    let arranque = Instant::now();
    let estado = loop {
        match hijo.try_wait() {
            Ok(Some(estado)) => break Some(estado),
            Ok(None) => {
                if arranque.elapsed() > plazo {
                    let _ = hijo.kill();
                    let _ = hijo.wait();
                    break None;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => {
                let _ = hijo.kill();
                let _ = hijo.wait();
                let _ = std::fs::remove_file(&archivo);
                return Err(format!("Fallo la consulta al Bluetooth: {e}"));
            }
        }
    };

    let mut texto = String::new();
    if let Ok(mut f) = std::fs::File::open(&archivo) {
        let _ = f.read_to_string(&mut texto);
    }
    let _ = std::fs::remove_file(&archivo);
    let texto = sin_colores(&texto);

    match estado {
        None => Err(
            "El Bluetooth del equipo no respondio a tiempo. Apagalo y vuelve a encenderlo, \
             o conecta la cabina desde la configuracion del sistema."
                .to_string(),
        ),
        Some(e) if !e.success() => Err(explicar(&texto)),
        Some(_) => Ok(texto),
    }
}

/// Quita los colores de la terminal. `bluetoothctl` los mete en medio de sus
/// mensajes (`\x1b[0;93mCHG\x1b[0m`) y sin quitarlos el analisis del texto no
/// encuentra nada.
fn sin_colores(texto: &str) -> String {
    let mut limpio = String::with_capacity(texto.len());
    let mut chars = texto.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            limpio.push(c);
            continue;
        }
        // Secuencia de color: va desde ESC hasta la primera letra.
        if chars.peek() == Some(&'[') {
            chars.next();
            for c in chars.by_ref() {
                if c.is_ascii_alphabetic() {
                    break;
                }
            }
        }
    }
    limpio
}

/// Traduce el fallo de `bluetoothctl` a algo que se pueda leer en un evento.
fn explicar(texto: &str) -> String {
    let t = texto.to_lowercase();
    if t.contains("page-timeout") || t.contains("connection timeout") {
        return "La cabina no respondio. Comprueba que este encendida, cerca, \
                y que no este conectada a otro equipo o celular."
            .to_string();
    }
    if t.contains("host is down") || t.contains("host-down") {
        // Lo que se ve cuando se intenta conectar una cabina que no contesta.
        // En un portatil del equipo salio siete veces seguidas: esa cabina
        // estaba apagada, y la que se queria usar estaba conectada al otro
        // portatil (una cabina conectada no se deja ver por los demas).
        return "La cabina no responde: está apagada, lejos, o conectada a otro portátil. \
                Si la está usando otro equipo, desconéctala ahí primero."
            .to_string();
    }
    if t.contains("not available") {
        return "Esa cabina ya no aparece. Dale a «Buscar cabinas» otra vez.".to_string();
    }
    if t.contains("authentication") {
        return "La cabina rechazo el emparejamiento. Ponla en modo emparejar \
                (normalmente dejando pulsado su boton de Bluetooth) y reintenta."
            .to_string();
    }
    if t.contains("already connected") {
        return "Ya estaba conectada.".to_string();
    }
    if t.contains("in progress") {
        return "Ya hay una conexion en marcha. Espera unos segundos.".to_string();
    }
    let ultima = texto
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .next_back()
        .unwrap_or("");
    if ultima.is_empty() {
        "El Bluetooth rechazo la orden.".to_string()
    } else {
        format!("El Bluetooth rechazo la orden: {ultima}")
    }
}

// ---------------------------------------------------------------------------
// Analisis del texto (aparte y con pruebas: no depende del equipo)
// ---------------------------------------------------------------------------

/// Lineas `Device AA:BB:... Nombre` de `bluetoothctl devices`.
fn parse_dispositivos(texto: &str) -> Vec<(String, String)> {
    texto
        .lines()
        .filter_map(|l| {
            let t = l.trim().strip_prefix("Device ")?;
            let (mac, nombre) = t.split_once(' ')?;
            let mac = mac.trim();
            let nombre = nombre.trim();
            // Sin direccion no se puede hacer nada con el aparato.
            if mac.len() < 17 || nombre.is_empty() {
                return None;
            }
            Some((mac.to_string(), nombre.to_string()))
        })
        .collect()
}

/// Lo que interesa de `bluetoothctl info <mac>`.
struct Info {
    nombre: String,
    conectado: bool,
    emparejado: bool,
    altavoz: bool,
    /// Datos crudos, para el registro de la ultima busqueda.
    icono: String,
    clase: Option<u32>,
    audio_sink: bool,
}

impl Info {
    fn vacia() -> Info {
        Info {
            nombre: String::new(),
            conectado: false,
            emparejado: false,
            altavoz: false,
            icono: String::new(),
            clase: None,
            audio_sink: false,
        }
    }
}

fn parse_info(texto: &str) -> Info {
    let mut info = Info::vacia();
    for linea in texto.lines() {
        let t = linea.trim();
        if let Some(v) = t.strip_prefix("Icon: ") {
            info.icono = v.trim().to_string();
        } else if let Some(v) = t.strip_prefix("Class: ") {
            let hex = v.split_whitespace().next().unwrap_or("").trim_start_matches("0x");
            info.clase = u32::from_str_radix(hex, 16).ok();
        } else if let Some(v) = t.strip_prefix("Name: ") {
            if info.nombre.is_empty() {
                info.nombre = v.trim().to_string();
            }
        } else if let Some(v) = t.strip_prefix("Connected: ") {
            info.conectado = v.trim() == "yes";
        } else if let Some(v) = t.strip_prefix("Paired: ") {
            info.emparejado = v.trim() == "yes";
        } else if t.starts_with("UUID:") && (t.contains("0000110b") || t.contains("Audio Sink")) {
            info.audio_sink = true;
        }
    }
    info.altavoz = es_cabina(info.audio_sink, &info.icono, info.clase);
    info
}

/// ¿Es una cabina? Decide con TRES señales del propio Bluetooth.
///
/// 1. El servicio «Audio Sink» (0000110b): el aparato reproduce sonido. PERO
///    muchas cabinas baratas solo lo dicen DESPUES de emparejarse: en un
///    portatil del equipo, la cabina «Bluetooth 2» no salio en la busqueda
///    mientras la tele y el otro portatil si (2026-10-28); en el portatil donde
///    se habia emparejado desde el sistema, si salia.
/// 2. El TIPO de aparato (clase), que si viaja en la busqueda: audio/video con
///    subtipo de altavoz, auriculares, audio portatil, coche o equipo de
///    musica. Es lo que deja ver una cabina nueva antes de emparejarla.
/// 3. El icono que BlueZ deriva de esa clase («audio-card»,
///    «audio-headphones»...), por si la clase no viniera.
///
/// Y fuera, aunque anuncien «Audio Sink»: ordenadores y telefonos (los
/// portatiles con PipeWire lo anuncian: salio el otro portatil como cabina) y
/// pantallas y teles (salio una tele LG).
fn es_cabina(audio_sink: bool, icono: &str, clase: Option<u32>) -> bool {
    let (mayor, menor) = match clase {
        Some(c) => ((c >> 8) & 0x1F, (c >> 2) & 0x3F),
        None => (0, 0),
    };
    let ordenador_o_telefono = icono.starts_with("computer")
        || icono.starts_with("phone")
        || mayor == 0x01
        || mayor == 0x02;
    // Audio/video (0x04) con subtipo de imagen: grabadoras, camaras, monitores,
    // pantallas con altavoz (teles), videoconferencia, consolas.
    let pantalla = icono.starts_with("video")
        || icono.starts_with("camera")
        || (mayor == 0x04 && (0x0B..=0x12).contains(&menor));
    if ordenador_o_telefono || pantalla {
        return false;
    }
    // Subtipos de sonido: 0x01 cascos, 0x02 manos libres, 0x05 altavoz,
    // 0x06 auriculares, 0x07 audio portatil, 0x08 coche, 0x0A equipo de musica.
    let clase_de_sonido = mayor == 0x04 && [0x01, 0x02, 0x05, 0x06, 0x07, 0x08, 0x0A].contains(&menor);
    audio_sink || clase_de_sonido || icono.starts_with("audio-")
}

/// ¿El Bluetooth del equipo esta encendido? (`bluetoothctl show`)
fn parse_encendido(texto: &str) -> bool {
    texto
        .lines()
        .filter_map(|l| l.trim().strip_prefix("Powered: "))
        .any(|v| v.trim() == "yes")
}

// ---------------------------------------------------------------------------
// Comandos que llama la interfaz
// ---------------------------------------------------------------------------

/// Estado del Bluetooth del equipo: si hay aparato y si esta encendido.
#[derive(Serialize, Clone)]
pub struct EstadoBt {
    /// El equipo tiene Bluetooth y `bluetoothctl` responde.
    pub hay: bool,
    /// Esta encendido.
    pub encendido: bool,
    /// Por que no se puede usar (vacio si todo bien).
    pub motivo: String,
}

#[tauri::command]
pub async fn bt_estado() -> EstadoBt {
    en_otro_hilo(|| Ok(estado_sinc())).await.unwrap_or(EstadoBt {
        hay: false,
        encendido: false,
        motivo: "No se pudo consultar el Bluetooth del equipo.".to_string(),
    })
}

fn estado_sinc() -> EstadoBt {
    match bluetoothctl(&["show"], PLAZO_CONSULTA) {
        Err(e) => EstadoBt {
            hay: false,
            encendido: false,
            motivo: e,
        },
        Ok(texto) => {
            // Sin controlador, `show` no falla: contesta vacio.
            if !texto.contains("Controller") {
                return EstadoBt {
                    hay: false,
                    encendido: false,
                    motivo: "Este equipo no tiene Bluetooth (o esta apagado por hardware)."
                        .to_string(),
                };
            }
            let encendido = parse_encendido(&texto);
            EstadoBt {
                hay: true,
                encendido,
                motivo: if encendido {
                    String::new()
                } else {
                    "El Bluetooth del equipo esta apagado.".to_string()
                },
            }
        }
    }
}

/// Enciende el Bluetooth del equipo (si estaba apagado).
#[tauri::command]
pub async fn bt_encender() -> Result<(), String> {
    en_otro_hilo(|| {
        bluetoothctl(&["power", "on"], PLAZO_CONSULTA)?;
        Ok(())
    })
    .await
}

/// Detalles de cada aparato conocido. Se consulta uno por uno porque la lista
/// a secas solo trae direccion y nombre, y hace falta saber si es una cabina.
fn detallar(parejas: Vec<(String, String)>) -> (Vec<DispositivoBt>, String) {
    let mut out = Vec::new();
    let mut registro = String::new();
    // Tope por si una busqueda larga encuentra medio barrio: mas de esto no
    // cabe en pantalla y solo haria esperar al usuario.
    for (mac, nombre) in parejas.into_iter().take(30) {
        let info = bluetoothctl(&["info", &mac], PLAZO_CONSULTA)
            .map(|t| parse_info(&t))
            .unwrap_or_else(|_| Info::vacia());
        registro.push_str(&format!(
            "{mac}  «{}»  clase={}  icono={}  audio_sink={}  emparejada={}  conectada={}  -> {}\n",
            if info.nombre.is_empty() { &nombre } else { &info.nombre },
            info.clase.map(|c| format!("0x{c:06x}")).unwrap_or_else(|| "?".into()),
            if info.icono.is_empty() { "?" } else { &info.icono },
            info.audio_sink,
            info.emparejado,
            info.conectado,
            if info.altavoz { "CABINA" } else { "no es cabina" },
        ));
        out.push(DispositivoBt {
            mac,
            nombre: if info.nombre.is_empty() {
                nombre
            } else {
                info.nombre
            },
            conectado: info.conectado,
            emparejado: info.emparejado,
            altavoz: info.altavoz,
        });
    }
    // Primero lo conectado, luego lo ya emparejado, y dentro por nombre: lo
    // que el usuario busca casi siempre esta arriba del todo.
    out.sort_by(|a, b| {
        b.conectado
            .cmp(&a.conectado)
            .then(b.emparejado.cmp(&a.emparejado))
            .then(a.nombre.to_lowercase().cmp(&b.nombre.to_lowercase()))
    });
    (out, registro)
}

/// Cabinas que el equipo ya conoce (emparejadas o vistas hace poco).
#[tauri::command]
pub async fn bt_dispositivos() -> Result<Vec<DispositivoBt>, String> {
    en_otro_hilo(dispositivos_sinc).await
}

fn dispositivos_sinc() -> Result<Vec<DispositivoBt>, String> {
    let texto = bluetoothctl(&["devices"], PLAZO_CONSULTA)?;
    Ok(detallar(parse_dispositivos(&texto)).0)
}

/// Donde queda lo que encontro la ultima busqueda (para el informe).
pub(crate) fn ruta_ultima_busqueda() -> std::path::PathBuf {
    crate::arranque::dir_cache().join("ultima-busqueda-bt.txt")
}

/// Busca cabinas encendidas alrededor durante `segundos` y devuelve lo que haya.
///
/// No se analiza lo que `scan on` va escribiendo mientras busca (llega a
/// trozos y lleno de colores): se deja que busque, y al terminar se vuelve a
/// pedir la lista completa, que ya incluye lo recien encontrado.
#[tauri::command]
pub async fn bt_buscar(segundos: u32) -> Result<Vec<DispositivoBt>, String> {
    en_otro_hilo(move || {
        let segundos = segundos.clamp(3, 30);
        let tiempo = segundos.to_string();
        // El plazo propio va por encima del de la busqueda: el que manda es el
        // de `bluetoothctl`, y este solo esta por si se cuelga.
        bluetoothctl(
            &["--timeout", &tiempo, "scan", "on"],
            Duration::from_secs(u64::from(segundos) + 10),
        )?;
        let texto = bluetoothctl(&["devices"], PLAZO_CONSULTA)?;
        let (lista, registro) = detallar(parse_dispositivos(&texto));
        // Se guarda TODO lo que se encontro, cabina o no, con el porque de la
        // decision. Sin esto, "no aparece mi cabina" era imposible de
        // diagnosticar a distancia: lo encontrado se borra del Bluetooth al
        // poco de terminar la busqueda y no llegaba al informe.
        let cabecera = format!(
            "Busqueda de {segundos} s, {} aparatos encontrados:\n",
            lista.len()
        );
        let _ = std::fs::create_dir_all(crate::arranque::dir_cache());
        if let Err(e) = std::fs::write(ruta_ultima_busqueda(), cabecera + &registro) {
            eprintln!("[bluetooth] no se pudo guardar la ultima busqueda: {e}");
        }
        Ok(lista)
    })
    .await
}

/// Conecta una cabina: la empareja si hace falta, la marca de confianza y la
/// conecta.
///
/// "De confianza" (`trust`) es importante para un evento: sin eso, el equipo
/// no deja que la cabina se reconecte sola cuando se apaga y se vuelve a
/// encender, y habria que repetir todo esto delante de la gente.
/// Devuelve un aviso si hubo que encender la tarjeta de la cabina (vacio si no).
#[tauri::command]
pub async fn bt_conectar(mac: String) -> Result<String, String> {
    en_otro_hilo(move || conectar_sinc(&mac)).await
}

fn conectar_sinc(mac: &str) -> Result<String, String> {
    let mac = mac.to_string();
    let info = bluetoothctl(&["info", &mac], PLAZO_CONSULTA)
        .map(|t| parse_info(&t))
        .unwrap_or_else(|_| Info::vacia());

    if info.conectado {
        // Ya estaba conectada... pero puede estarlo A MEDIAS (ver abajo).
        return Ok(crate::salida_audio::encender_tarjeta_si_hace_falta(&mac).unwrap_or_default());
    }

    if !info.emparejado {
        // `NoInputNoOutput`: una cabina no tiene teclado ni pantalla donde
        // escribir un codigo, asi que se empareja sin pedir nada.
        bluetoothctl(
            &["--agent", "NoInputNoOutput", "pair", &mac],
            PLAZO_CONEXION,
        )?;
    }

    // Que falle marcarla de confianza no impide sonar hoy: no se corta por eso,
    // pero queda dicho en el registro.
    if let Err(e) = bluetoothctl(&["trust", &mac], PLAZO_CONSULTA) {
        eprintln!("[bluetooth] no se pudo marcar de confianza {mac}: {e}");
    }

    bluetoothctl(&["connect", &mac], PLAZO_CONEXION)?;

    // Comprobar de verdad: `connect` puede terminar bien y el aparato quedar
    // sin conectar. Que no pase como con la salida de audio, que la app decia
    // que todo bien mientras no se oia nada.
    let despues = bluetoothctl(&["info", &mac], PLAZO_CONSULTA).map(|t| parse_info(&t));
    match despues {
        Ok(i) if !i.conectado => {
            return Err("La cabina acepto la orden pero no quedo conectada. \
                        Comprueba que no este emparejada con otro equipo o celular."
                .to_string());
        }
        // Si no se puede comprobar, no se inventa un fallo: la orden no dio error.
        _ => {}
    }

    // Tras (re)conectar, el sistema a veces deja la tarjeta de la cabina en
    // «off» (sin salida de sonido que elegir): medido en un informe del
    // 2026-10-27. Si pasa, se enciende en modo musica. Nada mas: el antiguo
    // "reavivado" por `transport = ""` se quito porque esa señal era falsa.
    Ok(crate::salida_audio::encender_tarjeta_si_hace_falta(&mac).unwrap_or_default())
}

/// Desconecta una cabina (sigue emparejada, para reconectarla de un toque).
#[tauri::command]
pub async fn bt_desconectar(mac: String) -> Result<(), String> {
    en_otro_hilo(move || {
        bluetoothctl(&["disconnect", &mac], PLAZO_CONEXION)?;
        Ok(())
    })
    .await
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn sin_colores_quita_lo_que_pinta_la_terminal() {
        let crudo = "[\u{1b}[0;93mCHG\u{1b}[0m] Controller C8:6E Discovering: yes";
        assert_eq!(sin_colores(crudo), "[CHG] Controller C8:6E Discovering: yes");
    }

    /// Salida real de `bluetoothctl devices` en el PC del equipo.
    const DEVICES: &str = r#"Device 41:42:AE:0F:D5:CD AP3000BT
Device F4:73:35:88:AF:C7 Keyboard K380
"#;

    #[test]
    fn parse_dispositivos_saca_direccion_y_nombre() {
        let d = parse_dispositivos(DEVICES);
        assert_eq!(d.len(), 2);
        assert_eq!(d[0].0, "41:42:AE:0F:D5:CD");
        assert_eq!(d[0].1, "AP3000BT");
        // Los nombres con espacios no se parten por la mitad.
        assert_eq!(d[1].1, "Keyboard K380");
    }

    #[test]
    fn parse_dispositivos_ignora_lineas_que_no_son_aparatos() {
        let d = parse_dispositivos("Discovery started\nDevice sin_nombre\n[CHG] Controller\n");
        assert!(d.is_empty(), "no deberia haber sacado nada: {}", d.len());
    }

    /// Salida real de `bluetoothctl info` del amplificador del equipo.
    const INFO_CABINA: &str = r#"Device 41:42:AE:0F:D5:CD (public)
	Name: AP3000BT
	Alias: AP3000BT
	Icon: audio-headphones
	Paired: yes
	Bonded: yes
	Trusted: yes
	Blocked: no
	Connected: no
	UUID: Audio Sink                (0000110b-0000-1000-8000-00805f9b34fb)
	UUID: A/V Remote Control        (0000110e-0000-1000-8000-00805f9b34fb)
"#;

    /// Un teclado: emparejado y conectado, pero NO sirve para sacar sonido.
    const INFO_TECLADO: &str = r#"Device F4:73:35:88:AF:C7 (public)
	Name: Keyboard K380
	Paired: yes
	Connected: yes
	UUID: Human Interface Device    (00001124-0000-1000-8000-00805f9b34fb)
"#;

    #[test]
    fn parse_info_reconoce_una_cabina() {
        let i = parse_info(INFO_CABINA);
        assert_eq!(i.nombre, "AP3000BT");
        assert!(i.emparejado);
        assert!(!i.conectado);
        assert!(i.altavoz, "tiene Audio Sink: es una cabina");
    }

    #[test]
    fn parse_info_no_confunde_un_teclado_con_una_cabina() {
        let i = parse_info(INFO_TECLADO);
        assert!(i.conectado);
        assert!(
            !i.altavoz,
            "un teclado no tiene Audio Sink y no debe salir como cabina"
        );
    }

    /// Salida real de `bluetoothctl info` de un PORTATIL del equipo: anuncia
    /// «Audio Sink» igual que una cabina, pero es un ordenador.
    const INFO_PORTATIL: &str = r#"Device 34:41:5D:00:00:01 (public)
	Name: infiniity-HP-Pavilion-dv5-Notebook-PC
	Class: 0x007c010c (8126732)
	Icon: computer
	Paired: no
	Connected: no
	UUID: Audio Sink                (0000110b-0000-1000-8000-00805f9b34fb)
	UUID: Audio Source              (0000110a-0000-1000-8000-00805f9b34fb)
"#;

    #[test]
    fn un_portatil_no_sale_como_cabina_aunque_anuncie_audio_sink() {
        let p = parse_info(INFO_PORTATIL);
        assert!(!p.altavoz, "un portatil no es una cabina");
        // La cabina real (Class 0x00240418, audio/video) sigue siendo cabina.
        let c = parse_info(&INFO_CABINA.replace("\tIcon: audio-headphones", "\tClass: 0x00240418 (2360344)\n\tIcon: audio-headphones"));
        assert!(c.altavoz, "la cabina sigue siendo cabina");
        // Un portatil sin icono pero con clase de ordenador, tampoco.
        let sin_icono = parse_info(&INFO_PORTATIL.replace("\tIcon: computer\n", ""));
        assert!(!sin_icono.altavoz);
    }

    /// Una cabina SIN emparejar, tal como la ve la busqueda: sin servicios
    /// todavia, pero con su clase (audio/video, altavoz) e icono.
    const INFO_CABINA_NUEVA: &str = r#"Device 27:6C:A8:EF:45:96 (public)
	Name: Bluetooth
	Alias: Bluetooth
	Class: 0x00240414 (2360340)
	Icon: audio-card
	Paired: no
	Connected: no
	RSSI: -62
"#;

    /// Una tele que anuncia «Audio Sink»: no es una cabina.
    const INFO_TELE: &str = r#"Device 20:3D:BD:00:00:01 (public)
	Name: webOS TV LED43LWSMARTBT
	Class: 0x0008043c (525372)
	Icon: video-display
	Paired: no
	Connected: no
	UUID: Audio Sink                (0000110b-0000-1000-8000-00805f9b34fb)
"#;

    #[test]
    fn una_cabina_nueva_sale_aunque_aun_no_diga_audio_sink() {
        let c = parse_info(INFO_CABINA_NUEVA);
        assert!(!c.audio_sink, "todavia no anuncia el servicio");
        assert!(c.altavoz, "pero por su tipo de aparato ES una cabina");
        // Solo con la clase (sin icono) tambien.
        let sin_icono = parse_info(&INFO_CABINA_NUEVA.replace("\tIcon: audio-card\n", ""));
        assert!(sin_icono.altavoz);
    }

    #[test]
    fn una_tele_no_sale_como_cabina() {
        let t = parse_info(INFO_TELE);
        assert!(t.audio_sink, "la tele anuncia Audio Sink...");
        assert!(!t.altavoz, "...pero es una pantalla, no una cabina");
    }

    #[test]
    fn host_is_down_dice_que_hacer() {
        let m = explicar("Failed to connect: org.bluez.Error.Failed br-connection-page-timeout Host is down");
        // page-timeout va antes y tambien vale; con solo «Host is down»:
        let m2 = explicar("avdtp_connect_cb() connect to 41:42:AA:A1:7E:93: Host is down (112)");
        assert!(m.contains("encendida") || m.contains("no responde"), "{m}");
        assert!(m2.contains("otro portátil"), "{m2}");
    }

    #[test]
    fn parse_encendido_lee_el_estado_del_aparato() {
        assert!(parse_encendido("Controller C8:6E (public)\n\tPowered: yes\n"));
        assert!(!parse_encendido("Controller C8:6E (public)\n\tPowered: no\n"));
    }

    #[test]
    fn explicar_traduce_los_fallos_que_se_ven_de_verdad() {
        let apagada = explicar("Failed to connect: org.bluez.Error.Failed br-connection-page-timeout");
        assert!(apagada.contains("encendida"), "{apagada}");
        assert!(explicar("Device 00:11 not available").contains("Buscar cabinas"));
        // Lo que no se reconoce se muestra tal cual, no se traga en silencio.
        assert!(explicar("Failed to connect: cosa rara").contains("cosa rara"));
    }

    /// Contra el Bluetooth de verdad: que la lista salga y que NO confunda un
    /// teclado con una cabina. Es lo unico que el usuario va a ver.
    #[test]
    #[ignore = "necesita bluetoothctl y el Bluetooth del equipo"]
    fn bt_dispositivos_real_separa_cabinas_de_lo_demas() {
        let lista = dispositivos_sinc().expect("hace falta bluetoothctl (bluez)");
        for d in &lista {
            println!(
                "  {} [{}] cabina={} emparejado={} conectado={}",
                d.nombre, d.mac, d.altavoz, d.emparejado, d.conectado
            );
            assert!(!d.mac.is_empty());
            assert!(!d.nombre.is_empty());
            let n = d.nombre.to_lowercase();
            if n.contains("keyboard") || n.contains("mouse") {
                assert!(!d.altavoz, "«{}» no es una cabina", d.nombre);
            }
        }
    }

    /// Contra el Bluetooth de verdad del equipo (se salta en CI).
    #[test]
    #[ignore = "necesita bluetoothctl y el Bluetooth del equipo"]
    fn bt_estado_real_responde() {
        let e = estado_sinc();
        assert!(e.hay, "deberia haber Bluetooth: {}", e.motivo);
        if !e.encendido {
            assert!(!e.motivo.is_empty(), "si esta apagado hay que decir por que");
        }
    }
}
