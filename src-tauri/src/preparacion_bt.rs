//! Preparar el equipo para que el sonido de la app llegue a una cabina Bluetooth.
//!
//! LO QUE SE MIDIO (2026-10-27, portatil Pavilion dv5, Mint 22.1, PipeWire
//! 1.0.5, cabina «Bluetooth 2», con la cancion SONANDO al guardar el informe):
//! el motor de la app tenia sonido dentro (-8 dB) y el flujo que la app le
//! entregaba al sistema iba en SILENCIO (grabando solo ese flujo). Firefox
//! sonaba por la misma salida, en el mismo portatil. Ni la frecuencia (0.4.53
//! la igualo a 48000 Hz) ni rehacer la conexion lo arreglaban.
//!
//! (Resultado: con 75 ms la app SONO por la cabina por primera vez, pero
//! entrecortado; desde la 0.4.55 son 200 ms. Ver `REGLA`.)
//!
//! LA UNICA DIFERENCIA QUE QUEDABA con Firefox, en el mismo informe: el margen
//! de sonido que cada uno tiene preparado. Firefox, `node.latency 3600/48000`
//! (75 ms); la app, `1920/48000` (40 ms). Con cable 40 ms sobran; el Bluetooth
//! trabaja en tandas mas grandes, y un flujo que no llega a tiempo no suena
//! bajito: el sistema lo rellena con silencio.
//!
//! POR QUE AQUI Y NO EN LA APP: ese margen lo decide el navegador interno y no
//! se puede cambiar desde dentro. Comprobado: WebKitGTK ignora `latencyHint`
//! (da 2,7 ms pida lo que pida) y `PULSE_LATENCY_MSEC` no cambia el bufer de su
//! salida de GStreamer. Lo que SI funciona, comprobado en este PC con una
//! salida de GStreamer igual: una regla del servidor de sonido
//! (`pulse.rules` de pipewire-pulse) que fija un minimo para UN programa. Es el
//! mecanismo documentado para este tipo de problema con otras apps de audio.
//!
//! LA PREPARACION ANTERIOR (0.4.49-0.4.53) era otra cosa: configuraba el
//! Bluetooth de WirePlumber (solo audio, SBC). Se aplico bien en dos portatiles
//! y no ayudo, asi que se retira: si sigue puesta, preparar la quita.
//!
//! POR QUE EL REINICIO VA SOLO AL PULSAR EL BOTON: el servidor de sonido lee
//! estas reglas al arrancar. Reiniciarlo corta el sonido del equipo un par de
//! segundos, y una version anterior que reiniciaba sola entro en bucle y trabo
//! un portatil (regla 8). Aqui: una vez, porque el usuario lo pidio, sin
//! musica, y con aviso.
//!
//! REVERSIBLE: «Quitar preparación» borra el archivo y reinicia una vez.

use serde::Serialize;
use std::path::PathBuf;

use crate::downloader::clean_command;
use crate::en_otro_hilo;

/// La regla nueva: margen minimo para el sonido de la app.
const NOMBRE_REGLA: &str = "51-infiniity-dj-margen.conf";

/// Archivos de la preparacion anterior (WirePlumber), que se retiran.
const NOMBRE_LUA_VIEJO: &str = "51-infiniity-cabina.lua";
const NOMBRE_CONF_VIEJO: &str = "51-infiniity-cabina.conf";

/// Regla para pipewire-pulse. `application.name = "infiniity-dj"` es como se
/// presenta el sonido de la app (sale asi en todos los informes).
///
/// 9600/48000 = 200 ms. La primera version (0.4.54) puso 3600/48000 = 75 ms,
/// lo que tiene Firefox, y fue LA PRIMERA VEZ EN DOS DIAS QUE LA APP SONO POR
/// LA CABINA (2026-10-27 22:10, portatil Pavilion, «Bluetooth 2")... pero
/// entrecortado: el margen ayudaba y aun se quedaba corto a ratos. Con 200 ms,
/// comprobado aqui, el bufer que el sistema le guarda a la app pasa de 33600 a
/// 115200 bytes (sin regla: 21120). El Bluetooth ya añade su propio retardo,
/// asi que en la cabina no se nota; con cable, en un equipo preparado, el play
/// y el crossfader responden un poco mas tarde.
pub const REGLA: &str = r#"# Infiniity DJ: margen de sonido para que llegue a cabinas Bluetooth.
# Solo afecta a Infiniity DJ. Reversible: borrar este archivo y reiniciar
# pipewire-pulse (o pulsar «Quitar preparación» en la app).
pulse.rules = [
  {
    matches = [ { application.name = "infiniity-dj" } ]
    actions = {
      update-props = {
        pulse.min.quantum = 9600/48000
        pulse.min.req = 9600/48000
      }
    }
  }
]
"#;

fn dir_config() -> PathBuf {
    std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .unwrap_or_else(std::env::temp_dir)
}

fn ruta_regla() -> PathBuf {
    dir_config().join("pipewire").join("pipewire-pulse.conf.d").join(NOMBRE_REGLA)
}

fn rutas_viejas() -> [PathBuf; 2] {
    let wp = dir_config().join("wireplumber");
    [
        wp.join("bluetooth.lua.d").join(NOMBRE_LUA_VIEJO),
        wp.join("wireplumber.conf.d").join(NOMBRE_CONF_VIEJO),
    ]
}

/// Estado de la preparacion, para la interfaz y el informe.
#[derive(Serialize, Clone)]
pub struct EstadoPreparacion {
    /// La regla de margen esta puesta y es la actual.
    pub preparado: bool,
    /// Queda una preparacion anterior (la de WirePlumber, o una regla distinta):
    /// hay que volver a preparar.
    pub antigua: bool,
    /// Donde estan (o estarian) los archivos.
    pub rutas: Vec<String>,
}

fn estado_sinc() -> EstadoPreparacion {
    let regla = ruta_regla();
    let actual = std::fs::read_to_string(&regla).map(|t| t == REGLA).unwrap_or(false);
    let regla_distinta = regla.is_file() && !actual;
    let hay_vieja = rutas_viejas().iter().any(|r| r.is_file());
    let mut rutas = vec![regla.to_string_lossy().into_owned()];
    rutas.extend(rutas_viejas().iter().map(|r| r.to_string_lossy().into_owned()));
    EstadoPreparacion {
        preparado: actual && !hay_vieja,
        antigua: hay_vieja || regla_distinta,
        rutas,
    }
}

#[tauri::command]
pub async fn bt_preparacion_estado() -> EstadoPreparacion {
    en_otro_hilo(|| Ok(estado_sinc())).await.unwrap_or(EstadoPreparacion {
        preparado: false,
        antigua: false,
        rutas: Vec::new(),
    })
}

/// Reinicia servicios de sonido del usuario. Corta el sonido un par de segundos.
fn reiniciar(servicios: &[&str]) -> Result<(), String> {
    let mut args = vec!["--user", "restart"];
    args.extend_from_slice(servicios);
    let out = clean_command("systemctl")
        .args(&args)
        .output()
        .map_err(|e| format!("No se pudo ejecutar systemctl: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "No se pudo reiniciar el sonido del equipo ({}): {}",
            servicios.join(", "),
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    // Darle tiempo a volver antes de que la interfaz consulte nada.
    std::thread::sleep(std::time::Duration::from_millis(2500));
    Ok(())
}

/// Borra los archivos de la preparacion anterior. Devuelve si habia alguno.
fn quitar_viejos() -> Result<bool, String> {
    let mut habia = false;
    for ruta in rutas_viejas() {
        if ruta.exists() {
            habia = true;
            std::fs::remove_file(&ruta)
                .map_err(|e| format!("No se pudo borrar {}: {e}", ruta.display()))?;
        }
    }
    Ok(habia)
}

/// Pone la regla de margen (y retira la preparacion anterior si estaba).
#[tauri::command]
pub async fn bt_preparar_equipo() -> Result<String, String> {
    en_otro_hilo(|| {
        let habia_vieja = quitar_viejos()?;
        let regla = ruta_regla();
        if let Some(d) = regla.parent() {
            std::fs::create_dir_all(d)
                .map_err(|e| format!("No se pudo crear {}: {e}", d.display()))?;
        }
        std::fs::write(&regla, REGLA)
            .map_err(|e| format!("No se pudo escribir {}: {e}", regla.display()))?;
        // pipewire-pulse lee la regla; wireplumber solo hace falta si habia que
        // descargar la configuracion de Bluetooth anterior.
        if habia_vieja {
            reiniciar(&["wireplumber", "pipewire-pulse"])?;
        } else {
            reiniciar(&["pipewire-pulse"])?;
        }
        Ok("Equipo preparado para cabinas Bluetooth.".to_string())
    })
    .await
}

/// Ya se intento preparar en esta sesion y fallo: no reintentar solo.
///
/// POR QUE: preparar reinicia el sonido del equipo. Una version anterior que
/// reiniciaba sola entro en bucle y trabo un portatil (regla 8). Esta solo
/// reinicia si la regla NO esta puesta (una vez por portatil, para siempre), y
/// si ese unico intento falla, no lo repite hasta reabrir la app.
static PREPARACION_FALLIDA: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Prepara el equipo SOLO si hace falta. Devuelve si tuvo que hacerlo (y por
/// tanto reiniciar el sonido): quien llama tiene que rehacer la conexion de
/// sonido de la app para que la nueva nazca con el margen.
///
/// `reiniciar_fn` va inyectado para poder probarlo sin tocar el sonido real.
fn asegurar_preparacion_con(
    reiniciar_fn: &dyn Fn(&[&str]) -> Result<(), String>,
) -> Result<bool, String> {
    use std::sync::atomic::Ordering;
    if estado_sinc().preparado {
        return Ok(false); // ya estaba: no se toca nada
    }
    if PREPARACION_FALLIDA.load(Ordering::SeqCst) {
        return Err("La preparación del equipo ya falló en esta sesión; cierra y abre la app para \
                    reintentarlo."
            .to_string());
    }
    let resultado = (|| {
        let habia_vieja = quitar_viejos()?;
        let regla = ruta_regla();
        if let Some(d) = regla.parent() {
            std::fs::create_dir_all(d)
                .map_err(|e| format!("No se pudo crear {}: {e}", d.display()))?;
        }
        std::fs::write(&regla, REGLA)
            .map_err(|e| format!("No se pudo escribir {}: {e}", regla.display()))?;
        if habia_vieja {
            reiniciar_fn(&["wireplumber", "pipewire-pulse"])
        } else {
            reiniciar_fn(&["pipewire-pulse"])
        }
    })();
    match resultado {
        Ok(()) => Ok(true),
        Err(e) => {
            PREPARACION_FALLIDA.store(true, Ordering::SeqCst);
            Err(e)
        }
    }
}

/// Al conectar o elegir una cabina: prepara el equipo si todavia no lo esta.
/// Devuelve `true` si lo hizo (la interfaz rehace entonces la conexion de
/// sonido de la app; comprobado que una conexion nueva nace con el margen sin
/// cerrar la app).
#[tauri::command]
pub async fn bt_asegurar_preparacion() -> Result<bool, String> {
    en_otro_hilo(|| asegurar_preparacion_con(&reiniciar)).await
}

/// Quita la regla (y lo anterior si quedara) y reinicia una vez.
#[tauri::command]
pub async fn bt_quitar_preparacion() -> Result<String, String> {
    en_otro_hilo(|| {
        let habia_vieja = quitar_viejos()?;
        let regla = ruta_regla();
        if regla.exists() {
            std::fs::remove_file(&regla)
                .map_err(|e| format!("No se pudo borrar {}: {e}", regla.display()))?;
        }
        if habia_vieja {
            reiniciar(&["wireplumber", "pipewire-pulse"])?;
        } else {
            reiniciar(&["pipewire-pulse"])?;
        }
        Ok("Preparación quitada; el sonido del equipo vuelve a su configuración normal.".to_string())
    })
    .await
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn la_regla_da_a_la_app_200_ms_de_margen() {
        assert!(REGLA.contains(r#"application.name = "infiniity-dj""#), "solo para la app");
        // 75 ms (el de Firefox) sono entrecortado: hacen falta 200 ms.
        assert!(REGLA.contains("pulse.min.quantum = 9600/48000"), "200 ms");
        assert!(REGLA.contains("pulse.min.req = 9600/48000"));
        assert!(!REGLA.contains("3600/48000"), "nunca el margen que se quedo corto");
        // SPA-JSON valido a ojo: corchetes y llaves balanceados.
        assert_eq!(REGLA.matches('{').count(), REGLA.matches('}').count());
        assert_eq!(REGLA.matches('[').count(), REGLA.matches(']').count());
    }

    /// XDG_CONFIG_HOME es UNA variable para todo el proceso y las pruebas
    /// corren a la vez: sin este candado, una cambia la carpeta mientras otra
    /// la esta usando y fallan a ratos (paso al añadir la segunda).
    static CANDADO_CONFIG: std::sync::Mutex<()> = std::sync::Mutex::new(());

    /// Simula XDG_CONFIG_HOME solo dentro de la prueba.
    fn con_config_temporal<F: FnOnce()>(nombre: &str, f: F) {
        let _candado = CANDADO_CONFIG.lock().unwrap_or_else(|e| e.into_inner());
        let tmp = std::env::temp_dir().join(format!("dj-prep-{nombre}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        let antes = std::env::var_os("XDG_CONFIG_HOME");
        std::env::set_var("XDG_CONFIG_HOME", &tmp);
        f();
        match antes {
            Some(v) => std::env::set_var("XDG_CONFIG_HOME", v),
            None => std::env::remove_var("XDG_CONFIG_HOME"),
        }
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn la_preparacion_anterior_cuenta_como_antigua_y_se_retira() {
        con_config_temporal("antigua", || {
            let e = estado_sinc();
            assert!(!e.preparado && !e.antigua, "sin archivos: nada");

            // La de WirePlumber (0.4.49-0.4.53) puesta: antigua.
            let [lua, conf] = rutas_viejas();
            std::fs::create_dir_all(lua.parent().unwrap()).unwrap();
            std::fs::create_dir_all(conf.parent().unwrap()).unwrap();
            std::fs::write(&lua, "viejo").unwrap();
            std::fs::write(&conf, "viejo").unwrap();
            let e = estado_sinc();
            assert!(e.antigua && !e.preparado);

            // Retirarla deja todo limpio.
            assert!(quitar_viejos().unwrap(), "habia archivos viejos");
            assert!(!lua.exists() && !conf.exists());

            // La regla actual puesta: preparado.
            let regla = ruta_regla();
            std::fs::create_dir_all(regla.parent().unwrap()).unwrap();
            std::fs::write(&regla, REGLA).unwrap();
            let e = estado_sinc();
            assert!(e.preparado && !e.antigua);

            // Una regla distinta: antigua (hay que volver a preparar).
            std::fs::write(&regla, "otra cosa").unwrap();
            let e = estado_sinc();
            assert!(e.antigua && !e.preparado);
        });
    }

    #[test]
    fn asegurar_prepara_una_sola_vez_y_no_reinicia_si_ya_esta() {
        con_config_temporal("asegurar", || {
            let reinicios = std::cell::RefCell::new(Vec::<String>::new());
            let falso = |svc: &[&str]| -> Result<(), String> {
                reinicios.borrow_mut().push(svc.join("+"));
                Ok(())
            };
            // Primera vez: escribe la regla y reinicia pipewire-pulse.
            assert!(asegurar_preparacion_con(&falso).unwrap(), "tenia que preparar");
            assert_eq!(*reinicios.borrow(), vec!["pipewire-pulse".to_string()]);
            assert!(estado_sinc().preparado);
            // Segunda y tercera: ya esta, no se toca nada ni se reinicia.
            assert!(!asegurar_preparacion_con(&falso).unwrap());
            assert!(!asegurar_preparacion_con(&falso).unwrap());
            assert_eq!(reinicios.borrow().len(), 1, "un portatil se prepara UNA vez");

            // Con la preparacion vieja de WirePlumber: la cambia y reinicia los dos.
            let regla = ruta_regla();
            std::fs::remove_file(&regla).unwrap();
            let [lua, _] = rutas_viejas();
            std::fs::create_dir_all(lua.parent().unwrap()).unwrap();
            std::fs::write(&lua, "viejo").unwrap();
            assert!(asegurar_preparacion_con(&falso).unwrap());
            assert_eq!(reinicios.borrow().last().unwrap(), "wireplumber+pipewire-pulse");
            assert!(!lua.exists(), "la preparacion vieja se retira");
        });
    }

    #[test]
    fn la_regla_va_a_la_configuracion_del_usuario_de_pipewire_pulse() {
        let _candado = CANDADO_CONFIG.lock().unwrap_or_else(|e| e.into_inner());
        let r = ruta_regla();
        assert!(
            r.ends_with(format!("pipewire/pipewire-pulse.conf.d/{NOMBRE_REGLA}")),
            "{}",
            r.display()
        );
    }
}
