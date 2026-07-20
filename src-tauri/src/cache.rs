//! Cache local del analisis de cada cancion.
//!
//! El BPM (y la duracion) de una cancion se calcula UNA sola vez y se guarda
//! aqui, en un archivo JSON dentro de la carpeta de datos de la app. La llave
//! combina ruta + tamano + fecha de modificacion, asi que si el archivo cambia
//! se vuelve a analizar, pero si es el mismo se reutiliza para siempre.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct TrackMeta {
    pub bpm: Option<f32>,
    pub duration: Option<f32>,
    /// true si el operador corrigio el BPM a mano (no se debe sobrescribir).
    pub manual: bool,
}

#[derive(Default)]
pub struct Cache {
    path: PathBuf,
    map: HashMap<String, TrackMeta>,
}

impl Cache {
    /// Carga el cache desde disco (o crea uno vacio si no existe).
    pub fn load(path: PathBuf) -> Self {
        let map = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<HashMap<String, TrackMeta>>(&s).ok())
            .unwrap_or_default();
        Cache { path, map }
    }

    pub fn get(&self, key: &str) -> Option<TrackMeta> {
        self.map.get(key).cloned()
    }

    pub fn set(&mut self, key: String, meta: TrackMeta) {
        self.map.insert(key, meta);
        self.save();
    }

    fn save(&self) {
        if self.path.as_os_str().is_empty() {
            return;
        }
        if let Some(parent) = self.path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(s) = serde_json::to_string(&self.map) {
            let _ = std::fs::write(&self.path, s);
        }
    }
}

/// Llave unica y estable por archivo: ruta + tamano + fecha de modificacion.
pub fn track_key(path: &str, size: u64, modified: u64) -> String {
    format!("{path}|{size}|{modified}")
}
