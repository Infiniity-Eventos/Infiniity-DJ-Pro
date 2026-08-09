//! Monitor de recursos (RAM/CPU) leyendo /proc directamente, sin dependencias.
//! Suma el ARBOL de procesos de la app, porque la ventana web (WebKitGTK) corre
//! en procesos aparte del binario principal.

use serde::Serialize;
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Instant;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Clone, Copy)]
pub struct Stats {
    pub ram_mb: f64,
    pub cpu_pct: f64,
    pub procs: usize,
}

/// Muestra previa para calcular el % de CPU entre dos lecturas.
pub struct CpuSample {
    at: Instant,
    proc_jiffies: u64,
}

const PAGE_SIZE: u64 = 4096; // bytes por pagina (x86_64)
const USER_HZ: f64 = 100.0; // ticks por segundo (habitual en Linux)

/// Lee /proc/<pid>/stat -> (ppid, utime+stime en jiffies).
fn read_pid_stat(pid: u32) -> Option<(u32, u64)> {
    let content = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    // Formato: "pid (comm) state ppid ... utime stime ..."  (comm puede tener espacios/parentesis)
    let close = content.rfind(')')?;
    let rest = content.get(close + 2..)?;
    let f: Vec<&str> = rest.split_whitespace().collect();
    // Tras "comm)": [0]=state [1]=ppid ... utime=campo global 14 => indice 11, stime => 12
    let ppid: u32 = f.get(1)?.parse().ok()?;
    let utime: u64 = f.get(11)?.parse().ok()?;
    let stime: u64 = f.get(12)?.parse().ok()?;
    Some((ppid, utime + stime))
}

/// RSS (memoria residente real) en bytes desde /proc/<pid>/statm.
fn read_rss_bytes(pid: u32) -> u64 {
    std::fs::read_to_string(format!("/proc/{pid}/statm"))
        .ok()
        .and_then(|s| s.split_whitespace().nth(1).and_then(|r| r.parse::<u64>().ok()))
        .map(|pages| pages * PAGE_SIZE)
        .unwrap_or(0)
}

fn all_pids() -> Vec<u32> {
    let mut pids = Vec::new();
    if let Ok(rd) = std::fs::read_dir("/proc") {
        for e in rd.flatten() {
            if let Ok(name) = e.file_name().into_string() {
                if let Ok(pid) = name.parse::<u32>() {
                    pids.push(pid);
                }
            }
        }
    }
    pids
}

pub fn read_stats(prev: &mut Option<CpuSample>) -> Stats {
    let me = std::process::id();
    let mut info: HashMap<u32, (u32, u64)> = HashMap::new();
    for pid in all_pids() {
        if let Some(v) = read_pid_stat(pid) {
            info.insert(pid, v);
        }
    }

    // Nuestro proceso + todos sus descendientes.
    let mut targets: Vec<u32> = vec![me];
    let mut i = 0;
    while i < targets.len() {
        let parent = targets[i];
        for (&pid, &(ppid, _)) in &info {
            if ppid == parent && !targets.contains(&pid) {
                targets.push(pid);
            }
        }
        i += 1;
    }

    let mut ram: u64 = 0;
    let mut proc_jiffies: u64 = 0;
    for &pid in &targets {
        ram += read_rss_bytes(pid);
        if let Some(&(_, j)) = info.get(&pid) {
            proc_jiffies += j;
        }
    }

    // CPU% (respecto a un nucleo) usando la diferencia con la muestra previa.
    let now = Instant::now();
    let cpu_pct = match prev.as_ref() {
        Some(p) if proc_jiffies >= p.proc_jiffies => {
            let dt = now.duration_since(p.at).as_secs_f64();
            if dt > 0.05 {
                ((proc_jiffies - p.proc_jiffies) as f64 / USER_HZ / dt) * 100.0
            } else {
                0.0
            }
        }
        _ => 0.0,
    };
    *prev = Some(CpuSample { at: now, proc_jiffies });

    Stats {
        ram_mb: ram as f64 / 1_048_576.0,
        cpu_pct,
        procs: targets.len(),
    }
}

// ---------------------------------------------------------------------------
// Registro de diagnóstico (para medir el rendimiento en el equipo real)
// ---------------------------------------------------------------------------

static START: OnceLock<Instant> = OnceLock::new();

fn read_field(path: &str, key: &str, sep: char) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    for line in content.lines() {
        if let Some(rest) = line.strip_prefix(key) {
            let v = rest.trim().trim_start_matches(sep).trim().trim_matches('"');
            if !v.is_empty() {
                return Some(v.to_string());
            }
        }
    }
    None
}

/// Info del equipo (se escribe una vez en la cabecera del diagnóstico).
fn system_info() -> String {
    let cpu = read_field("/proc/cpuinfo", "model name", ':').unwrap_or_else(|| "CPU?".into());
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(0);
    let ram_kb = read_field("/proc/meminfo", "MemTotal", ':')
        .and_then(|s| s.split_whitespace().next().and_then(|n| n.parse::<u64>().ok()))
        .unwrap_or(0);
    let ram_gb = ram_kb as f64 / 1_048_576.0;
    let os = read_field("/etc/os-release", "PRETTY_NAME=", '=').unwrap_or_else(|| "Linux".into());
    format!("CPU: {cpu} | nucleos: {cores} | RAM total: {ram_gb:.1} GB | SO: {os}")
}

/// Ruta del archivo de diagnóstico.
pub fn diag_path(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let _ = std::fs::create_dir_all(&dir);
    dir.join("diagnostico-rendimiento.csv")
}

/// Añade una muestra al archivo de diagnóstico. `note` describe qué hace la app.
pub fn log_sample(app: &AppHandle, s: &Stats, note: &str) {
    let path = diag_path(app);
    let is_new = !path.exists();
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
        if is_new {
            let _ = writeln!(f, "# Infiniity DJ - diagnostico de rendimiento");
            let _ = writeln!(f, "# {}", system_info());
            let _ = writeln!(f, "segundos,ram_mb,cpu_pct,procesos,actividad");
        }
        let secs = START.get_or_init(Instant::now).elapsed().as_secs();
        let _ = writeln!(
            f,
            "{},{:.1},{:.1},{},{}",
            secs, s.ram_mb, s.cpu_pct, s.procs, note
        );
    }
}
