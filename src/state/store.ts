/**
 * Estado global de la app (Zustand: muy liviano).
 * Guarda solo datos "serializables". La posicion de reproduccion en vivo NO se
 * guarda aqui (para no recargar la interfaz 60 veces por segundo); eso lo lee
 * cada componente directamente del motor de audio.
 */

import { create } from "zustand";
import type { LibraryData, SyncEstado } from "../lib/tauri";

export type DeckId = "A" | "B";

export interface DownloadItem {
  id: string;
  url: string; // para reintentar sin volver a buscar
  title: string;
  percent: number;
  stage: string; // "descargando" | "convirtiendo" | ...
  status: "downloading" | "error";
  errorMsg?: string;
}

/** Perillas de efectos de un deck (0..1). Neutro: 0.5 en todas menos Voz (0 = sin efecto). */
export type FxKey = "graves" | "medios" | "agudos" | "filtro" | "voz";
export type FxValues = Record<FxKey, number>;
export const FX_NEUTRO: FxValues = { graves: 0.5, medios: 0.5, agudos: 0.5, filtro: 0.5, voz: 0 };

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
  fx: FxValues; // perillas de efectos (ver AudioEngine.setFx)
}

/** Una cancion dentro de la cola del automix. */
export interface ItemCola {
  id: string; // unico dentro de la cola (una misma cancion puede estar dos veces)
  path: string;
  nombre: string; // "Titulo · Artista" o el nombre del archivo
  bpm: number | null;
  duracion: number | null;
  gainDb: number | null; // ReplayGain de la etiqueta (para que suene pareja desde el primer segundo)
  sono: boolean; // ya sono en esta vuelta (regla D11: primero las que no han sonado)
  fallo: string | null; // no se pudo cargar: se salta y se muestra el porque
}

export interface EstadoAutomix {
  encendido: boolean;
  cola: ItemCola[];
  etiqueta: string | null; // de donde vino la cola ("Salsa", "Romeo Santos"...)
  sonandoId: string | null; // item que suena ahora
  siguienteId: string | null; // item precargado en el deck libre
  siguienteLista: boolean; // false = todavia cargando
  /** Segundos que faltan para la proxima mezcla (null = no se sabe / nada suena). */
  faltan: number | null;
  mensaje: string | null; // estado corto para la barra ("cola vacia", "mezclando...")
  plegada: boolean; // barra plegada para ganar espacio
}

/**
 * Aviso de confirmacion propio (no bloquea el audio). `alt` es un tercer boton
 * opcional (p. ej. "Añadir al final" ademas de "Limpiar y poner").
 */
export interface ConfirmBox {
  message: string;
  onYes: () => void;
  yesLabel?: string;
  alt?: { label: string; onClick: () => void };
}

export interface Settings {
  transitionSec: number; // duracion de la transicion automatica
  returnToNatural: boolean; // al terminar, la cancion nueva vuelve a su tempo
  maxTempoDiff: number; // limite de compatibilidad (0.08 = 8%)
}

interface AppStore {
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
  selectedArtist: string | null; // filtro por artista (modo Artistas del panel)
  vistaCarpetas: "generos" | "artistas";
  settings: Settings;
  audioSink: string | null; // salida de audio elegida (nombre tecnico de pactl)
  audioModalOpen: boolean; // ventana de "Salida de audio" abierta
  midiConnected: boolean;
  midiPort: string | null;
  toast: string | null;
  avisoCentral: string | null; // aviso grande en el centro de la pantalla, se desvanece solo
  confirmBox: ConfirmBox | null; // aviso de confirmacion
  promptBox: { message: string; defaultValue: string; onSubmit: (v: string) => void } | null; // pedir un dato (sin bloquear el audio)
  downloaderOpen: boolean; // modal de descarga de YouTube abierto
  downloads: DownloadItem[]; // descargas en curso (en segundo plano)
  highlightTrack: string | null; // ruta de la cancion recien descargada (para titilar)
  analyzing: Set<string>; // rutas en analisis (para el spinner del boton)
  pedidas: Set<string>; // ids de YouTube ya pedidos en esta sesion (para marcar ✅ en el buscador)
  sync: SyncEstado | null; // estado de la sincronizacion (lo refresca useSync cada pocos segundos)
  syncOpen: boolean; // panel de Sync abierto
  syncAviso: boolean; // aviso "te falta sincronizar" (equipo, una vez por sesion)
  automix: EstadoAutomix;
  efectosSonando: Record<string, boolean>; // botones de efecto (drops) que estan sonando

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
  setSelectedArtist: (a: string | null) => void;
  setVistaCarpetas: (v: "generos" | "artistas") => void;
  setSettings: (s: Partial<Settings>) => void;
  setAudioSink: (name: string | null) => void;
  setAudioModalOpen: (v: boolean) => void;
  setMidi: (connected: boolean, port: string | null) => void;
  /** Ultimos avisos que salieron en pantalla (para el informe de fallos). */
  historialAvisos: string[];
  showToast: (msg: string) => void;
  showAvisoCentral: (msg: string) => void;
  askConfirm: (message: string, onYes: () => void, extra?: Omit<ConfirmBox, "message" | "onYes">) => void;
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
  setSync: (e: SyncEstado | null) => void;
  setSyncOpen: (v: boolean) => void;
  setSyncAviso: (v: boolean) => void;
  patchAutomix: (p: Partial<EstadoAutomix>) => void;
  setEfectoSonando: (id: string, on: boolean) => void;
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
  fx: { ...FX_NEUTRO },
});

// --- Persistencia sencilla en localStorage ---
const LS_KEY = "infiniity-dj-prefs";

interface Persisted {
  musicRoot: string | null;
  settings: Settings;
  masterVolume: number;
  audioSink: string | null;
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
        musicRoot: p.musicRoot ?? null,
        settings: { ...defaultSettings, ...(p.settings ?? {}) },
        masterVolume: p.masterVolume ?? 1,
        audioSink: p.audioSink ?? null,
      };
    }
  } catch {
    /* ignorar */
  }
  return {
    musicRoot: null,
    settings: defaultSettings,
    masterVolume: 1,
    audioSink: null,
  };
}

function savePrefs(s: AppStore) {
  const p: Persisted = {
    musicRoot: s.musicRoot,
    settings: s.settings,
    masterVolume: s.masterVolume,
    audioSink: s.audioSink,
  };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(p));
  } catch {
    /* ignorar */
  }
}

const initial = loadPrefs();

export const useStore = create<AppStore>((set, get) => ({
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
  selectedArtist: null,
  vistaCarpetas: "generos",
  settings: initial.settings,
  audioSink: initial.audioSink,
  audioModalOpen: false,
  midiConnected: false,
  midiPort: null,
  toast: null,
  avisoCentral: null,
  confirmBox: null,
  promptBox: null,
  downloaderOpen: false,
  downloads: [],
  highlightTrack: null,
  analyzing: new Set<string>(),
  pedidas: new Set<string>(),
  sync: null,
  syncOpen: false,
  syncAviso: false,
  automix: {
    encendido: false,
    cola: [],
    etiqueta: null,
    sonandoId: null,
    siguienteId: null,
    siguienteLista: false,
    faltan: null,
    mensaje: null,
    plegada: false,
  },
  efectosSonando: {},

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
  // Elegir carpeta quita el filtro de artista y viceversa: un filtro a la vez.
  setSelectedFolder: (p) => set({ selectedFolder: p, selectedArtist: null }),
  setSelectedArtist: (a) => set({ selectedArtist: a, selectedFolder: null }),
  setVistaCarpetas: (v) => set({ vistaCarpetas: v }),
  setSettings: (s) => {
    set((st) => ({ settings: { ...st.settings, ...s } }));
    savePrefs(get());
  },
  setAudioSink: (name) => {
    set({ audioSink: name });
    savePrefs(get());
  },
  historialAvisos: [],
  setAudioModalOpen: (v) => set({ audioModalOpen: v }),
  setMidi: (connected, port) => set({ midiConnected: connected, midiPort: port }),
  showToast: (msg) => {
    // Se guarda el historial para el informe de fallos: cuando desde otra PC
    // dicen "no suena", los avisos que salieron antes son la mitad de la
    // respuesta, y para cuando llega el mensaje ya se los llevo el viento.
    const previos = get().historialAvisos;
    const sello = new Date().toLocaleTimeString();
    set({ historialAvisos: [...previos, `${sello}  ${msg}`].slice(-40) });
    set({ toast: msg });
    window.setTimeout(() => {
      if (get().toast === msg) set({ toast: null });
    }, 3200);
  },
  showAvisoCentral: (msg) => {
    set({ avisoCentral: msg });
    window.setTimeout(() => {
      if (get().avisoCentral === msg) set({ avisoCentral: null });
    }, 2600);
  },
  askConfirm: (message, onYes, extra) => set({ confirmBox: { message, onYes, ...(extra ?? {}) } }),
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
  setSync: (e) => set({ sync: e }),
  setSyncOpen: (v) => set({ syncOpen: v }),
  setSyncAviso: (v) => set({ syncAviso: v }),
  patchAutomix: (p) => set((st) => ({ automix: { ...st.automix, ...p } })),
  setEfectoSonando: (id, on) => set((st) => ({ efectosSonando: { ...st.efectosSonando, [id]: on } })),
  setAnalyzing: (path, on) =>
    set((st) => {
      const next = new Set(st.analyzing);
      if (on) next.add(path);
      else next.delete(path);
      return { analyzing: next };
    }),
}));
