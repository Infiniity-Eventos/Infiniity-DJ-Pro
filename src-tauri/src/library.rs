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
/// Carpetas y archivos ocultos (empiezan por "."): se saltan. Syncthing crea
/// `.stfolder`, `.stversions` (la papelera, LLENA de MP3 borrados) y archivos
/// `.sync-conflict-*`; sin esto aparecerian como canciones.
fn es_oculto(p: &Path) -> bool {
    p.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.starts_with('.'))
        .unwrap_or(false)
}

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
            .filter(|p| p.is_dir() && !es_oculto(p))
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

pub fn read_library(root: &str, cache: &mut Cache) -> Result<LibraryData, String> {
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err("La carpeta de musica no existe".to_string());
    }
    // BPM analizados en OTRAS PC (llegan por la biblioteca sincronizada).
    cache.recargar_ajenos();

    let tree = build_tree(root_path);

    // Listado plano de todas las canciones bajo la raiz.
    let mut tracks = Vec::new();
    for entry in walkdir::WalkDir::new(root_path)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| e.depth() == 0 || !es_oculto(e.path()))
        .filter_map(|e| e.ok())
    {
        let p = entry.path();
        if !p.is_file() || p.to_string_lossy().contains(".sync-conflict-") {
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
        let cached = cache
            .get(&key)
            .or_else(|| crate::cache::clave_relativa(root_path, p, size).and_then(|r| cache.get_relativa(&r)))
            .unwrap_or_default();

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

/// Copia canciones del computador a la carpeta `dest` (normalmente "Sin
/// clasificar"), para que entren a la biblioteca sin tocar el explorador de
/// archivos. Devuelve (copiadas, saltadas): se salta lo que no es audio y lo
/// que ya existe con el mismo nombre (dos personas aportando la misma cancion).
pub fn import_tracks(paths: &[String], dest: &str) -> Result<(usize, usize), String> {
    let dest_dir = Path::new(dest);
    std::fs::create_dir_all(dest_dir).map_err(|e| format!("No se pudo preparar la carpeta: {e}"))?;
    let mut copiadas = 0;
    let mut saltadas = 0;
    for p in paths {
        let origen = Path::new(p);
        let Some(nombre) = origen.file_name() else { saltadas += 1; continue };
        if !origen.is_file() || is_audio(origen).is_none() {
            saltadas += 1;
            continue;
        }
        let destino = dest_dir.join(nombre);
        if destino.exists() {
            saltadas += 1;
            continue;
        }
        // Copiar a un nombre temporal y renombrar al final: si se corta a la
        // mitad, Syncthing no sube un archivo incompleto.
        let tmp = dest_dir.join(format!(".copiando-{}", nombre.to_string_lossy()));
        std::fs::copy(origen, &tmp).map_err(|e| format!("No se pudo copiar {}: {e}", nombre.to_string_lossy()))?;
        std::fs::rename(&tmp, &destino).map_err(|e| format!("No se pudo guardar {}: {e}", nombre.to_string_lossy()))?;
        copiadas += 1;
    }
    Ok((copiadas, saltadas))
}

/// Copia una carpeta entera del computador a la biblioteca.
/// - `conservar_estructura` = true (PC original): se copian las subcarpetas tal
///   cual bajo `dest` (meter ~/Música entera y que queden los generos).
/// - false (PC del equipo): todas las canciones, de todos los niveles, caen
///   planas en `dest` ("Sin clasificar"): ellos no crean carpetas.
/// Se salta lo oculto, lo que no es audio y lo que ya existe. Si la carpeta
/// elegida esta DENTRO de la biblioteca, no se hace nada (se copiaria sobre si misma).
pub fn import_folder(src: &str, dest: &str, conservar_estructura: bool) -> Result<(usize, usize), String> {
    let src_dir = Path::new(src);
    let dest_dir = Path::new(dest);
    if !src_dir.is_dir() {
        return Err("Esa carpeta no existe".to_string());
    }
    if src_dir.starts_with(dest_dir) || dest_dir.starts_with(src_dir) {
        return Err("Esa carpeta ya es parte de la biblioteca (o la contiene)".to_string());
    }
    let mut copiadas = 0;
    let mut saltadas = 0;
    for entry in walkdir::WalkDir::new(src_dir)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| e.depth() == 0 || !es_oculto(e.path()))
        .filter_map(|e| e.ok())
    {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        if is_audio(p).is_none() {
            saltadas += 1;
            continue;
        }
        let Some(nombre) = p.file_name() else { saltadas += 1; continue };
        let carpeta_destino = if conservar_estructura {
            match p.parent().and_then(|par| par.strip_prefix(src_dir).ok()) {
                Some(rel) => dest_dir.join(rel),
                None => dest_dir.to_path_buf(),
            }
        } else {
            dest_dir.to_path_buf()
        };
        std::fs::create_dir_all(&carpeta_destino).map_err(|e| format!("No se pudo crear {}: {e}", carpeta_destino.display()))?;
        let destino = carpeta_destino.join(nombre);
        if destino.exists() {
            saltadas += 1;
            continue;
        }
        let tmp = carpeta_destino.join(format!(".copiando-{}", nombre.to_string_lossy()));
        std::fs::copy(p, &tmp).map_err(|e| format!("No se pudo copiar {}: {e}", nombre.to_string_lossy()))?;
        std::fs::rename(&tmp, &destino).map_err(|e| format!("No se pudo guardar {}: {e}", nombre.to_string_lossy()))?;
        copiadas += 1;
    }
    Ok((copiadas, saltadas))
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

#[cfg(test)]
mod pruebas_import {
    #[test]
    fn import_copia_audio_y_salta_repetidos_y_no_audio() {
        let dir = std::env::temp_dir().join(format!("infiniity-import-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let origen = dir.join("origen");
        let dest = dir.join("Sin clasificar");
        std::fs::create_dir_all(&origen).unwrap();
        std::fs::write(origen.join("a.mp3"), b"aaa").unwrap();
        std::fs::write(origen.join("b.wav"), b"bbb").unwrap();
        std::fs::write(origen.join("c.txt"), b"ccc").unwrap();
        let rutas: Vec<String> = ["a.mp3", "b.wav", "c.txt"].iter().map(|n| origen.join(n).to_string_lossy().into_owned()).collect();
        let (c, s) = super::import_tracks(&rutas, dest.to_str().unwrap()).unwrap();
        assert_eq!((c, s), (2, 1));
        // Segunda vez: todo repetido.
        let (c, s) = super::import_tracks(&rutas, dest.to_str().unwrap()).unwrap();
        assert_eq!((c, s), (0, 3));
        assert_eq!(std::fs::read(dest.join("a.mp3")).unwrap(), b"aaa");
        assert!(!dest.join(".copiando-a.mp3").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod pruebas_import_carpeta {
    #[test]
    fn carpeta_con_estructura_y_plana() {
        let dir = std::env::temp_dir().join(format!("infiniity-impcarp-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let src = dir.join("Musica");
        std::fs::create_dir_all(src.join("Salsa")).unwrap();
        std::fs::create_dir_all(src.join("Merengue/Viejo")).unwrap();
        std::fs::create_dir_all(src.join(".oculta")).unwrap();
        std::fs::write(src.join("Salsa/a.mp3"), b"a").unwrap();
        std::fs::write(src.join("Merengue/Viejo/b.wav"), b"b").unwrap();
        std::fs::write(src.join("Merengue/nota.txt"), b"x").unwrap();
        std::fs::write(src.join(".oculta/c.mp3"), b"c").unwrap();
        // Original: conserva estructura.
        let raiz = dir.join("Biblioteca");
        let (c, s) = super::import_folder(src.to_str().unwrap(), raiz.to_str().unwrap(), true).unwrap();
        assert_eq!((c, s), (2, 1));
        assert!(raiz.join("Salsa/a.mp3").is_file());
        assert!(raiz.join("Merengue/Viejo/b.wav").is_file());
        assert!(!raiz.join(".oculta").exists());
        // Equipo: todo plano en Sin clasificar.
        let sin = dir.join("Sin clasificar");
        let (c, s) = super::import_folder(src.to_str().unwrap(), sin.to_str().unwrap(), false).unwrap();
        assert_eq!((c, s), (2, 1));
        assert!(sin.join("a.mp3").is_file() && sin.join("b.wav").is_file());
        // Dentro de la biblioteca: se niega.
        assert!(super::import_folder(raiz.join("Salsa").to_str().unwrap(), raiz.to_str().unwrap(), true).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
