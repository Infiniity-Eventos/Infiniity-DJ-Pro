/**
 * Estado global de la app (Zustand: muy liviano).
 * Guarda solo datos "serializables". La posicion de reproduccion en vivo NO se
 * guarda aqui (para no recargar la interfaz 60 veces por segundo); eso lo lee
 * cada componente directamente del motor de audio.
 */

import { create } from "zustand";
import type { LibraryData } from "../lib/tauri";

export type DeckId = "A" | "B";
export type Theme = "dark" | "light";

export interface DownloadItem {
  id: string;
  url: string; // para reintentar sin volver a buscar
  title: string;
  percent: number;
  stage: string; // "descargando" | "convirtiendo" | ...
  status: "downloading" | "error";
  errorMsg?: string;
}

export interface DeckInfo {
  trackPath: string | null;
  trackName: string | null;
  bpm: number | null;
  bpmManual: boolean;
  duration: number; // segundos (lo llena el reproductor al cargar)
  isPlaying: boolean;
  volume: number; // 0..1 (fader del deck)
  rate: number; // playbackRate actual (1.0 = natural)
  loading: boolean;
}

export interface Settings {
  transitionSec: number; // duracion de la transicion automatica
  returnToNatural: boolean; // al terminar, la cancion nueva vuelve a su tempo
  maxTempoDiff: number; // limite de compatibilidad (0.08 = 8%)
}

interface AppStore {
  theme: Theme;
  lowPower: boolean;
  /** true = nadie lo eligio a mano; lo decide el programa segun el equipo. */
  lowPowerAuto: boolean;
  /** Como dibuja el motor web este arranque (null hasta que Rust responda). */
  modoDibujo: { software: boolean; motivo: string } | null;
  musicRoot: string | null;
  decks: Record<DeckId, DeckInfo>;
  crossfader: number; // 0 = A, 1 = B
  masterVolume: number;
  autoMixing: boolean;
  library: LibraryData | null;
  libraryLoading: boolean;
  search: string;
  selectedFolder: string | null;
  settings: Settings;
  midiConnected: boolean;
  midiPort: string | null;
  toast: string | null;
  confirmBox: { message: string; onYes: () => void } | null; // aviso de confirmacion
  promptBox: { message: string; defaultValue: string; onSubmit: (v: string) => void } | null; // pedir un dato (sin bloquear el audio)
  downloaderOpen: boolean; // modal de descarga de YouTube abierto
  downloads: DownloadItem[]; // descargas en curso (en segundo plano)
  highlightTrack: string | null; // ruta de la cancion recien descargada (para titilar)
  analyzing: Set<string>; // rutas en analisis (para el spinner del boton)
  pedidas: Set<string>; // ids de YouTube ya pedidos en esta sesion (para marcar ✅ en el buscador)

  setTheme: (t: Theme) => void;
  setLowPower: (v: boolean) => void;
  /** Valor decidido por el programa; solo aplica si el usuario nunca eligio. */
  setLowPowerAuto: (v: boolean) => void;
  setModoDibujo: (m: { software: boolean; motivo: string }) => void;
  setMusicRoot: (p: string | null) => void;
  patchDeck: (id: DeckId, patch: Partial<DeckInfo>) => void;
  setCrossfader: (v: number) => void;
  setMasterVolume: (v: number) => void;
  setAutoMixing: (v: boolean) => void;
  setLibrary: (l: LibraryData | null) => void;
  setLibraryLoading: (v: boolean) => void;
  setSearch: (s: string) => void;
  setSelectedFolder: (p: string | null) => void;
  setSettings: (s: Partial<Settings>) => void;
  setMidi: (connected: boolean, port: string | null) => void;
  showToast: (msg: string) => void;
  askConfirm: (message: string, onYes: () => void) => void;
  closeConfirm: () => void;
  askPrompt: (message: string, defaultValue: string, onSubmit: (v: string) => void) => void;
  closePrompt: () => void;
  setDownloaderOpen: (v: boolean) => void;
  addDownload: (d: DownloadItem) => void;
  updateDownload: (id: string, patch: Partial<DownloadItem>) => void;
  removeDownload: (id: string) => void;
  setHighlightTrack: (path: string | null) => void;
  setAnalyzing: (path: string, on: boolean) => void;
  marcarPedida: (id: string) => void;
}

const emptyDeck = (): DeckInfo => ({
  trackPath: null,
  trackName: null,
  bpm: null,
  bpmManual: false,
  duration: 0,
  isPlaying: false,
  volume: 1,
  rate: 1,
  loading: false,
});

// --- Persistencia sencilla en localStorage ---
const LS_KEY = "infiniity-dj-prefs";

interface Persisted {
  theme: Theme;
  lowPower: boolean;
  lowPowerAuto: boolean;
  musicRoot: string | null;
  settings: Settings;
  masterVolume: number;
}

const defaultSettings: Settings = {
  transitionSec: 8,
  returnToNatural: true,
  maxTempoDiff: 0.08,
};

// Equipo "flojo": pocos hilos de CPU (portátiles de gama baja). En esos casos
// arrancamos en modo bajo consumo para que NUNCA se trabe en un evento.
// Es solo el valor de arranque: en cuanto Rust dice si se dibuja por software
// (App.tsx), eso manda. Dibujar por software con desenfoque y disco giratorio
// es lo que de verdad castiga la CPU, tenga los hilos que tenga.
export function weakMachineDefault(): boolean {
  try {
    return typeof navigator !== "undefined" && (navigator.hardwareConcurrency ?? 8) <= 4;
  } catch {
    return false;
  }
}

function loadPrefs(): Persisted {
  const autoLow = weakMachineDefault();
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Persisted>;
      return {
        theme: p.theme ?? "dark",
        // Si el usuario nunca lo eligió, decidimos según el equipo. Antes esta
        // bandera no existia: lo guardado era automatico, asi que se recalcula.
        lowPowerAuto: p.lowPowerAuto ?? true,
        lowPower: p.lowPowerAuto === false ? (p.lowPower ?? autoLow) : autoLow,
        musicRoot: p.musicRoot ?? null,
        settings: { ...defaultSettings, ...(p.settings ?? {}) },
        masterVolume: p.masterVolume ?? 1,
      };
    }
  } catch {
    /* ignorar */
  }
  return {
    theme: "dark",
    lowPower: autoLow,
    lowPowerAuto: true,
    musicRoot: null,
    settings: defaultSettings,
    masterVolume: 1,
  };
}

function savePrefs(s: AppStore) {
  const p: Persisted = {
    theme: s.theme,
    lowPower: s.lowPower,
    lowPowerAuto: s.lowPowerAuto,
    musicRoot: s.musicRoot,
    settings: s.settings,
    masterVolume: s.masterVolume,
  };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(p));
  } catch {
    /* ignorar */
  }
}

const initial = loadPrefs();

export const useStore = create<AppStore>((set, get) => ({
  theme: initial.theme,
  lowPower: initial.lowPower,
  lowPowerAuto: initial.lowPowerAuto,
  modoDibujo: null,
  musicRoot: initial.musicRoot,
  decks: { A: emptyDeck(), B: emptyDeck() },
  crossfader: 0.5,
  masterVolume: initial.masterVolume,
  autoMixing: false,
  library: null,
  libraryLoading: false,
  search: "",
  selectedFolder: null,
  settings: initial.settings,
  midiConnected: false,
  midiPort: null,
  toast: null,
  confirmBox: null,
  promptBox: null,
  downloaderOpen: false,
  downloads: [],
  highlightTrack: null,
  analyzing: new Set<string>(),
  pedidas: new Set<string>(),

  setTheme: (t) => {
    set({ theme: t });
    savePrefs(get());
  },
  setLowPower: (v) => {
    // Lo toco el usuario: desde ahora manda el, no el programa.
    set({ lowPower: v, lowPowerAuto: false });
    savePrefs(get());
  },
  setLowPowerAuto: (v) => {
    if (!get().lowPowerAuto) return;
    set({ lowPower: v });
    savePrefs(get());
  },
  setModoDibujo: (m) => set({ modoDibujo: m }),
  setMusicRoot: (p) => {
    set({ musicRoot: p });
    savePrefs(get());
  },
  patchDeck: (id, patch) =>
    set((st) => ({ decks: { ...st.decks, [id]: { ...st.decks[id], ...patch } } })),
  setCrossfader: (v) => set({ crossfader: Math.min(1, Math.max(0, v)) }),
  setMasterVolume: (v) => {
    set({ masterVolume: Math.min(1, Math.max(0, v)) });
    savePrefs(get());
  },
  setAutoMixing: (v) => set({ autoMixing: v }),
  setLibrary: (l) => set({ library: l }),
  setLibraryLoading: (v) => set({ libraryLoading: v }),
  setSearch: (s) => set({ search: s }),
  setSelectedFolder: (p) => set({ selectedFolder: p }),
  setSettings: (s) => {
    set((st) => ({ settings: { ...st.settings, ...s } }));
    savePrefs(get());
  },
  setMidi: (connected, port) => set({ midiConnected: connected, midiPort: port }),
  showToast: (msg) => {
    set({ toast: msg });
    window.setTimeout(() => {
      if (get().toast === msg) set({ toast: null });
    }, 3200);
  },
  askConfirm: (message, onYes) => set({ confirmBox: { message, onYes } }),
  closeConfirm: () => set({ confirmBox: null }),
  askPrompt: (message, defaultValue, onSubmit) =>
    set({ promptBox: { message, defaultValue, onSubmit } }),
  closePrompt: () => set({ promptBox: null }),
  setDownloaderOpen: (v) => set({ downloaderOpen: v }),
  addDownload: (d) =>
    set((st) => ({ downloads: [...st.downloads.filter((x) => x.id !== d.id), d] })),
  updateDownload: (id, patch) =>
    set((st) => ({
      downloads: st.downloads.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    })),
  removeDownload: (id) =>
    set((st) => ({ downloads: st.downloads.filter((d) => d.id !== id) })),
  setHighlightTrack: (path) => {
    set({ highlightTrack: path });
    if (path) {
      window.setTimeout(() => {
        if (get().highlightTrack === path) set({ highlightTrack: null });
      }, 7000);
    }
  },
  marcarPedida: (id) => set((s) => ({ pedidas: new Set(s.pedidas).add(id) })),
  setAnalyzing: (path, on) =>
    set((st) => {
      const next = new Set(st.analyzing);
      if (on) next.add(path);
      else next.delete(path);
      return { analyzing: next };
    }),
}));
