/**
 * "Mejor ruta" para el automix de una carpeta: ordena las canciones para que
 * cada cambio de ritmo sea lo mas chico posible, como hace un DJ (sube y baja
 * el tempo poco a poco, nunca de golpe).
 *
 * Reglas (guia Automix, D13 y S6):
 *  - Empieza por la cancion mas parecida en ritmo a la que esta sonando (o,
 *    si no suena nada, la de ritmo mas "central" de la carpeta).
 *  - Cada paso elige la de ritmo mas cercano que falte, contando dobles y
 *    mitades como el mismo ritmo (95 ≈ 190).
 *  - Evita repetir el artista de la cancion anterior cuando hay otra candidata
 *    con un salto parecido.
 *  - Las canciones sin BPM van al final, en el orden en que estaban.
 */

import { partirArtistas } from "../components/FolderTree";
import type { TrackInfo } from "./tauri";

/** Distancia entre dos ritmos: |log(a/b)| tomando el multiplo (x0.5, x1, x2) mas cercano. */
export function distanciaRitmo(a: number, b: number): number {
  let mejor = Infinity;
  for (const k of [0.5, 1, 2]) {
    const d = Math.abs(Math.log(a / (b * k)));
    if (d < mejor) mejor = d;
  }
  return mejor;
}

/** Dos canciones comparten artista si alguno de sus artistas coincide. */
function mismoArtista(a: TrackInfo, b: TrackInfo): boolean {
  const xa = partirArtistas(a.artist);
  const xb = partirArtistas(b.artist);
  return xa.some((x) => xb.includes(x));
}

/**
 * Ordena `pistas` para el automix. `bpmActual` es el ritmo de la cancion que
 * esta sonando (null si no suena nada); `artistaActual` sirve para no repetir
 * de entrada al mismo artista que ya suena.
 */
export function ordenarRuta(
  pistas: TrackInfo[],
  bpmActual: number | null,
  actual: TrackInfo | null
): TrackInfo[] {
  const conBpm = pistas.filter((t) => t.bpm !== null && t.bpm > 0);
  const sinBpm = pistas.filter((t) => !(t.bpm !== null && t.bpm > 0));
  if (conBpm.length === 0) return [...sinBpm];

  // Punto de partida: el ritmo de lo que suena. Si no suena nada, se arranca
  // por la mas lenta y se va subiendo (asi la ruta no tiene que "bajar de
  // golpe" al terminar de subir, como pasaria arrancando por la mitad).
  let arranque: number;
  if (bpmActual && bpmActual > 0) {
    arranque = bpmActual;
  } else {
    arranque = Math.min(...conBpm.map((t) => t.bpm!)) - 0.01;
  }

  const pendientes = new Set(conBpm);
  const ruta: TrackInfo[] = [];
  let bpmPrev = arranque;
  let prev: TrackInfo | null = actual;

  // Un salto "parecido" al mejor: hasta 2 % mas de distancia en ritmo.
  const TOLERANCIA = Math.log(1.02);

  while (pendientes.size > 0) {
    let mejor: TrackInfo | null = null;
    let mejorD = Infinity;
    for (const t of pendientes) {
      const d = distanciaRitmo(t.bpm!, bpmPrev);
      if (d < mejorD) {
        mejorD = d;
        mejor = t;
      }
    }
    if (!mejor) break;
    // Si la mejor repite artista, busca otra con un salto casi igual.
    if (prev && mismoArtista(mejor, prev)) {
      let alterna: TrackInfo | null = null;
      let alternaD = Infinity;
      for (const t of pendientes) {
        if (t === mejor || mismoArtista(t, prev)) continue;
        const d = distanciaRitmo(t.bpm!, bpmPrev);
        if (d <= mejorD + TOLERANCIA && d < alternaD) {
          alternaD = d;
          alterna = t;
        }
      }
      if (alterna) mejor = alterna;
    }
    ruta.push(mejor);
    pendientes.delete(mejor);
    bpmPrev = mejor.bpm!;
    prev = mejor;
  }
  return [...ruta, ...sinBpm];
}
