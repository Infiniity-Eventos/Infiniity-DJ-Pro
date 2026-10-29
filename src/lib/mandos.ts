import type { DeckId } from "../state/store";

/** Cuanto deja pasar el crossfader a un deck (la misma curva que AudioEngine.applyCrossfader). */
export function pasoCrossfader(id: DeckId, x: number): number {
  return id === "A" ? (x <= 0.5 ? 1 : 2 * (1 - x)) : x >= 0.5 ? 1 : 2 * x;
}

interface Mandos {
  decks: Record<DeckId, { isPlaying: boolean; volume: number }>;
  crossfader: number;
  masterVolume: number;
}

/**
 * Si hay musica sonando pero los MANDOS no la dejan salir, dice por que y que
 * hacer; si no, null. Un informe del 2026-10-28: el Deck A sonaba con el
 * crossfader del todo en B, el motor sacaba silencio y la app culpo a la
 * cabina («no está recibiendo el sonido») y rehizo la conexion dos veces.
 */
export function silencioPorMandos(s: Mandos): string | null {
  const sonando = (["A", "B"] as const).filter((id) => s.decks[id].isPlaying);
  if (sonando.length === 0) return null;
  if (s.masterVolume <= 0.001) return "El volumen general está en 0: súbelo para que se oiga.";
  const seOye = (id: DeckId) => s.decks[id].volume > 0.001 && pasoCrossfader(id, s.crossfader) > 0.001;
  if (sonando.some(seOye)) return null;
  const id = sonando[0];
  if (pasoCrossfader(id, s.crossfader) <= 0.001) {
    const otro = id === "A" ? "B" : "A";
    return `El Deck ${id} está sonando pero el crossfader está del lado ${otro}: muévelo hacia el ${id} para que se oiga.`;
  }
  return `El Deck ${id} está sonando con su volumen en 0: súbelo para que se oiga.`;
}
