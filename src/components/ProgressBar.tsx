import { useEffect, useRef } from "react";
import { engine } from "../audio/AudioEngine";
import { fmtTime } from "../lib/format";
import { useStore, type DeckId } from "../state/store";

/**
 * Barra de progreso de un deck.
 *
 * OPTIMIZADO PARA GAMA BAJA: NO usa requestAnimationFrame (que mantiene el bucle
 * de repintado a 60fps y, sin GPU, redibuja toda la ventana por software = CPU
 * altísimo). En su lugar usa un temporizador a ~4fps que escribe directo en el
 * DOM. Y SOLO mientras la canción suena. Así el hilo gráfico queda casi libre.
 */
export function ProgressBar({ deckId }: { deckId: DeckId }) {
  const isPlaying = useStore((s) => s.decks[deckId].isPlaying);
  const barRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const curRef = useRef<HTMLSpanElement>(null);
  const remRef = useRef<HTMLSpanElement>(null);

  const paint = () => {
    const t = engine.getPosition(deckId);
    const d = engine.getDuration(deckId);
    const frac = d > 0 ? t / d : 0;
    if (fillRef.current) fillRef.current.style.width = `${frac * 100}%`;
    if (curRef.current) curRef.current.textContent = fmtTime(t);
    if (remRef.current) remRef.current.textContent = `-${fmtTime(Math.max(0, d - t))}`;
  };

  useEffect(() => {
    paint(); // pintar el estado actual (al montar / cambiar de cancion / pausar)
    if (!isPlaying) return; // en pausa no gastamos nada
    // ~4 fps con setInterval: suficiente para una barra y NO fuerza el bucle de
    // render a 60fps (a diferencia de requestAnimationFrame).
    const id = window.setInterval(paint, 250);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId, isPlaying]);

  const onSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = barRef.current!.getBoundingClientRect();
    const f = (e.clientX - rect.left) / rect.width;
    engine.seekFraction(deckId, Math.min(1, Math.max(0, f)));
    paint();
  };

  return (
    <div>
      <div className="progress" ref={barRef} onClick={onSeek}>
        <div className="fill" ref={fillRef} style={{ width: "0%" }} />
      </div>
      <div className="time-row">
        <span ref={curRef}>0:00</span>
        <span ref={remRef}>-0:00</span>
      </div>
    </div>
  );
}
