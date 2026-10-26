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
  // Etiquetas ID3 (las escribe la skill /Organizar_Canciones)
  title: string | null;
  artist: string | null;
  genre: string | null;
  gain_db: number | null; // ReplayGain en dB
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
/** Modo navegador de prueba (solo desarrollo; ver vite.config.ts). */
const pruebaNavegador = (): boolean => import.meta.env.DEV && !isTauri();

export const readLibrary = async (root: string): Promise<LibraryData> => {
  if (pruebaNavegador()) {
    const r = await fetch("/__dj/biblioteca.json");
    if (!r.ok) throw new Error("(modo navegador) sin biblioteca de prueba: define DJ_BIBLIOTECA_JSON");
    return (await r.json()) as LibraryData;
  }
  return invoke<LibraryData>("read_library", { root });
};
export const moveTrack = (from: string, toFolder: string) =>
  invoke<string>("move_track", { from, toFolder });
export const createFolder = (parent: string, name: string) =>
  invoke<string>("create_folder", { parent, name });
export const ensureUnclassified = (root: string) =>
  invoke<string>("ensure_unclassified", { root });

// --- Sincronización de la biblioteca (ver src-tauri/src/sync.rs) ---
export type SyncRol = "ninguno" | "original" | "equipo";
export interface PcConectada {
  id: string;
  nombre: string;
  conectado: boolean;
  ultimo_visto: string;
  completado: number; // % de la Biblioteca que esa PC ya tiene
}
/** Original: una PC intentando entrar con un código que ya no sirve. */
export interface PcRechazada {
  nombre: string;
  desde: string; // desde cuándo lo intenta
}
export interface SyncEstado {
  rol: SyncRol;
  activo: boolean; // Syncthing responde
  original_conectado: boolean;
  pendientes: number; // archivos que faltan por recibir en esta PC
  pendientes_mb: number;
  por_subir: number; // equipo: lo propio que al original aún le falta
  por_subir_mb: number;
  completado: number; // % de la Biblioteca que ya está en esta PC (equipo)
  autorizado: boolean;
  musica: boolean;
  pausa_manual: boolean;
  frenado: boolean;
  pcs: PcConectada[];
  raiz: string; // carpeta de la biblioteca según el rol
  servicio_activo: boolean; // original: el servicio "siempre encendida" ya corre
  rechazadas: PcRechazada[]; // original: PC tocando la puerta con un código viejo
  codigo_rechazado: boolean; // equipo: el original nunca aceptó este código
}
export const syncEstado = () => invoke<SyncEstado>("sync_estado");
export const syncCrearGrupo = (raiz: string) => invoke<string>("sync_crear_grupo", { raiz });
export const syncCodigo = () => invoke<string>("sync_codigo");
export const syncCambiarSecreto = () => invoke<string>("sync_cambiar_secreto");
export const syncUnirse = (codigo: string, nombre: string) => invoke<void>("sync_unirse", { codigo, nombre });
export const syncAutorizar = (autorizado: boolean, pausaManual: boolean) =>
  invoke<void>("sync_autorizar", { autorizado, pausaManual });
export const syncMusica = (sonando: boolean) => invoke<void>("sync_musica", { sonando });
export const syncInstalarServicio = () => invoke<string>("sync_instalar_servicio");
export const syncQuitarPc = (id: string) => invoke<void>("sync_quitar_pc", { id });
export const syncRenombrarPc = (id: string, nombre: string) => invoke<void>("sync_renombrar_pc", { id, nombre });
export const syncSalir = () => invoke<void>("sync_salir");
export const syncLog = () => invoke<string>("sync_log");

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
/** yt-dlp -U: devuelve el mensaje de yt-dlp ("Updated yt-dlp to ..." / "is up to date"). */
export const ytdlUpdate = () => invoke<string>("ytdl_update");
export const ytdlDownload = (url: string, destFolder: string, id: string) =>
  invoke<string>("ytdl_download", { url, destFolder, id });
export const onYtdlProgress = (
  handler: (p: YtdlProgress) => void
): Promise<UnlistenFn> => {
  if (!isTauri()) return Promise.resolve(() => {});
  return tauriListen<YtdlProgress>("ytdl://progress", (e) => handler(e.payload));
};

// --- Salida de audio (por donde suena la app) ---
export interface AudioOutput {
  name: string; // nombre tecnico
  description: string; // nombre para mostrar
  kind: string; // "bluetooth" | "hdmi" | "usb" | "analogica" | "digital" | "otra"
  active: boolean; // true en la salida por la que suena la app ahora
}
export const audioOutputs = () => invoke<AudioOutput[]>("audio_outputs");
/** Como fue el cambio de salida (ver `ResultadoSalida` en salida_audio.rs). */
export interface ResultadoSalida {
  movidos: number; // flujos de sonido movidos (0 = la app aun no sonaba)
  arreglos: string[]; // lo que hubo que corregir para que se oiga
}
export const audioSetOutput = (sink: string) =>
  invoke<ResultadoSalida>("audio_set_output", { sink });

/** Lo que pasa AHORA MISMO con el sonido de la app (ver salida_audio.rs). */
export interface EstadoSalida {
  hay_flujo: boolean; // la app tiene abierta una conexion de sonido
  salida: string | null; // salida por la que va (nombre tecnico)
  pausado: boolean; // el sistema lo tiene en pausa
  estado: string; // "RUNNING" solo si esta saliendo sonido de verdad
  volumen: number; // volumen que el EQUIPO le da a esa salida (%)
  silenciada: boolean; // el equipo la tiene muda
  fantasma: boolean; // solo Bluetooth: conectada A MEDIAS, sin canal de sonido
}
/**
 * Comprueba si de verdad esta saliendo sonido por donde creemos. Que mover el
 * flujo no de error NO significa que se oiga: con Bluetooth pasaba justo eso.
 */
export const audioOutputStatus = () => invoke<EstadoSalida>("audio_output_status");

// --- Cabinas Bluetooth (ver src-tauri/src/bluetooth.rs) ---
export interface DispositivoBt {
  mac: string; // direccion del aparato
  nombre: string; // nombre para mostrar
  conectado: boolean;
  emparejado: boolean;
  altavoz: boolean; // sirve para sacar sonido (no es un teclado ni un celular)
}
export interface EstadoBt {
  hay: boolean; // el equipo tiene Bluetooth
  encendido: boolean;
  motivo: string; // por que no se puede usar (vacio si todo bien)
}
export const btEstado = (): Promise<EstadoBt> => {
  // En el navegador no hay Bluetooth que valga: se dice, en vez de dejar la
  // lista vacia como si el equipo no tuviera ninguna cabina.
  // En el navegador no hay Bluetooth que valga: se dice, en vez de dejar la
  // lista vacia como si el equipo no tuviera ninguna cabina.
  if (!isTauri())
    return Promise.resolve({
      hay: false,
      encendido: false,
      motivo: "(modo navegador) las cabinas Bluetooth solo funcionan en el programa instalado.",
    });
  return invoke<EstadoBt>("bt_estado");
};
export const btEncender = () => invoke<void>("bt_encender");
/** Cabinas que el equipo ya conoce (emparejadas o vistas hace poco). */
export const btDispositivos = (): Promise<DispositivoBt[]> => {
  if (!isTauri()) return Promise.resolve([]);
  return invoke<DispositivoBt[]>("bt_dispositivos");
};
/** Busca cabinas encendidas alrededor durante unos segundos. */
export const btBuscar = (segundos: number): Promise<DispositivoBt[]> => {
  if (!isTauri()) return Promise.resolve([]);
  return invoke<DispositivoBt[]>("bt_buscar", { segundos });
};
/**
 * Empareja (si hace falta), marca de confianza y conecta. Devuelve un aviso si
 * hubo que reavivar la cabina (vacio si no hizo falta).
 */
export const btConectar = (mac: string) => invoke<string>("bt_conectar", { mac });
export const btDesconectar = (mac: string) => invoke<void>("bt_desconectar", { mac });

/**
 * Guarda un informe de fallo dentro de la carpeta de musica, que es la que ya
 * viaja sola entre las PC por Sync. Devuelve donde quedo guardado.
 */
/** Resultado de comprobar si el sonido llega a una salida. */
export interface Llegada {
  llega: boolean;
  detalle: string;
  preparado_bluetooth: boolean; // el programa arrancó preparado para Bluetooth
}
/** Comprueba si llega sonido a esa salida. Tarda unos segundos: graba de ella. */
export const audioLlegaSonido = (salida: string) =>
  invoke<Llegada>("audio_llega_sonido", { salida });

export const guardarInforme = (
  carpetaMusica: string,
  estadoApp: string,
  salida: string
) => invoke<string>("guardar_informe", { carpetaMusica, estadoApp, salida });

// --- Monitor de recursos ---
export interface SystemStats {
  ram_mb: number;
  cpu_pct: number;
  procs: number;
}
export const systemStats = (note: string) => invoke<SystemStats>("system_stats", { note });
export const diagReveal = () => invoke<void>("diag_reveal").catch(() => {});

// --- Arranque (ver src-tauri/src/arranque.rs) ---
export interface ModoDibujo {
  software: boolean; // true = el motor web dibuja con la CPU, sin tarjeta grafica
  motivo: string; // "gpu" | "nvidia" | "gpu-prohibida" | "gpu-fallo-al-abrir" | ...
}
export const modoDibujo = () => invoke<ModoDibujo>("modo_dibujo");
/** Avisa que la interfaz ya se pinto: el arranque con GPU salio bien. */
export const interfazLista = () => invoke<void>("interfaz_lista");

// --- BPM ---
export const analyzeBpm = (path: string) => invoke<TrackMeta>("analyze_bpm", { path });
export const setManualBpm = (path: string, bpm: number) =>
  invoke<TrackMeta>("set_manual_bpm", { path, bpm });

// --- MIDI / DDJ-200 ---
export const midiList = () => invoke<string[]>("midi_list");
export const midiConnect = () => invoke<string>("midi_connect");
export const midiDisconnect = () => invoke<void>("midi_disconnect");
export interface MidiStatus {
  connected: boolean;
  port: string | null;
}
/** La controladora aparecio o se fue (lo detecta el vigilante en Rust). */
export const onMidiStatus = (handler: (s: MidiStatus) => void): Promise<UnlistenFn> => {
  if (!isTauri()) return Promise.resolve(() => {});
  return tauriListen<MidiStatus>("midi://status", (e) => handler(e.payload));
};
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

/** Selector de archivos de audio (varios). Devuelve las rutas elegidas. */
export async function pickAudioFiles(): Promise<string[]> {
  if (!isTauri()) return [];
  const res = await tauriOpen({
    multiple: true,
    directory: false,
    filters: [{ name: "Canciones", extensions: ["mp3", "wav", "MP3", "WAV"] }],
  });
  if (Array.isArray(res)) return res.filter((r): r is string => typeof r === "string");
  return typeof res === "string" ? [res] : [];
}
/** Copia una carpeta entera (con o sin su estructura de subcarpetas). Devuelve [copiadas, saltadas]. */
export const importFolder = (src: string, dest: string, conservarEstructura: boolean) =>
  invoke<[number, number]>("import_folder", { src, dest, conservarEstructura });
/** Copia canciones del computador a `dest` (Sin clasificar). Devuelve [copiadas, saltadas]. */
export const importTracks = (paths: string[], dest: string) =>
  invoke<[number, number]>("import_tracks", { paths, dest });

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
  if (pruebaNavegador()) {
    const r = await fetch(`/__dj/media?path=${encodeURIComponent(path)}`);
    if (!r.ok) throw new Error(`(modo navegador) no se pudo leer ${path}`);
    return r.arrayBuffer();
  }
  if (!isTauri()) throw new Error("(modo navegador) sin acceso a archivos");
  const buf = await tauriInvoke<ArrayBuffer>("read_media", { path });
  // Algunos entornos devuelven un tipo array-like; normalizar a ArrayBuffer.
  if (buf instanceof ArrayBuffer) return buf;
  return new Uint8Array(buf as unknown as ArrayLike<number>).buffer;
}
