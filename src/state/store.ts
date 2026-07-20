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
  analyzing: Set<string>; // rutas en analisis (para el spinner del boton)

  setTheme: (t: Theme) => void;
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
  setAnalyzing: (path: string, on: boolean) => void;
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
  musicRoot: string | null;
  settings: Settings;
  masterVolume: number;
}

const defaultSettings: Settings = {
  transitionSec: 8,
  returnToNatural: true,
  maxTempoDiff: 0.08,
};

function loadPrefs(): Persisted {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Persisted>;
      return {
        theme: p.theme ?? "dark",
        musicRoot: p.musicRoot ?? null,
        settings: { ...defaultSettings, ...(p.settings ?? {}) },
        masterVolume: p.masterVolume ?? 1,
      };
    }
  } catch {
    /* ignorar */
  }
  return { theme: "dark", musicRoot: null, settings: defaultSettings, masterVolume: 1 };
}

function savePrefs(s: AppStore) {
  const p: Persisted = {
    theme: s.theme,
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
  analyzing: new Set<string>(),

  setTheme: (t) => {
    set({ theme: t });
    savePrefs(get());
  },
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
  setAnalyzing: (path, on) =>
    set((st) => {
      const next = new Set(st.analyzing);
      if (on) next.add(path);
      else next.delete(path);
      return { analyzing: next };
    }),
}));
