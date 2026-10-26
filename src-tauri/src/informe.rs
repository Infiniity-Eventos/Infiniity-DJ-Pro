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

fn armar_informe(estado_app: &str) -> String {
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
) -> Result<String, String> {
    en_otro_hilo(move || guardar_informe_sinc(&carpeta_musica, &estado_app)).await
}

fn guardar_informe_sinc(carpeta_musica: &str, estado_app: &str) -> Result<String, String> {
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
    let texto = armar_informe(estado_app);
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
        // Sin destino indicado se escribe en temporales: asi `--ignored` no
        // revienta cuando se corren todas las pruebas de golpe.
        let destino = std::env::var("DJ_INFORME_DESTINO").unwrap_or_else(|_| {
            std::env::temp_dir()
                .join("infiniity-dj-informe-real")
                .to_string_lossy()
                .into_owned()
        });
        let ruta = guardar_informe_sinc(&destino, "salida elegida: (prueba)\nmotor de sonido: running").unwrap();
        println!("INFORME EN: {ruta}");
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
        let t = armar_informe("salida elegida: cabina bluetooth\nmotor: running");
        assert!(t.contains("salida elegida: cabina bluetooth"));
        assert!(t.contains("INFORME DE INFINIITY DJ"));
        // Las secciones que de verdad explican un "no suena".
        assert!(t.contains("=== SONIDO: salidas"));
        assert!(t.contains("Active Profile"));
        assert!(t.contains("=== BLUETOOTH ==="));
    }

    #[test]
    fn sin_carpeta_de_musica_lo_dice_en_vez_de_perder_el_informe() {
        let e = guardar_informe_sinc("", "lo que sea").unwrap_err();
        assert!(e.contains("carpeta de musica"), "{e}");
    }

    #[test]
    fn el_informe_queda_dentro_de_sin_clasificar() {
        let tmp = std::env::temp_dir().join(format!("dj-informe-prueba-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let ruta = guardar_informe_sinc(&tmp.to_string_lossy(), "estado de prueba").unwrap();
        assert!(ruta.contains("Sin clasificar"), "{ruta}");
        let texto = std::fs::read_to_string(&ruta).unwrap();
        assert!(texto.contains("estado de prueba"));
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
