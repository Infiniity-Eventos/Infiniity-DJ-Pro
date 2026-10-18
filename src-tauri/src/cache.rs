//! Cache del analisis de cada cancion (BPM y duracion).
//!
//! Dos capas:
//! - LOCAL: `bpm_cache.json` en la carpeta de datos de la app, con llave
//!   ruta absoluta + tamano + fecha. Como siempre.
//! - COMPARTIDA (biblioteca sincronizada, ver sync.rs): una carpeta que viaja
//!   entre PC con UN archivo por PC (`bpm-<pc>.json`), con llave ruta RELATIVA
//!   a la raiz de la biblioteca + tamano. Cada PC escribe solo su archivo (asi
//!   nunca hay conflictos) y lee los de las demas. Resultado: una cancion
//!   analizada en una PC ya tiene BPM en todas.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

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
    // --- capa compartida ---
    compartido: Option<PathBuf>,
    pc: String,
    propios: HashMap<String, TrackMeta>,
    ajenos: HashMap<String, TrackMeta>,
    ajenos_leidos: Option<Instant>,
}

/// Cada cuanto se releen los archivos de las otras PC (llegan por Syncthing).
const RELEER_AJENOS_CADA: Duration = Duration::from_secs(30);

impl Cache {
    /// Carga el cache desde disco (o crea uno vacio si no existe).
    pub fn load(path: PathBuf) -> Self {
        let map = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<HashMap<String, TrackMeta>>(&s).ok())
            .unwrap_or_default();
        Cache { path, map, ..Default::default() }
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

    // ------------------------------------------------------------------
    // Capa compartida
    // ------------------------------------------------------------------

    /// Activa la capa compartida en `dir` (la carpeta que sincroniza Syncthing).
    pub fn configurar_compartido(&mut self, dir: PathBuf, pc: &str) {
        let _ = std::fs::create_dir_all(&dir);
        // Sin caracteres raros en el nombre del archivo.
        self.pc = pc.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
        if self.pc.is_empty() {
            self.pc = "pc".to_string();
        }
        self.propios = std::fs::read_to_string(dir.join(format!("bpm-{}.json", self.pc)))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        self.compartido = Some(dir);
        self.ajenos_leidos = None;
    }

    fn archivo_propio(&self) -> Option<PathBuf> {
        self.compartido.as_ref().map(|d| d.join(format!("bpm-{}.json", self.pc)))
    }

    /// Relee los archivos de las otras PC si toca (cada 30 s como mucho).
    pub fn recargar_ajenos(&mut self) {
        let Some(dir) = self.compartido.clone() else { return };
        if let Some(t) = self.ajenos_leidos {
            if t.elapsed() < RELEER_AJENOS_CADA {
                return;
            }
        }
        let mut ajenos = HashMap::new();
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for e in rd.flatten() {
                let nombre = e.file_name().to_string_lossy().into_owned();
                if !nombre.starts_with("bpm-") || !nombre.ends_with(".json") || nombre == format!("bpm-{}.json", self.pc) {
                    continue;
                }
                if let Some(m) = std::fs::read_to_string(e.path())
                    .ok()
                    .and_then(|s| serde_json::from_str::<HashMap<String, TrackMeta>>(&s).ok())
                {
                    ajenos.extend(m);
                }
            }
        }
        self.ajenos = ajenos;
        self.ajenos_leidos = Some(Instant::now());
    }

    /// Busca por llave relativa: primero lo analizado aqui, luego lo de otras PC.
    pub fn get_relativa(&self, rel: &str) -> Option<TrackMeta> {
        self.propios.get(rel).or_else(|| self.ajenos.get(rel)).cloned()
    }

    /// Guarda en el archivo de ESTA PC (el unico que escribe).
    pub fn set_relativa(&mut self, rel: String, meta: TrackMeta) {
        let Some(archivo) = self.archivo_propio() else { return };
        self.propios.insert(rel, meta);
        match serde_json::to_string(&self.propios) {
            Ok(s) => {
                if let Err(e) = std::fs::write(&archivo, s) {
                    eprintln!("AVISO: no se pudo guardar el BPM compartido ({}): {e}", archivo.display());
                }
            }
            Err(e) => eprintln!("AVISO: BPM compartido no serializable: {e}"),
        }
    }
}

/// Llave unica y estable por archivo: ruta + tamano + fecha de modificacion.
pub fn track_key(path: &str, size: u64, modified: u64) -> String {
    format!("{path}|{size}|{modified}")
}

/// Llave compartida entre PC: ruta RELATIVA a la raiz de la biblioteca + tamano.
/// (La fecha no entra: Syncthing la conserva, pero no hace falta arriesgarse.)
/// None si el archivo no esta dentro de la raiz.
pub fn clave_relativa(raiz: &Path, path: &Path, size: u64) -> Option<String> {
    let rel = path.strip_prefix(raiz).ok()?;
    Some(format!("{}|{size}", rel.to_string_lossy()))
}

#[cfg(test)]
mod pruebas {
    use super::*;

    /// Dos PC comparten la carpeta: lo que analiza una, la otra lo lee.
    #[test]
    fn el_bpm_de_una_pc_lo_ve_la_otra() {
        let dir = std::env::temp_dir().join(format!("infiniity-bpm-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut a = Cache::default();
        a.configurar_compartido(dir.clone(), "pc-a");
        let mut b = Cache::default();
        b.configurar_compartido(dir.clone(), "pc-b");

        let clave = clave_relativa(Path::new("/m"), Path::new("/m/Salsa/x.mp3"), 123).unwrap();
        assert_eq!(clave, "Salsa/x.mp3|123");
        a.set_relativa(clave.clone(), TrackMeta { bpm: Some(98.0), duration: Some(200.0), manual: false });

        b.recargar_ajenos();
        assert_eq!(b.get_relativa(&clave).unwrap().bpm, Some(98.0));
        // Cada PC escribe solo su archivo.
        assert!(dir.join("bpm-pc-a.json").is_file());
        assert!(!dir.join("bpm-pc-b.json").exists());
        // Fuera de la raiz no hay llave.
        assert!(clave_relativa(Path::new("/m"), Path::new("/otra/x.mp3"), 1).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
