import { useMemo, useState } from "react";
import { engine } from "../audio/AudioEngine";
import { reloadLibrary } from "../lib/library";
import { useStore, type DeckId } from "../state/store";
import { analyzeBpm, type TrackInfo } from "../lib/tauri";
import { fmtTime } from "../lib/format";

// Icono de arrastre: una imagen precargada (SVG). Usar una <img> lista de
// antemano es lo mas compatible con WebKitGTK; asi al arrastrar se ve solo una
// nota musical morada, no un "fantasma" de toda la interfaz.
const DRAG_ICON = new Image();
DRAG_ICON.src =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="46" height="46">' +
      '<circle cx="23" cy="23" r="21" fill="#7c3aed" stroke="#c084fc" stroke-width="2"/>' +
      '<text x="23" y="32" font-size="24" text-anchor="middle" fill="#ffffff">♪</text>' +
      "</svg>"
  );

export function TrackList() {
  const library = useStore((s) => s.library);
  const search = useStore((s) => s.search);
  const setSearch = useStore((s) => s.setSearch);
  const selectedFolder = useStore((s) => s.selectedFolder);
  const selectedArtist = useStore((s) => s.selectedArtist);
  const highlightTrack = useStore((s) => s.highlightTrack);
  const analyzing = useStore((s) => s.analyzing);
  const setAnalyzing = useStore((s) => s.setAnalyzing);
  const setLibrary = useStore((s) => s.setLibrary);
  const showToast = useStore((s) => s.showToast);
  const libraryLoading = useStore((s) => s.libraryLoading);

  const tracks = useMemo(() => {
    if (!library) return [];
    const q = search.trim().toLowerCase();
    return library.tracks.filter((t) => {
      const inFolder = !selectedFolder || t.folder.startsWith(selectedFolder);
      const ofArtist = !selectedArtist || (t.artist ?? "") === selectedArtist;
      const matches =
        !q ||
        t.name.toLowerCase().includes(q) ||
        (t.title ?? "").toLowerCase().includes(q) ||
        (t.artist ?? "").toLowerCase().includes(q);
      return inFolder && ofArtist && matches;
    });
  }, [library, search, selectedFolder, selectedArtist]);

  const loadToDeck = (deckId: DeckId, t: TrackInfo) => {
    const doLoad = () => {
      void engine.load(deckId, t.path, t.bpm, t.name, t.gain_db);
      showToast(`Cargando en Deck ${deckId}: ${t.name}`);
    };
    // Aviso de seguridad: no cortar por accidente una cancion que esta sonando.
    const target = useStore.getState().decks[deckId];
    if (target.isPlaying) {
      useStore
        .getState()
        .askConfirm(
          `⚠️ El Deck ${deckId} está SONANDO ("${target.trackName}"). ¿Reemplazarla por "${t.name}"?`,
          doLoad
        );
    } else {
      doLoad();
    }
  };

  const updateTrackBpm = (path: string, bpm: number | null, duration: number | null) => {
    const lib = useStore.getState().library;
    if (!lib) return;
    setLibrary({
      ...lib,
      tracks: lib.tracks.map((x) =>
        x.path === path ? { ...x, bpm, duration } : x
      ),
    });
  };

  const analyzeOne = async (t: TrackInfo) => {
    if (analyzing.has(t.path)) return;
    setAnalyzing(t.path, true);
    try {
      const meta = await analyzeBpm(t.path);
      updateTrackBpm(t.path, meta.bpm, meta.duration);
      // Si esta cargada en un deck, refresca su tempo natural.
      const decks = useStore.getState().decks;
      (["A", "B"] as DeckId[]).forEach((id) => {
        if (decks[id].trackPath === t.path) engine.setNaturalBpm(id, meta.bpm);
      });
    } catch {
      showToast(`No se pudo analizar: ${t.name}`);
    } finally {
      setAnalyzing(t.path, false);
    }
  };

  // "Actualizar lista": vuelve a leer la carpeta (por si llegaron canciones
  // por Sync o se copiaron a mano) y analiza el BPM de las que no lo tengan.
  const [actualizando, setActualizando] = useState(false);
  const analyzeAll = async () => {
    if (actualizando) return;
    setActualizando(true);
    try {
      await reloadLibrary();
      // Lista FRESCA del store, no la copia vieja de este render.
      const lib = useStore.getState().library;
      const todas = lib?.tracks ?? [];
      const pending = todas.filter((t) => t.bpm === null);
      if (pending.length === 0) {
        showToast(`Lista actualizada: ${todas.length} canciones, todas con BPM`);
        return;
      }
      showToast(`Lista actualizada: ${todas.length} canciones. Analizando ${pending.length} sin BPM...`);
      // Una a la vez: no satura la CPU en equipos de gama baja.
      for (const t of pending) {
        await analyzeOne(t);
      }
      showToast("Analisis terminado");
    } finally {
      setActualizando(false);
    }
  };

  return (
    <div className="glass tracklist">
      <div className="search-bar">
        <input
          placeholder="Buscar cancion por nombre..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          className="btn"
          onClick={analyzeAll}
          disabled={actualizando}
          title="Volver a leer la carpeta y analizar el BPM de las canciones que no lo tengan"
        >
          {actualizando ? "Actualizando..." : "Actualizar lista"}
        </button>
      </div>

      <div className="track-rows">
        {libraryLoading && <div style={{ padding: 16, color: "var(--text-dim)" }}>Leyendo carpeta...</div>}
        {!libraryLoading && tracks.length === 0 && (
          <div style={{ padding: 16, color: "var(--text-dim)" }}>
            No hay canciones aqui. Arrastra MP3/WAV a tu carpeta de musica.
          </div>
        )}
        {tracks.map((t) => (
          <div
            key={t.path}
            className={`track-row ${t.path === highlightTrack ? "just-downloaded" : ""}`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", t.path);
              e.dataTransfer.effectAllowed = "copy";
              // Imagen de arrastre: solo un icono de musica (imagen precargada).
              try {
                e.dataTransfer.setDragImage(DRAG_ICON, 23, 23);
              } catch {
                /* algunos motores no lo soportan; no pasa nada */
              }
            }}
            onDoubleClick={() => loadToDeck("A", t)}
          >
            <span className="t-name" title={t.name}>
              {t.title ?? t.name}
              {t.artist && <span className="t-artist"> · {t.artist}</span>}
            </span>
            <span
              className={`t-bpm ${t.bpm === null ? "unknown" : ""}`}
              onClick={() => analyzeOne(t)}
              style={{ cursor: "pointer" }}
              title={t.bpm === null ? "Clic para analizar" : "BPM"}
            >
              {analyzing.has(t.path) ? "..." : t.bpm !== null ? t.bpm.toFixed(0) : "?"}
            </span>
            <span style={{ color: "var(--text-dim)", textAlign: "right" }}>
              {t.duration ? fmtTime(t.duration) : ""}
            </span>
            <span className="t-actions">
              <button className="btn load-btn" title="Cargar en Deck A" onClick={() => loadToDeck("A", t)}>
                A
              </button>
              <button className="btn load-btn" title="Cargar en Deck B" onClick={() => loadToDeck("B", t)}>
                B
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
