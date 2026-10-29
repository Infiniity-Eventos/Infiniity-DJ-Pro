//! Notas sobre canciones («esta no va en esta carpeta», «el artista esta
//! mal»...), para que el equipo le avise al PC original sin WhatsApp.
//!
//! DONDE VIVEN: `<musica>/Sin clasificar/.notas/`, un archivo JSON por nota.
//! - En «Sin clasificar» porque es la UNICA carpeta que Sync trae de vuelta al
//!   PC original (la biblioteca solo viaja del original hacia las demas, y lo
//!   que una PC del equipo escriba ahi se revierte). Es el mismo camino que ya
//!   usan los informes.
//! - Un archivo POR NOTA, nunca uno compartido: dos PC escribiendo el mismo
//!   archivo a la vez dejan un conflicto de Sync y una de las dos notas se
//!   pierde. Asi cada PC solo crea archivos nuevos.
//! - Oculta («.notas»): la skill /Organizar_Canciones salta lo que empieza por
//!   punto al buscar canciones, y la lista de la app solo muestra audio.
//!
//! La skill /Organizar_Canciones las lee (`scripts/notas.py`), las atiende y
//! las retira; al borrarse en el original, Sync las borra en todas las PC y
//! la marca de la cancion desaparece sola.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::en_otro_hilo;
use crate::informe::{chrono_simple, limpiar_nombre, nombre_del_equipo};

const CARPETA: &str = ".notas";

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Nota {
    /// Ruta de la cancion RELATIVA a la carpeta de musica: es la misma en
    /// todas las PC (la biblioteca es una copia de la del original).
    pub cancion: String,
    /// Nombre visible, por si la cancion ya se movio o renombro al leerla.
    pub nombre: String,
    /// Carpeta donde estaba cuando se escribio la nota.
    pub carpeta: String,
    pub texto: String,
    pub equipo: String,
    pub fecha: String,
    pub programa: String,
    /// Nombre del archivo de la nota (no se guarda dentro: es su direccion).
    #[serde(default, skip_serializing)]
    pub archivo: String,
}

fn carpeta_notas(musica: &str) -> PathBuf {
    Path::new(musica).join("Sin clasificar").join(CARPETA)
}

fn relativa(musica: &str, ruta: &str) -> String {
    Path::new(ruta)
        .strip_prefix(musica)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| ruta.to_string())
}

fn guardar_sinc(musica: &str, ruta_cancion: &str, nombre: &str, texto: &str) -> Result<Nota, String> {
    if musica.trim().is_empty() {
        return Err("Todavia no hay carpeta de musica elegida: la nota no tendria por donde viajar.".into());
    }
    let texto = texto.trim();
    if texto.is_empty() {
        return Err("La nota esta vacia.".into());
    }
    let cancion = relativa(musica, ruta_cancion);
    let carpeta = Path::new(&cancion)
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let fecha = chrono_simple();
    let equipo = nombre_del_equipo();
    let mut nota = Nota {
        cancion,
        nombre: nombre.to_string(),
        carpeta,
        texto: texto.to_string(),
        equipo: equipo.clone(),
        fecha: fecha.clone(),
        programa: env!("CARGO_PKG_VERSION").to_string(),
        archivo: String::new(),
    };
    let dir = carpeta_notas(musica);
    std::fs::create_dir_all(&dir).map_err(|e| format!("No se pudo preparar la carpeta de notas: {e}"))?;
    // Fecha + equipo + un numero: dos notas en el mismo segundo no chocan.
    let base = limpiar_nombre(&format!("{fecha} {equipo}"));
    let mut n = 0;
    let ruta = loop {
        let candidato = dir.join(format!("{base} {n}.json"));
        if !candidato.exists() {
            break candidato;
        }
        n += 1;
    };
    let json = serde_json::to_string_pretty(&nota).map_err(|e| e.to_string())?;
    std::fs::write(&ruta, json).map_err(|e| format!("No se pudo guardar la nota: {e}"))?;
    nota.archivo = ruta.file_name().unwrap_or_default().to_string_lossy().into_owned();
    Ok(nota)
}

fn leer_sinc(musica: &str) -> Result<Vec<Nota>, String> {
    let dir = carpeta_notas(musica);
    let entradas = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("No se pudieron leer las notas: {e}")),
    };
    let mut notas = Vec::new();
    for entrada in entradas.flatten() {
        let ruta = entrada.path();
        // Tambien las copias de conflicto de Sync (*.sync-conflict-*.json):
        // son notas igual de validas.
        if ruta.extension().and_then(|x| x.to_str()) != Some("json") {
            continue;
        }
        match std::fs::read_to_string(&ruta).map_err(|e| e.to_string()).and_then(|t| {
            serde_json::from_str::<Nota>(&t).map_err(|e| e.to_string())
        }) {
            Ok(mut nota) => {
                nota.archivo = ruta.file_name().unwrap_or_default().to_string_lossy().into_owned();
                notas.push(nota);
            }
            // Una nota a medio llegar por Sync no tumba las demas.
            Err(e) => eprintln!("[notas] {} no se pudo leer: {e}", ruta.display()),
        }
    }
    notas.sort_by(|a, b| a.fecha.cmp(&b.fecha));
    Ok(notas)
}

fn quitar_sinc(musica: &str, archivo: &str) -> Result<(), String> {
    // Solo un nombre de archivo, nunca una ruta: no se borra nada fuera de .notas.
    if archivo.is_empty() || archivo.contains('/') || archivo.contains("..") || !archivo.ends_with(".json") {
        return Err(format!("Nombre de nota no valido: {archivo}"));
    }
    std::fs::remove_file(carpeta_notas(musica).join(archivo)).map_err(|e| format!("No se pudo quitar la nota: {e}"))
}

#[tauri::command]
pub async fn nota_guardar(carpeta_musica: String, ruta_cancion: String, nombre: String, texto: String) -> Result<Nota, String> {
    en_otro_hilo(move || guardar_sinc(&carpeta_musica, &ruta_cancion, &nombre, &texto)).await
}

#[tauri::command]
pub async fn notas_leer(carpeta_musica: String) -> Result<Vec<Nota>, String> {
    en_otro_hilo(move || leer_sinc(&carpeta_musica)).await
}

#[tauri::command]
pub async fn nota_quitar(carpeta_musica: String, archivo: String) -> Result<(), String> {
    en_otro_hilo(move || quitar_sinc(&carpeta_musica, &archivo)).await
}

#[cfg(test)]
mod pruebas {
    use super::*;

    fn biblioteca() -> (tempdir::Temp, String) {
        let t = tempdir::Temp::nueva();
        let musica = t.0.to_string_lossy().into_owned();
        (t, musica)
    }

    mod tempdir {
        pub struct Temp(pub std::path::PathBuf);
        impl Temp {
            pub fn nueva() -> Temp {
                let p = std::env::temp_dir().join(format!(
                    "infiniity-notas-{}-{:?}",
                    std::process::id(),
                    std::thread::current().id()
                ));
                let _ = std::fs::remove_dir_all(&p);
                std::fs::create_dir_all(&p).unwrap();
                Temp(p)
            }
        }
        impl Drop for Temp {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
    }

    #[test]
    fn la_nota_queda_en_sin_clasificar_y_se_lee() {
        let (_t, musica) = biblioteca();
        let ruta = format!("{musica}/Salsa/Abusadora - Oro Solido.mp3");
        let n = guardar_sinc(&musica, &ruta, "Abusadora · Oro Solido", "  Es merengue, no salsa  ").unwrap();
        assert_eq!(n.cancion, "Salsa/Abusadora - Oro Solido.mp3");
        assert_eq!(n.carpeta, "Salsa");
        assert_eq!(n.texto, "Es merengue, no salsa");
        let archivo = carpeta_notas(&musica).join(&n.archivo);
        assert!(archivo.starts_with(Path::new(&musica).join("Sin clasificar/.notas")));
        // El nombre del archivo no va dentro del JSON (es su direccion).
        assert!(!std::fs::read_to_string(&archivo).unwrap().contains("\"archivo\""));

        let leidas = leer_sinc(&musica).unwrap();
        assert_eq!(leidas.len(), 1);
        assert_eq!(leidas[0].archivo, n.archivo);
        assert_eq!(leidas[0].texto, "Es merengue, no salsa");
    }

    #[test]
    fn dos_notas_seguidas_no_se_pisan_y_se_pueden_quitar() {
        let (_t, musica) = biblioteca();
        let ruta = format!("{musica}/Pop/X.mp3");
        let a = guardar_sinc(&musica, &ruta, "X", "uno").unwrap();
        let b = guardar_sinc(&musica, &ruta, "X", "dos").unwrap();
        assert_ne!(a.archivo, b.archivo);
        assert_eq!(leer_sinc(&musica).unwrap().len(), 2);
        quitar_sinc(&musica, &a.archivo).unwrap();
        let quedan = leer_sinc(&musica).unwrap();
        assert_eq!(quedan.len(), 1);
        assert_eq!(quedan[0].texto, "dos");
    }

    #[test]
    fn no_guarda_vacias_ni_borra_fuera_de_notas() {
        let (_t, musica) = biblioteca();
        assert!(guardar_sinc(&musica, &format!("{musica}/a.mp3"), "a", "   ").is_err());
        assert!(guardar_sinc("", "/x/a.mp3", "a", "hola").is_err());
        assert!(quitar_sinc(&musica, "../../algo.json").is_err());
        assert!(quitar_sinc(&musica, "Salsa/a.json").is_err());
        assert!(leer_sinc(&musica).unwrap().is_empty(), "sin carpeta de notas = sin notas, no error");
    }

    #[test]
    fn una_nota_rota_no_tumba_las_demas() {
        let (_t, musica) = biblioteca();
        guardar_sinc(&musica, &format!("{musica}/Pop/X.mp3"), "X", "buena").unwrap();
        std::fs::write(carpeta_notas(&musica).join("a medio llegar.json"), "{ \"cancion\": ").unwrap();
        std::fs::write(carpeta_notas(&musica).join(".syncthing.tmp"), "x").unwrap();
        let notas = leer_sinc(&musica).unwrap();
        assert_eq!(notas.len(), 1);
        assert_eq!(notas[0].texto, "buena");
    }
}
