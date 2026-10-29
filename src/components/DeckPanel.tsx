import { useEffect, useState } from "react";
import { engine } from "../audio/AudioEngine";
import { automixBloquea } from "../audio/Automix";
import { useStore, FX_NEUTRO, type DeckId, type FxKey } from "../state/store";
import { Perilla } from "./Perilla";

const PERILLAS: { key: FxKey; etiqueta: string; titulo: string }[] = [
  { key: "graves", etiqueta: "Graves", titulo: "Graves: al centro no cambia nada; abajo los quita, arriba los sube" },
  { key: "medios", etiqueta: "Medios", titulo: "Medios: al centro no cambia nada" },
  { key: "agudos", etiqueta: "Agudos", titulo: "Agudos: al centro no cambia nada" },
  { key: "filtro", etiqueta: "Filtro", titulo: "Filtro: al centro nada; a la izquierda va apagando los agudos, a la derecha los graves" },
  { key: "voz", etiqueta: "Voz", titulo: "Bajar la voz: a 0 no hace nada; cuanto mas arriba, menos voz (funciona mejor en canciones estereo normales)" },
];
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

  // Segundos de carga, para que el aviso se vea vivo (regla 9: una espera sin
  // señales parece un cuelgue). Un tic por segundo, nada en bucle (theme.css).
  const [segCarga, setSegCarga] = useState(0);
  useEffect(() => {
    if (!deck.loading) return;
    const tic = () => setSegCarga(Math.floor((Date.now() - deck.cargaDesde) / 1000));
    tic();
    const t = window.setInterval(tic, 1000);
    return () => window.clearInterval(t);
  }, [deck.loading, deck.cargaDesde]);

  // Soltar una cancion (arrastrada desde la lista) la carga en este deck.
  const onDropTrack = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (automixBloquea()) return;
    const path = e.dataTransfer.getData("text/plain");
    if (!path || !library) return;
    const t = library.tracks.find((x) => x.path === path);
    if (!t) return;
    const doLoad = () => {
      void engine.load(deckId, t.path, t.bpm, t.name, t.gain_db);
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
      {/* Antes era un «cargando...» chiquito y el equipo le daba play o MEZCLAR
          sin saber que la cancion aun no estaba lista. Deja pasar los clics
          (pointer-events: none): soltar otra cancion encima sigue funcionando,
          y el play explica por que todavia no suena. */}
      {deck.loading && (
        <div className="deck-cargando" role="status">
          <div className="deck-cargando-titulo">CARGANDO...</div>
          <div className="deck-cargando-nombre">{deck.trackName}</div>
          <div className="deck-cargando-texto">
            Todavía no suena. Espera unos segundos: {deck.cargaPaso}
            {segCarga > 0 ? ` (${segCarga} s)` : ""}
          </div>
        </div>
      )}
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
          {/* Perillas de efectos: se pueden tocar aunque el automix este encendido (S8). */}
          <div className="deck-fx">
            {PERILLAS.map((p) => (
              <Perilla
                key={p.key}
                valor={deck.fx[p.key]}
                neutro={FX_NEUTRO[p.key]}
                etiqueta={p.etiqueta}
                titulo={p.titulo}
                onChange={(v) => engine.setFx(deckId, p.key, v)}
              />
            ))}
          </div>
        </div>
      </div>

      <ProgressBar deckId={deckId} />

      <div className="deck-transport">
        <button
          className="btn btn-icon"
          disabled={!hasTrack}
          title="Retroceder 5s"
          onClick={() => !automixBloquea() && engine.nudge(deckId, -5)}
        >
          <IconPrev />
        </button>
        <button
          className="btn btn-icon btn-accent"
          disabled={!hasTrack}
          title={deck.isPlaying ? "Pausar" : "Reproducir"}
          onClick={() => !automixBloquea() && engine.togglePlay(deckId)}
        >
          {deck.isPlaying ? <IconPause /> : <IconPlay />}
        </button>
        <button
          className="btn btn-icon"
          disabled={!hasTrack}
          title="Adelantar 5s"
          onClick={() => !automixBloquea() && engine.nudge(deckId, 5)}
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
            onChange={(e) => !automixBloquea() && engine.setVolume(deckId, parseFloat(e.target.value))}
          />
        </div>
      </div>
    </div>
  );
}
