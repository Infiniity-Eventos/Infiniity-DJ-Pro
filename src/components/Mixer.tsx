import { useEffect, useRef } from "react";
import { engine } from "../audio/AudioEngine";
import { automixBloquea } from "../audio/Automix";
import { useStore } from "../state/store";

/**
 * Botones de efecto (drops) que suenan encima de la musica. El archivo viaja
 * dentro del programa (public/efectos). Para agregar otro: un archivo mas y
 * una linea mas aqui.
 */
const EFECTOS: { id: string; nombre: string; url: string; titulo: string }[] = [
  {
    id: "infiniity",
    nombre: "Infiniity",
    url: "/efectos/infiniity-eventos.mp3",
    titulo: "Suena «Mezclando Infiniity Eventos» encima de la musica (7 s). Vuelve a pulsar para cortarlo.",
  },
];

export function Mixer() {
  const crossfader = useStore((s) => s.crossfader);
  const masterVolume = useStore((s) => s.masterVolume);
  const autoMixing = useStore((s) => s.autoMixing);
  const decks = useStore((s) => s.decks);
  const showToast = useStore((s) => s.showToast);
  const automixOn = useStore((s) => s.automix.encendido);
  const efectosSonando = useStore((s) => s.efectosSonando);

  // El slider vertical va girado: su ANCHO tiene que ser el ALTO de la columna.
  const trackRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      el.style.setProperty("--largo", `${el.clientHeight}px`);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const canMix = !!decks.A.trackPath && !!decks.B.trackPath;

  const doMix = async () => {
    if (automixBloquea()) return;
    if (autoMixing) {
      engine.cancelMix();
      showToast("Mezcla cancelada");
      return;
    }
    // Mezclamos DESDE el deck que se escucha hacia el otro.
    const source = crossfader <= 0.5 ? "A" : "B";
    const target = source === "A" ? "B" : "A";
    const res = await engine.autoMix(source, target);
    if (!res.ok && res.reason) showToast(res.reason);
    else if (res.ok) showToast(`Mezcla ${source} → ${target} lista`);
  };

  return (
    <div className="glass glass-strong mixer">
      <button
        className={`btn ${autoMixing ? "btn" : "btn-accent"} mix-btn`}
        disabled={(!canMix && !autoMixing) || automixOn}
        onClick={doMix}
      >
        {autoMixing ? (automixOn ? "AUTOMIX" : "CANCELAR") : "MEZCLAR"}
        <span className="mix-sub">
          {automixOn ? "lo maneja el automix" : autoMixing ? "mezcla en curso..." : "transición automática"}
        </span>
      </button>

      <div className="mixer-medio">
        <Canal deckId="A" />
        {/* Vertical a proposito: arriba = mas volumen, y no se confunde con el
            crossfader, que es horizontal. */}
        <div className="master-block" title="Volumen general">
          <span className="master-value">{Math.round(masterVolume * 100)}%</span>
          <div className="master-track" ref={trackRef}>
            <input
              className="vol-slider master-slider"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={masterVolume}
              onChange={(e) => engine.setMasterVolume(parseFloat(e.target.value))}
              aria-label="Volumen general"
            />
          </div>
          <span className="master-label">VOL</span>
        </div>
        <Canal deckId="B" />
      </div>

      <div className="efectos-block">
        {EFECTOS.map((e) => (
          <button
            key={e.id}
            className={`btn efecto-btn ${efectosSonando[e.id] ? "sonando" : ""}`}
            title={e.titulo}
            onClick={() => void engine.dispararEfecto(e.id, e.url)}
          >
            <span className="efecto-icono">{efectosSonando[e.id] ? "■" : "▶"}</span>
            {e.nombre}
          </button>
        ))}
      </div>

      <div className="crossfader-block">
        <span className="xf-letra xf-a">A</span>
        <input
          className="vol-slider"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={crossfader}
          onChange={(e) => !automixBloquea() && engine.setCrossfader(parseFloat(e.target.value))}
          onDoubleClick={() => !automixBloquea() && engine.setCrossfader(0.5)}
          onMouseDown={() => automixOn && automixBloquea()}
          title={automixOn ? "Lo mueve el automix" : "Crossfader. Doble clic para volver al centro"}
          aria-label="Crossfader"
        />
        <span className="xf-letra xf-b">B</span>
      </div>
    </div>
  );
}

/**
 * Columna de cada deck: cuanto SUENA (su volumen por el crossfader, con el
 * mismo corte que applyCrossfader en AudioEngine). NO es un medidor de audio:
 * medir la señal obliga a leerla y repintar sin parar, y la app vive en bajo
 * consumo. Solo cambia cuando cambia el volumen o el crossfader (durante una
 * mezcla, a la cadencia con que el motor actualiza el crossfader).
 */
function Canal({ deckId }: { deckId: "A" | "B" }) {
  const deck = useStore((s) => s.decks[deckId]);
  const x = useStore((s) => s.crossfader);
  const corte = deckId === "A" ? (x <= 0.5 ? 1 : 2 * (1 - x)) : x >= 0.5 ? 1 : 2 * x;
  const nivel = deck.trackPath ? deck.volume * corte : 0;
  return (
    <div
      className={`canal canal-${deckId.toLowerCase()} ${deck.isPlaying ? "" : "quieto"}`}
      title={`Cuánto suena el Deck ${deckId}: su volumen por el crossfader (${Math.round(nivel * 100)}%)`}
    >
      <span className="canal-letra">{deckId}</span>
      <div className="canal-barra">
        <div className="canal-nivel" style={{ height: `${Math.round(nivel * 100)}%` }} />
      </div>
    </div>
  );
}
