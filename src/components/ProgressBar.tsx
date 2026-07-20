import { useEffect, useRef, useState } from "react";
import { engine } from "../audio/AudioEngine";
import { fmtTime } from "../lib/format";
import type { DeckId } from "../state/store";

/**
 * Barra de progreso de un deck. Lee la posicion directamente del motor de audio
 * mediante requestAnimationFrame (no pasa por el estado global, para no recargar
 * el resto de la interfaz).
 */
export function ProgressBar({ deckId }: { deckId: DeckId }) {
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setTime(engine.getPosition(deckId));
      setDur(engine.getDuration(deckId));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [deckId]);

  const frac = dur > 0 ? time / dur : 0;

  const onSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = barRef.current!.getBoundingClientRect();
    const f = (e.clientX - rect.left) / rect.width;
    engine.seekFraction(deckId, Math.min(1, Math.max(0, f)));
  };

  return (
    <div>
      <div className="progress" ref={barRef} onClick={onSeek}>
        <div className="fill" style={{ width: `${frac * 100}%` }} />
      </div>
      <div className="time-row">
        <span>{fmtTime(time)}</span>
        <span>-{fmtTime(Math.max(0, dur - time))}</span>
      </div>
    </div>
  );
}
