//! Preparar el equipo para cabinas Bluetooth sencillas.
//!
//! POR QUE EXISTE: la misma cabina (un modulo barato que se anuncia como
//! «bluetooth»), en DOS portatiles distintos con Linux Mint 22.1 (PipeWire
//! 1.0.5, BlueZ 5.72), hace lo mismo: acepta el enlace Bluetooth y corta la
//! conexion de audio ella misma («avdtp: Connection reset by peer»), asi que la
//! salida queda sin canal y nada suena por ella. Reabrir el perfil o cambiar la
//! variante del codec no basta. Lo unico que queda por cambiar de nuestro lado
//! es COMO negocia el servidor de sonido con la cabina: ofrecerle solo audio
//! (sin manos libres, que estos modulos manejan mal), sin control de volumen
//! por hardware y con SBC a secas. Eso se configura en WirePlumber, por usuario
//! y sin permisos de administrador.
//!
//! POR QUE DOS ARCHIVOS: el formato cambio entre WirePlumber 0.4 (Lua en
//! `bluetooth.lua.d/`) y 0.5 (SPA-JSON en `wireplumber.conf.d/`). Cada version
//! ignora la carpeta de la otra, asi que se escriben los dos y vale en ambas.
//!
//! POR QUE EL REINICIO VA APARTE Y SOLO AL PULSAR UN BOTON: WirePlumber lee la
//! configuracion al arrancar. Reiniciarlo corta el sonido del equipo un par de
//! segundos, y en una version anterior un reinicio automatico entro en bucle y
//! trabo un portatil (regla 8). Aqui se hace UNA vez, porque el usuario lo
//! pidio, con la app sin musica, y se dice lo que va a pasar.
//!
//! REVERSIBLE: borrar los dos archivos y reiniciar WirePlumber. Hay boton.

use serde::Serialize;
use std::path::PathBuf;

use crate::downloader::clean_command;
use crate::en_otro_hilo;

const NOMBRE_LUA: &str = "51-infiniity-cabina.lua";
const NOMBRE_CONF: &str = "51-infiniity-cabina.conf";

/// Configuracion para WirePlumber 0.4 (Lua).
pub const LUA: &str = r#"-- Infiniity DJ: cabinas Bluetooth sencillas (WirePlumber 0.4).
-- Solo audio (sin manos libres), sin control de volumen por hardware, SBC a secas.
-- Reversible: borrar este archivo y reiniciar wireplumber.
bluez_monitor.properties["bluez5.roles"] = "[ a2dp_sink ]"
bluez_monitor.properties["bluez5.codecs"] = "[ sbc ]"
bluez_monitor.properties["bluez5.enable-sbc-xq"] = false
bluez_monitor.properties["bluez5.enable-msbc"] = false
bluez_monitor.properties["bluez5.enable-hw-volume"] = false
bluez_monitor.properties["bluez5.headset-roles"] = "[ ]"
"#;

/// Configuracion para WirePlumber 0.5 (SPA-JSON).
pub const CONF: &str = r#"# Infiniity DJ: cabinas Bluetooth sencillas (WirePlumber 0.5).
# Solo audio (sin manos libres), sin control de volumen por hardware, SBC a secas.
# Reversible: borrar este archivo y reiniciar wireplumber.
monitor.bluez.properties = {
  bluez5.roles = [ a2dp_sink ]
  bluez5.codecs = [ sbc ]
  bluez5.enable-sbc-xq = false
  bluez5.enable-msbc = false
  bluez5.enable-hw-volume = false
  bluez5.headset-roles = [ ]
}
"#;

fn dir_config() -> PathBuf {
    std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .unwrap_or_else(std::env::temp_dir)
        .join("wireplumber")
}

fn rutas() -> (PathBuf, PathBuf) {
    let base = dir_config();
    (
        base.join("bluetooth.lua.d").join(NOMBRE_LUA),
        base.join("wireplumber.conf.d").join(NOMBRE_CONF),
    )
}

/// Estado de la preparacion, para la interfaz y el informe.
#[derive(Serialize, Clone)]
pub struct EstadoPreparacion {
    /// Los archivos de configuracion estan puestos.
    pub preparado: bool,
    /// Donde estan (o estarian).
    pub rutas: Vec<String>,
}

fn estado_sinc() -> EstadoPreparacion {
    let (lua, conf) = rutas();
    EstadoPreparacion {
        preparado: lua.is_file() && conf.is_file(),
        rutas: vec![lua.to_string_lossy().into_owned(), conf.to_string_lossy().into_owned()],
    }
}

#[tauri::command]
pub async fn bt_preparacion_estado() -> EstadoPreparacion {
    en_otro_hilo(|| Ok(estado_sinc())).await.unwrap_or(EstadoPreparacion {
        preparado: false,
        rutas: Vec::new(),
    })
}

/// Reinicia WirePlumber (solo el gestor de sesion, no pipewire entero): es el
/// que lee esta configuracion. Corta el sonido un par de segundos.
fn reiniciar_wireplumber() -> Result<(), String> {
    let out = clean_command("systemctl")
        .args(["--user", "restart", "wireplumber"])
        .output()
        .map_err(|e| format!("No se pudo ejecutar systemctl: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "No se pudo reiniciar WirePlumber: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    // Darle tiempo a volver antes de que la interfaz consulte nada.
    std::thread::sleep(std::time::Duration::from_millis(2500));
    Ok(())
}

/// Escribe la configuracion y reinicia WirePlumber UNA vez.
#[tauri::command]
pub async fn bt_preparar_equipo() -> Result<String, String> {
    en_otro_hilo(|| {
        let (lua, conf) = rutas();
        for (ruta, texto) in [(&lua, LUA), (&conf, CONF)] {
            if let Some(d) = ruta.parent() {
                std::fs::create_dir_all(d)
                    .map_err(|e| format!("No se pudo crear {}: {e}", d.display()))?;
            }
            std::fs::write(ruta, texto)
                .map_err(|e| format!("No se pudo escribir {}: {e}", ruta.display()))?;
        }
        reiniciar_wireplumber()?;
        Ok("Equipo preparado para cabinas Bluetooth sencillas. Ahora apaga la cabina del \
            todo, enciéndela y conéctala otra vez."
            .to_string())
    })
    .await
}

/// Quita la configuracion y reinicia WirePlumber UNA vez.
#[tauri::command]
pub async fn bt_quitar_preparacion() -> Result<String, String> {
    en_otro_hilo(|| {
        let (lua, conf) = rutas();
        for ruta in [&lua, &conf] {
            if ruta.exists() {
                std::fs::remove_file(ruta)
                    .map_err(|e| format!("No se pudo borrar {}: {e}", ruta.display()))?;
            }
        }
        reiniciar_wireplumber()?;
        Ok("Preparación quitada; el equipo vuelve a su configuración normal de Bluetooth.".to_string())
    })
    .await
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn la_configuracion_solo_ofrece_audio_y_sbc_a_secas() {
        for texto in [LUA, CONF] {
            assert!(texto.contains("a2dp_sink"), "solo el rol de audio");
            assert!(texto.contains("enable-hw-volume"), "sin volumen por hardware");
            assert!(texto.contains("enable-sbc-xq"), "sin SBC-XQ");
            assert!(!texto.contains("hfp_hf"), "nada de manos libres");
        }
        // El .conf tiene que ser SPA-JSON valido a ojo: llaves balanceadas.
        assert_eq!(CONF.matches('{').count(), CONF.matches('}').count());
    }

    #[test]
    fn las_rutas_van_a_la_configuracion_del_usuario() {
        let (lua, conf) = rutas();
        assert!(lua.ends_with(format!("wireplumber/bluetooth.lua.d/{NOMBRE_LUA}")), "{}", lua.display());
        assert!(conf.ends_with(format!("wireplumber/wireplumber.conf.d/{NOMBRE_CONF}")), "{}", conf.display());
    }
}
