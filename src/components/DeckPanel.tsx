import { engine } from "../audio/AudioEngine";
import { useStore, type DeckId } from "../state/store";
import { setManualBpm } from "../lib/tauri";
import { Vinyl } from "./Vinyl";
import { ProgressBar } from "./ProgressBar";

export function DeckPanel({ deckId }: { deckId: DeckId }) {
  const deck = useStore((s) => s.decks[deckId]);
  const patchDeck = useStore((s) => s.patchDeck);
  const showToast = useStore((s) => s.showToast);

  const hasTrack = !!deck.trackPath;

  const editBpm = async () => {
    if (!deck.trackPath) return;
    const current = deck.bpm ? String(deck.bpm) : "";
    const input = window.prompt(
      `BPM de "${deck.trackName}"\n(escribe el valor correcto y guarda)`,
      current
    );
    if (input === null) return;
    const value = parseFloat(input.replace(",", "."));
    if (!isFinite(value) || value <= 0) {
      showToast("BPM invalido");
      return;
    }
    try {
      const meta = await setManualBpm(deck.trackPath, value);
      // Actualiza el tempo natural del motor (para la mezcla) y el estado.
      engine.setNaturalBpm(deckId, meta.bpm);
      patchDeck(deckId, { bpmManual: true });
      showToast("BPM corregido y guardado");
    } catch {
      showToast("No se pudo guardar el BPM");
    }
  };

  return (
    <div className={`glass deck deck-${deckId.toLowerCase()}`}>
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
          title="Retroceder"
          onClick={() => engine.nudge(deckId, -5)}
        >
          ⏪
        </button>
        <button
          className="btn btn-icon btn-accent"
          disabled={!hasTrack}
          title={deck.isPlaying ? "Pausar" : "Reproducir"}
          onClick={() => engine.togglePlay(deckId)}
        >
          {deck.isPlaying ? "⏸" : "▶"}
        </button>
        <button
          className="btn btn-icon"
          disabled={!hasTrack}
          title="Adelantar"
          onClick={() => engine.nudge(deckId, 5)}
        >
          ⏩
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
