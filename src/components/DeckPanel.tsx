import { useState } from "react";
import { engine } from "../audio/AudioEngine";
import { useStore, type DeckId } from "../state/store";
import { setManualBpm } from "../lib/tauri";
import { Vinyl } from "./Vinyl";
import { ProgressBar } from "./ProgressBar";
import { IconPrev, IconNext, IconPlay, IconPause } from "./Icons";

export function DeckPanel({ deckId }: { deckId: DeckId }) {
  const deck = useStore((s) => s.decks[deckId]);
  const patchDeck = useStore((s) => s.patchDeck);
  const showToast = useStore((s) => s.showToast);
  const library = useStore((s) => s.library);
  const [dragOver, setDragOver] = useState(false);

  const hasTrack = !!deck.trackPath;

  // Soltar una cancion (arrastrada desde la lista) la carga en este deck.
  const onDropTrack = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const path = e.dataTransfer.getData("text/plain");
    if (!path || !library) return;
    const t = library.tracks.find((x) => x.path === path);
    if (!t) return;
    const doLoad = () => {
      void engine.load(deckId, t.path, t.bpm, t.name);
      showToast(`Cargando en Deck ${deckId}: ${t.name}`);
    };
    // Aviso de seguridad: no cortar por accidente una cancion que esta sonando.
    if (deck.isPlaying) {
      useStore
        .getState()
        .askConfirm(
          `⚠️ El Deck ${deckId} está SONANDO ("${deck.trackName}"). ¿Reemplazarla por "${t.name}"?`,
          doLoad
        );
    } else {
      doLoad();
    }
  };

  const editBpm = () => {
    const path = deck.trackPath;
    if (!path) return;
    const current = deck.bpm ? String(deck.bpm) : "";
    // Cuadro propio (NO window.prompt): así la música NUNCA se pausa.
    useStore.getState().askPrompt(`BPM de "${deck.trackName}"`, current, async (input) => {
      const value = parseFloat(input.replace(",", "."));
      if (!isFinite(value) || value <= 0) {
        showToast("BPM invalido");
        return;
      }
      try {
        const meta = await setManualBpm(path, value);
        // Actualiza el tempo natural del motor (para la mezcla) y el estado.
        engine.setNaturalBpm(deckId, meta.bpm);
        patchDeck(deckId, { bpmManual: true });
        showToast("BPM corregido y guardado");
      } catch {
        showToast("No se pudo guardar el BPM");
      }
    });
  };

  return (
    <div
      className={`glass deck deck-${deckId.toLowerCase()} ${dragOver ? "drag-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDropTrack}
    >
      <div className="deck-header">
        <span className="deck-badge">Deck {deckId}</span>
        <span className="deck-bpm">
          {hasTrack ? (
            <button className="btn" style={{ padding: "4px 10px" }} onClick={editBpm}>
              <b>{deck.bpm ? deck.bpm.toFixed(1) : "—"}</b> BPM{deck.bpmManual ? " ✎" : ""}
            </button>
          ) : (
            <span style={{ opacity: 0.5 }}>sin cancion</span>
          )}
        </span>
      </div>

      <div className="deck-main">
        <Vinyl playing={deck.isPlaying} />
        <div className="deck-info">
          <div className="track-title">{deck.trackName ?? "Arrastra o carga una cancion"}</div>
          <div className="track-sub">
            {deck.loading
              ? "cargando..."
              : hasTrack
              ? deck.rate !== 1
                ? `velocidad ${(deck.rate * 100).toFixed(1)}%`
                : "listo"
              : ""}
          </div>
        </div>
      </div>

      <ProgressBar deckId={deckId} />

      <div className="deck-transport">
        <button
          className="btn btn-icon"
          disabled={!hasTrack}
          title="Retroceder 5s"
          onClick={() => engine.nudge(deckId, -5)}
        >
          <IconPrev />
        </button>
        <button
          className="btn btn-icon btn-accent"
          disabled={!hasTrack}
          title={deck.isPlaying ? "Pausar" : "Reproducir"}
          onClick={() => engine.togglePlay(deckId)}
        >
          {deck.isPlaying ? <IconPause /> : <IconPlay />}
        </button>
        <button
          className="btn btn-icon"
          disabled={!hasTrack}
          title="Adelantar 5s"
          onClick={() => engine.nudge(deckId, 5)}
        >
          <IconNext />
        </button>

        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--text-dim)" }}>Vol</span>
          <input
            className="vol-slider"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={deck.volume}
            onChange={(e) => engine.setVolume(deckId, parseFloat(e.target.value))}
          />
        </div>
      </div>
    </div>
  );
}
