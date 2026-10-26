//! Informe de fallos: dejar por escrito QUE ESTA PASANDO en la PC donde falla.
//!
//! POR QUE EXISTE: las PC del equipo estan en otras casas y en otros eventos.
//! Cuando algo no suena, lo unico que llega es "no suena", por WhatsApp, con
//! la persona en mitad de un evento y sin forma de mirar nada. Adivinar desde
//! aqui cuesta dias y a veces no se acierta.
//!
//! COMO LLEGA EL INFORME: se guarda DENTRO de la carpeta de musica, que es la
//! que ya viaja sola entre las PC por Sync (Syncthing copia la carpeta entera,
//! sin mirar extensiones). No hace falta que nadie mande nada: aparece aqui.
//!
//! Se guarda en "Sin clasificar" porque es la carpeta que el equipo ya mira. Y
//! como la biblioteca solo lista .mp3 y .wav (library.rs), un .txt no se cuela
//! entre las canciones.

use std::fmt::Write as _;

use crate::downloader::clean_command;
use crate::en_otro_hilo;

/// Ejecuta un programa del sistema y devuelve su salida para el informe.
/// Que falte una herramienta no arruina el informe: se deja dicho y se sigue.
fn recoger(programa: &str, args: &[&str]) -> String {
    let mut cmd = clean_command(programa);
    cmd.env("LC_ALL", "C");
    cmd.env("LANG", "C");
    cmd.args(args);
    match cmd.output() {
        Err(e) => format!("(no se pudo ejecutar «{programa}»: {e})"),
        Ok(out) => {
            let texto = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            if texto.is_empty() && !err.is_empty() {
                format!("(sin salida; error: {err})")
            } else if texto.is_empty() {
                "(sin salida)".to_string()
            } else {
                texto
            }
        }
    }
}

fn nombre_del_equipo() -> String {
    std::fs::read_to_string("/proc/sys/kernel/hostname")
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| "equipo-desconocido".to_string())
}

fn sistema() -> String {
    let so = std::fs::read_to_string("/etc/os-release")
        .ok()
        .and_then(|t| {
            t.lines()
                .find_map(|l| l.strip_prefix("PRETTY_NAME=").map(|v| v.trim_matches('"').to_string()))
        })
        .unwrap_or_else(|| "(no se pudo leer /etc/os-release)".to_string());
    format!("{so}\nNucleo: {}", recoger("uname", &["-r"]))
}

/// Las cabinas Bluetooth, una por una. Sin el detalle de cada una no se puede
/// saber si quedo en modo musica o en modo manos libres, que es justo lo que
/// deja todo "conectado" y mudo.
fn detalle_bluetooth() -> String {
    let lista = recoger("bluetoothctl", &["devices"]);
    let mut out = format!("--- bluetoothctl show ---\n{}\n", recoger("bluetoothctl", &["show"]));
    let _ = write!(out, "\n--- bluetoothctl devices ---\n{lista}\n");
    for linea in lista.lines().take(15) {
        let Some(resto) = linea.trim().strip_prefix("Device ") else {
            continue;
        };
        let Some((mac, _)) = resto.split_once(' ') else {
            continue;
        };
        let _ = write!(
            out,
            "\n--- bluetoothctl info {mac} ---\n{}\n",
            recoger("bluetoothctl", &["info", mac])
        );
    }
    out
}

/// ¿LLEGA SONIDO DE VERDAD A LA SALIDA ELEGIDA?
///
/// Esta es la medida que parte el problema en dos, y la unica que no se puede
/// deducir mirando estados: se graba un segundo de lo que sale POR esa salida
/// (su "monitor") y se mide el pico.
///   - Si el motor saca sonido y aqui tambien llega: el sonido SI se esta
///     enviando al aparato, y lo que falla esta en el aparato.
///   - Si el motor saca sonido y aqui no llega: se pierde por el camino, entre
///     el navegador interno y el sonido del sistema.
/// Sin esto solo se puede adivinar, y adivinar desde otra ciudad cuesta dias.
/// Comprobacion de si el sonido llega a la salida, para la interfaz.
#[derive(serde::Serialize, Clone)]
pub struct Llegada {
    /// Llega sonido de verdad a esa salida.
    pub llega: bool,
    /// Explicacion para mostrar o para el informe.
    pub detalle: String,
    /// El programa arranco preparado para una cabina Bluetooth.
    pub preparado_bluetooth: bool,
}

/// ¿Esta llegando sonido a `salida`? Tarda unos segundos: graba de ella.
#[tauri::command]
pub async fn audio_llega_sonido(salida: String) -> Result<Llegada, String> {
    en_otro_hilo(move || {
        let detalle = medir_llegada(&salida);
        Ok(Llegada {
            llega: detalle.starts_with("LLEGA SONIDO"),
            detalle,
            preparado_bluetooth: crate::arranque::sonido_preparado_para_bluetooth(),
        })
    })
    .await
}

pub(crate) fn medir_llegada(sink: &str) -> String {
    if sink.trim().is_empty() {
        return "(no hay salida elegida)".to_string();
    }
    let archivo = std::env::temp_dir().join(format!("infiniity-dj-medida-{}.raw", std::process::id()));
    let Ok(salida) = std::fs::File::create(&archivo) else {
        return "(no se pudo preparar la medicion)".to_string();
    };
    let mut cmd = clean_command("parecord");
    cmd.env("LC_ALL", "C");
    cmd.args([
        &format!("--device={sink}.monitor"),
        "--raw",
        "--format=s16le",
        "--rate=48000",
        "--channels=2",
    ]);
    cmd.stdout(std::process::Stdio::from(salida));
    cmd.stderr(std::process::Stdio::null());
    let Ok(mut hijo) = cmd.spawn() else {
        let _ = std::fs::remove_file(&archivo);
        return "(falta «parecord»: instala pulseaudio-utils)".to_string();
    };
    // TRES SEGUNDOS Y MEDIO, y no menos: medido en este equipo, `parecord`
    // tarda unos dos segundos en soltar lo primero que graba. Con un segundo y
    // medio devolvia CERO bytes aunque la salida estuviera reproduciendo, y se
    // habria leido como "no llega sonido" cuando si llegaba. Una medida que
    // miente es peor que no medir.
    std::thread::sleep(std::time::Duration::from_millis(3500));
    let _ = hijo.kill();
    let _ = hijo.wait();

    let datos = std::fs::read(&archivo).unwrap_or_default();
    let _ = std::fs::remove_file(&archivo);
    if datos.len() < 64 {
        // Una salida en reposo no produce nada en su monitor. Si la app cree
        // que esta sonando por ahi, esto ya dice que no es verdad.
        return format!(
            "NO LLEGA NADA — «{sink}» no esta reproduciendo (no se pudo grabar ni un instante de ella)"
        );
    }
    let mut pico: i32 = 0;
    for trozo in datos.chunks_exact(2) {
        let v = i16::from_le_bytes([trozo[0], trozo[1]]).unsigned_abs() as i32;
        if v > pico {
            pico = v;
        }
    }
    let frac = f64::from(pico) / 32768.0;
    if frac < 0.0005 {
        format!("SILENCIO — por «{sink}» no esta saliendo nada (pico {frac:.5})")
    } else {
        format!(
            "LLEGA SONIDO por «{sink}»: {:.1} dB (pico {frac:.4})",
            20.0 * frac.log10()
        )
    }
}

fn armar_informe(estado_app: &str, salida: &str) -> String {
    let ahora = chrono_simple();
    let mut t = String::new();
    let _ = write!(
        t,
        "INFORME DE INFINIITY DJ\n\
         =======================\n\
         Fecha: {ahora}\n\
         Equipo: {}\n\
         Programa: {}\n\n\
         Este archivo lo genera la app cuando algo falla, y viaja solo por Sync\n\
         hasta el PC original. No hay que mandarlo por WhatsApp ni borrarlo con\n\
         prisa: ocupa unos pocos kilobytes.\n\n",
        nombre_del_equipo(),
        env!("CARGO_PKG_VERSION"),
    );

    let _ = write!(t, "=== LO QUE DICE EL PROGRAMA ===\n{estado_app}\n\n");
    let _ = write!(
        t,
        "=== ¿LLEGA SONIDO A LA SALIDA ELEGIDA? ===\n{}\n\n",
        medir_llegada(salida)
    );
    let _ = write!(t, "=== SISTEMA ===\n{}\n\n", sistema());
    let _ = write!(
        t,
        "=== SONIDO: resumen ===\n{}\n\n",
        recoger("pactl", &["info"])
    );
    let _ = write!(
        t,
        "=== SONIDO: salidas (busca «State:» y «Mute:») ===\n{}\n\n",
        recoger("pactl", &["list", "sinks"])
    );
    let _ = write!(
        t,
        "=== SONIDO: quien esta sonando (busca el flujo de la app) ===\n{}\n\n",
        recoger("pactl", &["list", "sink-inputs"])
    );
    let _ = write!(
        t,
        "=== SONIDO: aparatos y su modo de trabajo (busca «Active Profile») ===\n{}\n\n",
        recoger("pactl", &["list", "cards"])
    );
    let _ = write!(t, "=== BLUETOOTH ===\n{}\n", detalle_bluetooth());

    // EL PORQUE. Cuando una cabina Bluetooth queda "conectada a medias" (su
    // salida existe pero sin canal de sonido), `pactl` solo muestra el QUE. El
    // motivo —no se pudo abrir el transporte, fallo la negociacion del codec,
    // el aparato colgo, un error de D-Bus— lo escribe el servidor de sonido en
    // su registro, y el demonio de Bluetooth en el suyo. Sin esto, el informe
    // dice "no suena" con todo lujo de detalle y no dice por que.
    let _ = write!(
        t,
        "=== SERVICIOS DE SONIDO DEL USUARIO (tienen que estar «active») ===\n{}\n\n",
        ["wireplumber", "pipewire", "pipewire-pulse", "pipewire-media-session"]
            .iter()
            .map(|u| format!("{u}: {}", recoger("systemctl", &["--user", "is-active", u])))
            .collect::<Vec<_>>()
            .join("\n")
    );
    let _ = write!(
        t,
        "=== REGISTRO DEL SERVIDOR DE SONIDO (busca «bluez», «transport», «error», «failed») ===\n{}\n\n",
        recoger(
            "journalctl",
            &["--user", "-u", "wireplumber", "-u", "pipewire", "-u", "pipewire-pulse", "-n", "120", "--no-pager"]
        )
    );
    let _ = write!(
        t,
        "=== REGISTRO DEL BLUETOOTH DEL EQUIPO (busca «avdtp», «a2dp», «connect») ===\n{}\n",
        recoger("journalctl", &["-u", "bluetooth", "-n", "60", "--no-pager"])
    );
    // El adaptador en si (firmware, USB que se duerme, reinicios del chip): lo
    // escribe el nucleo. Si no se puede leer sin permisos, que lo diga.
    let _ = write!(
        t,
        "\n=== REGISTRO DEL NUCLEO SOBRE BLUETOOTH (busca «hci0», «btusb», «firmware») ===\n{}\n",
        recoger("journalctl", &["-k", "-n", "400", "--no-pager", "-g", "(?i)bluetooth|hci0|btusb"])
    );
    t
}

/// Fecha y hora legibles, sin traerse una libreria entera para esto.
fn chrono_simple() -> String {
    let salida = recoger("date", &["+%Y-%m-%d %H:%M:%S"]);
    if salida.starts_with('(') {
        // `date` fallo: al menos dejar algo que ordene los informes.
        let s = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        return format!("(segundos desde 1970: {s})");
    }
    salida
}

/// Nombre de archivo sin caracteres que den problemas al viajar entre PC.
fn limpiar_nombre(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == ' ' { c } else { '-' })
        .collect()
}

/// Guarda el informe dentro de la carpeta de musica y devuelve donde quedo.
#[tauri::command]
pub async fn guardar_informe(
    carpeta_musica: String,
    estado_app: String,
    salida: String,
) -> Result<String, String> {
    en_otro_hilo(move || guardar_informe_sinc(&carpeta_musica, &estado_app, &salida)).await
}

fn guardar_informe_sinc(
    carpeta_musica: &str,
    estado_app: &str,
    salida: &str,
) -> Result<String, String> {
    if carpeta_musica.trim().is_empty() {
        return Err(
            "Todavia no hay carpeta de musica elegida, asi que el informe no tendria por donde \
             viajar. Elige la carpeta de musica y vuelve a intentarlo."
                .to_string(),
        );
    }
    let destino = std::path::Path::new(carpeta_musica).join("Sin clasificar");
    std::fs::create_dir_all(&destino).map_err(|e| {
        format!("No se pudo preparar la carpeta «Sin clasificar» para el informe: {e}")
    })?;

    let archivo = destino.join(format!(
        "INFORME Infiniity DJ - {} - {}.txt",
        limpiar_nombre(&nombre_del_equipo()),
        limpiar_nombre(&chrono_simple()),
    ));
    let texto = armar_informe(estado_app, salida);
    std::fs::write(&archivo, texto)
        .map_err(|e| format!("No se pudo guardar el informe: {e}"))?;
    Ok(archivo.to_string_lossy().to_string())
}

#[cfg(test)]
mod pruebas {
    use super::*;

    /// Genera un informe DE VERDAD en este equipo, para poder leerlo y
    /// comprobar que sirve para algo (se salta en CI: necesita pactl).
    #[test]
    #[ignore = "genera un informe real de este equipo"]
    fn informe_real_de_este_equipo() {
        let _candado = crate::CANDADO_SONIDO.lock().unwrap_or_else(|e| e.into_inner());

        // Sin destino indicado se escribe en temporales: asi `--ignored` no
        // revienta cuando se corren todas las pruebas de golpe.
        let destino = std::env::var("DJ_INFORME_DESTINO").unwrap_or_else(|_| {
            std::env::temp_dir()
                .join("infiniity-dj-informe-real")
                .to_string_lossy()
                .into_owned()
        });
        let ruta = guardar_informe_sinc(&destino, "salida elegida: (prueba)\nmotor de sonido: running", "").unwrap();
        println!("INFORME EN: {ruta}");
    }

    /// Herramienta de la prueba: un WAV con un tono, para tener algo que medir.
    fn tono_wav(ruta: &std::path::Path) {
        let (tasa, segundos) = (48_000u32, 12u32);
        let muestras = tasa * segundos;
        let datos = muestras * 2;
        let mut w: Vec<u8> = Vec::new();
        w.extend(b"RIFF");
        w.extend(&(36 + datos).to_le_bytes());
        w.extend(b"WAVEfmt ");
        w.extend(&16u32.to_le_bytes());
        w.extend(&1u16.to_le_bytes());
        w.extend(&1u16.to_le_bytes());
        w.extend(&tasa.to_le_bytes());
        w.extend(&(tasa * 2).to_le_bytes());
        w.extend(&2u16.to_le_bytes());
        w.extend(&16u16.to_le_bytes());
        w.extend(b"data");
        w.extend(&datos.to_le_bytes());
        for n in 0..muestras {
            let t = f64::from(n) / f64::from(tasa);
            let v = (t * 440.0 * std::f64::consts::TAU).sin() * 9000.0;
            w.extend(&(v as i16).to_le_bytes());
        }
        std::fs::write(ruta, w).unwrap();
    }

    /// Contra el sonido real del equipo: medir una salida en silencio y luego
    /// con un tono sonando. Si no distinguiera, la medida no serviria de nada.
    /// Suena en una salida de pega, asi que no se oye.
    #[test]
    #[ignore = "necesita pactl/parecord y el sonido del equipo"]
    fn medir_llegada_distingue_silencio_de_sonido() {
        let _candado = crate::CANDADO_SONIDO.lock().unwrap_or_else(|e| e.into_inner());

        let modulo = recoger("pactl", &["load-module", "module-null-sink", "sink_name=djmedida"]);
        let modulo = modulo.trim().to_string();
        assert!(
            modulo.chars().all(|c| c.is_ascii_digit()) && !modulo.is_empty(),
            "no se pudo crear la salida de pega: {modulo}"
        );

        let en_silencio = medir_llegada("djmedida");

        let wav = std::env::temp_dir().join("infiniity-dj-medida-tono.wav");
        tono_wav(&wav);
        let mut hijo = clean_command("paplay")
            .env("PULSE_SINK", "djmedida")
            .arg(&wav)
            .spawn()
            .expect("hace falta paplay (pulseaudio-utils)");
        std::thread::sleep(std::time::Duration::from_millis(500));
        let con_sonido = medir_llegada("djmedida");

        let _ = hijo.kill();
        let _ = hijo.wait();
        let _ = std::fs::remove_file(&wav);
        let _ = recoger("pactl", &["unload-module", &modulo]);

        println!("  sin nada sonando: {en_silencio}");
        println!("  con un tono     : {con_sonido}");
        // Sin nada sonando, la salida esta en reposo: lo que NO puede decir es
        // que llega sonido.
        assert!(!en_silencio.contains("LLEGA SONIDO"), "{en_silencio}");
        assert!(con_sonido.contains("LLEGA SONIDO"), "{con_sonido}");
    }

    #[test]
    fn limpiar_nombre_deja_algo_que_viaja_entre_pc() {
        assert_eq!(limpiar_nombre("Portatil Sharon"), "Portatil Sharon");
        // Los dos puntos de la hora y las barras romperian el nombre.
        assert_eq!(limpiar_nombre("2026-10-26 10:28:48"), "2026-10-26 10-28-48");
        assert_eq!(limpiar_nombre("a/b\\c"), "a-b-c");
    }

    #[test]
    fn el_informe_lleva_lo_que_dice_el_programa() {
        let t = armar_informe("salida elegida: cabina bluetooth\nmotor: running", "");
        assert!(t.contains("salida elegida: cabina bluetooth"));
        assert!(t.contains("INFORME DE INFINIITY DJ"));
        // Las secciones que de verdad explican un "no suena".
        assert!(t.contains("=== SONIDO: salidas"));
        assert!(t.contains("Active Profile"));
        assert!(t.contains("=== BLUETOOTH ==="));
    }

    #[test]
    fn sin_carpeta_de_musica_lo_dice_en_vez_de_perder_el_informe() {
        let e = guardar_informe_sinc("", "lo que sea", "").unwrap_err();
        assert!(e.contains("carpeta de musica"), "{e}");
    }

    #[test]
    fn el_informe_queda_dentro_de_sin_clasificar() {
        let tmp = std::env::temp_dir().join(format!("dj-informe-prueba-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let ruta = guardar_informe_sinc(&tmp.to_string_lossy(), "estado de prueba", "").unwrap();
        assert!(ruta.contains("Sin clasificar"), "{ruta}");
        let texto = std::fs::read_to_string(&ruta).unwrap();
        assert!(texto.contains("estado de prueba"));
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
