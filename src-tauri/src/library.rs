//! Manejo de la biblioteca musical: leer el arbol de carpetas, listar canciones
//! y mover/crear carpetas. Todo opera sobre archivos REALES en el disco.

use crate::cache::{track_key, Cache};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Serialize, Clone)]
pub struct TrackInfo {
    pub path: String,
    pub name: String,      // nombre sin extension
    pub file_name: String, // nombre con extension
    pub folder: String,    // carpeta contenedora
    pub ext: String,       // "mp3" | "wav"
    pub size: u64,
    pub modified: u64,
    pub bpm: Option<f32>,
    pub duration: Option<f32>,
    pub bpm_manual: bool,
}

#[derive(Serialize)]
pub struct FolderNode {
    pub name: String,
    pub path: String,
    pub children: Vec<FolderNode>,
    pub track_count: usize,
}

#[derive(Serialize)]
pub struct LibraryData {
    pub root: String,
    pub tree: FolderNode,
    pub tracks: Vec<TrackInfo>,
}

fn is_audio(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?.to_lowercase();
    if ext == "mp3" || ext == "wav" {
        Some(ext)
    } else {
        None
    }
}

fn modified_secs(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Cuenta las canciones directamente dentro de una carpeta (no recursivo).
fn count_tracks_in(dir: &Path) -> usize {
    std::fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.path().is_file() && is_audio(&e.path()).is_some())
                .count()
        })
        .unwrap_or(0)
}

/// Construye el arbol de subcarpetas de forma recursiva.
fn build_tree(dir: &Path) -> FolderNode {
    let name = dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Musica")
        .to_string();

    let mut children = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dir) {
        let mut dirs: Vec<PathBuf> = rd
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.is_dir())
            .collect();
        dirs.sort();
        for d in dirs {
            children.push(build_tree(&d));
        }
    }

    FolderNode {
        name,
        path: dir.to_string_lossy().to_string(),
        children,
        track_count: count_tracks_in(dir),
    }
}

pub fn read_library(root: &str, cache: &Cache) -> Result<LibraryData, String> {
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err("La carpeta de musica no existe".to_string());
    }

    let tree = build_tree(root_path);

    // Listado plano de todas las canciones bajo la raiz.
    let mut tracks = Vec::new();
    for entry in walkdir::WalkDir::new(root_path)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        let ext = match is_audio(p) {
            Some(e) => e,
            None => continue,
        };
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let size = meta.len();
        let modified = modified_secs(&meta);
        let path_str = p.to_string_lossy().to_string();
        let key = track_key(&path_str, size, modified);
        let cached = cache.get(&key).unwrap_or_default();

        tracks.push(TrackInfo {
            name: p
                .file_stem()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string(),
            file_name: p
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string(),
            folder: p
                .parent()
                .map(|pp| pp.to_string_lossy().to_string())
                .unwrap_or_default(),
            path: path_str,
            ext,
            size,
            modified,
            bpm: cached.bpm,
            duration: cached.duration,
            bpm_manual: cached.manual,
        });
    }

    tracks.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(LibraryData {
        root: root.to_string(),
        tree,
        tracks,
    })
}

/// Mueve el archivo real a otra carpeta. Devuelve la nueva ruta.
pub fn move_track(from: &str, to_folder: &str) -> Result<String, String> {
    let from_path = Path::new(from);
    let to_dir = Path::new(to_folder);
    if !from_path.is_file() {
        return Err("La cancion ya no existe".to_string());
    }
    if !to_dir.is_dir() {
        return Err("La carpeta destino no existe".to_string());
    }
    let file_name = from_path
        .file_name()
        .ok_or_else(|| "Nombre de archivo invalido".to_string())?;
    let dest = to_dir.join(file_name);

    if dest == from_path {
        return Ok(dest.to_string_lossy().to_string());
    }
    if dest.exists() {
        return Err("Ya existe una cancion con ese nombre en la carpeta destino".to_string());
    }

    // Intento rapido (mismo disco). Si falla por estar en discos distintos,
    // copiamos y borramos.
    match std::fs::rename(from_path, &dest) {
        Ok(_) => {}
        Err(_) => {
            std::fs::copy(from_path, &dest).map_err(|e| format!("No se pudo mover: {e}"))?;
            std::fs::remove_file(from_path).map_err(|e| format!("No se pudo mover: {e}"))?;
        }
    }
    Ok(dest.to_string_lossy().to_string())
}

/// Crea una subcarpeta nueva dentro de `parent`. Devuelve la ruta creada.
pub fn create_folder(parent: &str, name: &str) -> Result<String, String> {
    let clean = name.trim();
    if clean.is_empty() || clean.contains('/') || clean.contains('\\') {
        return Err("Nombre de carpeta invalido".to_string());
    }
    let dir = Path::new(parent).join(clean);
    if dir.exists() {
        return Err("Ya existe una carpeta con ese nombre".to_string());
    }
    std::fs::create_dir(&dir).map_err(|e| format!("No se pudo crear la carpeta: {e}"))?;
    Ok(dir.to_string_lossy().to_string())
}

/// Garantiza que exista la carpeta "Sin clasificar" dentro de la raiz.
pub fn ensure_unclassified(root: &str) -> Result<String, String> {
    let dir = Path::new(root).join("Sin clasificar");
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("No se pudo crear 'Sin clasificar': {e}"))?;
    }
    Ok(dir.to_string_lossy().to_string())
}
