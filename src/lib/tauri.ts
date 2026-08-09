/**
 * Puente entre React y el backend en Rust (Tauri).
 * Todas las llamadas al "cerebro" del programa pasan por aqui.
 *
 * Si la app se abre en un navegador normal (modo desarrollo sin Tauri), estas
 * funciones no rompen: devuelven valores vacios para que la interfaz igual se
 * pueda ver.
 */

import { invoke as tauriInvoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";
import { open as tauriOpen } from "@tauri-apps/plugin-dialog";

export interface TrackInfo {
  path: string;
  name: string;
  file_name: string;
  folder: string;
  ext: string;
  size: number;
  modified: number;
  bpm: number | null;
  duration: number | null;
  bpm_manual: boolean;
}

export interface FolderNode {
  name: string;
  path: string;
  children: FolderNode[];
  track_count: number;
}

export interface LibraryData {
  root: string;
  tree: FolderNode;
  tracks: TrackInfo[];
}

export interface TrackMeta {
  bpm: number | null;
  duration: number | null;
  manual: boolean;
}

export interface MidiControlEvent {
  action: string;
  deck: number; // 0 = A, 1 = B, 255 = global
  value: number;
}

export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error(`(modo navegador) comando no disponible: ${cmd}`);
  }
  return tauriInvoke<T>(cmd, args);
}

// --- Biblioteca ---
export const readLibrary = (root: string) => invoke<LibraryData>("read_library", { root });
export const moveTrack = (from: string, toFolder: string) =>
  invoke<string>("move_track", { from, toFolder });
export const createFolder = (parent: string, name: string) =>
  invoke<string>("create_folder", { parent, name });
export const ensureUnclassified = (root: string) =>
  invoke<string>("ensure_unclassified", { root });

// --- Descargador de YouTube (yt-dlp) ---
export interface YtdlTools {
  ytdlp: string | null;
  deno: string | null;
  ffmpeg: string | null;
  ready: boolean;
}
export interface YtdlProgress {
  id: string;
  percent: number;
  stage: string; // "descargando" | "convirtiendo" | "listo" | "error"
  message: string;
}
export interface YtSearchResult {
  id: string;
  title: string;
  duration: number | null;
  channel: string;
}
export const ytdlTools = () => invoke<YtdlTools>("ytdl_tools");
export const ytdlSearch = (query: string) => invoke<YtSearchResult[]>("ytdl_search", { query });
export const ytdlInstall = () => invoke<YtdlTools>("ytdl_install");
export const ytdlDownload = (url: string, destFolder: string, id: string) =>
  invoke<string>("ytdl_download", { url, destFolder, id });
export const onYtdlProgress = (
  handler: (p: YtdlProgress) => void
): Promise<UnlistenFn> => {
  if (!isTauri()) return Promise.resolve(() => {});
  return tauriListen<YtdlProgress>("ytdl://progress", (e) => handler(e.payload));
};

// --- Monitor de recursos ---
export interface SystemStats {
  ram_mb: number;
  cpu_pct: number;
  procs: number;
}
export const systemStats = (note: string) => invoke<SystemStats>("system_stats", { note });
export const diagReveal = () => invoke<void>("diag_reveal").catch(() => {});

// --- BPM ---
export const analyzeBpm = (path: string) => invoke<TrackMeta>("analyze_bpm", { path });
export const setManualBpm = (path: string, bpm: number) =>
  invoke<TrackMeta>("set_manual_bpm", { path, bpm });

// --- MIDI / DDJ-200 ---
export const midiList = () => invoke<string[]>("midi_list");
export const midiConnect = () => invoke<string>("midi_connect");
export const midiDisconnect = () => invoke<void>("midi_disconnect");
export const onMidiControl = (
  handler: (ev: MidiControlEvent) => void
): Promise<UnlistenFn> => {
  if (!isTauri()) return Promise.resolve(() => {});
  return tauriListen<MidiControlEvent>("midi://control", (e) => handler(e.payload));
};

// --- Ventana ---
export const quitApp = () => invoke<void>("quit_app").catch(() => {});
export const minimizeWindow = () => invoke<void>("minimize_window").catch(() => {});
export const toggleFullscreen = () => invoke<boolean>("toggle_fullscreen").catch(() => false);

// --- Utilidades ---
/** Selector de carpeta del sistema. Devuelve la ruta elegida o null. */
export async function pickFolder(): Promise<string | null> {
  if (!isTauri()) return null;
  const res = await tauriOpen({ directory: true, multiple: false });
  return typeof res === "string" ? res : null;
}

/** Convierte una ruta de archivo local en una URL que el reproductor puede usar. */
export function fileUrl(path: string): string {
  if (!isTauri()) return path;
  return convertFileSrc(path);
}

/**
 * Lee un archivo de audio del disco y devuelve sus bytes crudos (ArrayBuffer).
 * El motor de audio los decodifica a PCM para reproducir con la Web Audio API
 * (via AudioBufferSourceNode), que es lo mas fiable en Linux/WebKitGTK.
 */
export async function readMediaBytes(path: string): Promise<ArrayBuffer> {
  if (!isTauri()) throw new Error("(modo navegador) sin acceso a archivos");
  const buf = await tauriInvoke<ArrayBuffer>("read_media", { path });
  // Algunos entornos devuelven un tipo array-like; normalizar a ArrayBuffer.
  if (buf instanceof ArrayBuffer) return buf;
  return new Uint8Array(buf as unknown as ArrayLike<number>).buffer;
}
