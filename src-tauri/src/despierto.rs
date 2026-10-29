//! Mantener el portatil DESPIERTO mientras suena musica.
//!
//! POR QUE (2026-10-28): en una prueba con el automix mezclando solo, nadie
//! toco el portatil y el sistema hizo lo que hace con un equipo "quieto":
//! apago la pantalla y la musica se corto. Mezclar solo es justo el caso en
//! que nadie toca nada, asi que el programa tiene que avisarle al sistema
//! "estoy trabajando aunque no muevan el raton", como hace un reproductor de
//! video.
//!
//! Se le pide a TODOS los que pueden apagar algo, porque cada escritorio
//! escucha a uno distinto, y basta con que uno diga que si:
//!  - org.freedesktop.ScreenSaver: el estandar para que no se apague ni se
//!    bloquee la pantalla.
//!  - org.gnome.SessionManager / org.cinnamon.SessionManager: lo que miran
//!    GNOME y Cinnamon (Linux Mint) para la inactividad y la suspension.
//!  - logind (el sistema): que no se suspenda. Lo devuelve como un archivo
//!    abierto; mientras el programa lo tenga, el bloqueo sigue.
//!
//! Todo se suelta solo si el programa se cierra o se cae (la conexion con el
//! sistema y el archivo mueren con el proceso): nunca deja el portatil sin
//! poder dormir despues de cerrar la app. Cerrar la tapa sigue suspendiendo:
//! eso es una decision de la persona, no inactividad.

use gio::prelude::*;
use std::os::fd::{FromRawFd, OwnedFd};
use std::sync::Mutex;

const QUIEN: &str = "Infiniity DJ";
const PORQUE: &str = "Hay musica sonando";
const PLAZO_MS: i32 = 3000;

/// Un permiso pedido a un servicio de la sesion, para poder devolverlo.
struct PermisoSesion {
    servicio: &'static str,
    ruta: &'static str,
    interfaz: &'static str,
    soltar: &'static str,
    cookie: u32,
}

struct Bloqueo {
    sesion: Vec<PermisoSesion>,
    /// El bloqueo de logind: se suelta al cerrar este archivo.
    sistema: Option<OwnedFd>,
    /// Que se consiguio, para el informe y para avisar si no se consiguio nada.
    resumen: String,
}

static BLOQUEO: Mutex<Option<Bloqueo>> = Mutex::new(None);

fn sesion() -> Result<gio::DBusConnection, String> {
    gio::bus_get_sync(gio::BusType::Session, None::<&gio::Cancellable>)
        .map_err(|e| format!("sin conexion con la sesion: {e}"))
}

fn llamar(
    con: &gio::DBusConnection,
    servicio: &str,
    ruta: &str,
    interfaz: &str,
    metodo: &str,
    args: &glib::Variant,
) -> Result<glib::Variant, String> {
    con.call_sync(
        Some(servicio),
        ruta,
        interfaz,
        metodo,
        Some(args),
        None,
        gio::DBusCallFlags::NO_AUTO_START,
        PLAZO_MS,
        None::<&gio::Cancellable>,
    )
    .map_err(|e| e.to_string())
}

fn pedir_sesion(con: &gio::DBusConnection, notas: &mut Vec<String>) -> Vec<PermisoSesion> {
    let mut permisos = Vec::new();

    // Pantalla: (nombre, motivo) -> cookie
    match llamar(
        con,
        "org.freedesktop.ScreenSaver",
        "/org/freedesktop/ScreenSaver",
        "org.freedesktop.ScreenSaver",
        "Inhibit",
        &(QUIEN, PORQUE).to_variant(),
    ) {
        Ok(v) => {
            let (cookie,): (u32,) = v.get().unwrap_or((0,));
            notas.push("pantalla (freedesktop): si".into());
            permisos.push(PermisoSesion {
                servicio: "org.freedesktop.ScreenSaver",
                ruta: "/org/freedesktop/ScreenSaver",
                interfaz: "org.freedesktop.ScreenSaver",
                soltar: "UnInhibit",
                cookie,
            });
        }
        Err(e) => notas.push(format!("pantalla (freedesktop): no ({e})")),
    }

    // Sesion de GNOME y de Cinnamon: (app, ventana, motivo, que) -> cookie.
    // que = 4 (suspender) + 8 (marcar la sesion como inactiva).
    for (servicio, ruta, interfaz, nombre) in [
        ("org.gnome.SessionManager", "/org/gnome/SessionManager", "org.gnome.SessionManager", "gnome"),
        ("org.cinnamon.SessionManager", "/org/cinnamon/SessionManager", "org.cinnamon.SessionManager", "cinnamon"),
    ] {
        match llamar(con, servicio, ruta, interfaz, "Inhibit", &(QUIEN, 0u32, PORQUE, 12u32).to_variant()) {
            Ok(v) => {
                let (cookie,): (u32,) = v.get().unwrap_or((0,));
                notas.push(format!("sesion ({nombre}): si"));
                permisos.push(PermisoSesion { servicio, ruta, interfaz, soltar: "Uninhibit", cookie });
            }
            // Que no exista el de otro escritorio es lo normal: no es un fallo.
            Err(e) if e.contains("ServiceUnknown") || e.contains("NameHasNoOwner") => {}
            Err(e) => notas.push(format!("sesion ({nombre}): no ({e})")),
        }
    }
    permisos
}

fn pedir_sistema(notas: &mut Vec<String>) -> Option<OwnedFd> {
    let con = match gio::bus_get_sync(gio::BusType::System, None::<&gio::Cancellable>) {
        Ok(c) => c,
        Err(e) => {
            notas.push(format!("sistema: no ({e})"));
            return None;
        }
    };
    let r = con.call_with_unix_fd_list_sync(
        Some("org.freedesktop.login1"),
        "/org/freedesktop/login1",
        "org.freedesktop.login1.Manager",
        "Inhibit",
        Some(&("sleep:idle", QUIEN, PORQUE, "block").to_variant()),
        None,
        gio::DBusCallFlags::NONE,
        PLAZO_MS,
        None::<&gio::UnixFDList>,
        None::<&gio::Cancellable>,
    );
    match r {
        Ok((_, lista)) => {
            let fds = lista.steal_fds();
            match fds.first() {
                Some(&fd) if fd >= 0 => {
                    // Los demas (no deberia haber) se cierran.
                    for &otro in fds.iter().skip(1) {
                        drop(unsafe { OwnedFd::from_raw_fd(otro) });
                    }
                    notas.push("sistema (no suspender): si".into());
                    Some(unsafe { OwnedFd::from_raw_fd(fd) })
                }
                _ => {
                    notas.push("sistema: no (respuesta sin archivo)".into());
                    None
                }
            }
        }
        Err(e) => {
            notas.push(format!("sistema: no ({e})"));
            None
        }
    }
}

fn soltar(b: Bloqueo) {
    if !b.sesion.is_empty() {
        match sesion() {
            Ok(con) => {
                for p in &b.sesion {
                    if let Err(e) = llamar(&con, p.servicio, p.ruta, p.interfaz, p.soltar, &(p.cookie,).to_variant()) {
                        eprintln!("[despierto] no se pudo soltar {}: {e}", p.servicio);
                    }
                }
            }
            Err(e) => eprintln!("[despierto] {e}"),
        }
    }
    drop(b.sistema); // cerrar el archivo suelta el bloqueo de logind
}

/// Activa o suelta el bloqueo. Idempotente: pedirlo dos veces no pide dos.
/// Devuelve que se consiguio; error si se queria activar y NADIE dijo que si.
fn mantener_despierto_sinc(activo: bool) -> Result<String, String> {
    let mut guardado = BLOQUEO.lock().map_err(|_| "bloqueo envenenado".to_string())?;
    if !activo {
        if let Some(b) = guardado.take() {
            soltar(b);
        }
        return Ok("suelto".into());
    }
    if let Some(b) = guardado.as_ref() {
        return Ok(b.resumen.clone());
    }
    let mut notas = Vec::new();
    let permisos = match sesion() {
        Ok(con) => pedir_sesion(&con, &mut notas),
        Err(e) => {
            notas.push(e);
            Vec::new()
        }
    };
    let sistema = pedir_sistema(&mut notas);
    let resumen = notas.join("; ");
    if permisos.is_empty() && sistema.is_none() {
        return Err(resumen);
    }
    eprintln!("[despierto] activo: {resumen}");
    *guardado = Some(Bloqueo { sesion: permisos, sistema, resumen: resumen.clone() });
    Ok(resumen)
}

/// Para el informe.
pub(crate) fn estado() -> String {
    match BLOQUEO.lock() {
        Ok(g) => match g.as_ref() {
            Some(b) => format!("ACTIVO — {}", b.resumen),
            None => "suelto (no hay musica sonando)".into(),
        },
        Err(_) => "desconocido (bloqueo envenenado)".into(),
    }
}

#[tauri::command]
pub async fn mantener_despierto(activo: bool) -> Result<String, String> {
    crate::en_otro_hilo(move || mantener_despierto_sinc(activo)).await
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use std::process::Command;

    fn inhibidores() -> String {
        let s = Command::new("systemd-inhibit").args(["--list", "--no-pager"]).output().unwrap();
        String::from_utf8_lossy(&s.stdout).to_string()
    }

    #[test]
    #[ignore = "necesita la sesion grafica y logind del equipo"]
    fn bloquea_y_suelta_de_verdad() {
        let r = mantener_despierto_sinc(true).expect("alguien tiene que decir que si");
        println!("  {r}");
        assert!(inhibidores().contains(QUIEN), "logind no muestra el bloqueo:\n{}", inhibidores());
        // Pedirlo otra vez no apila otro.
        mantener_despierto_sinc(true).unwrap();
        assert_eq!(inhibidores().matches(QUIEN).count(), 1);
        mantener_despierto_sinc(false).unwrap();
        assert!(!inhibidores().contains(QUIEN), "quedo bloqueado tras soltar");
        assert!(estado().starts_with("suelto"));
    }
}
