/**
 * Analisis del audio YA DECODIFICADO de una cancion (AudioBuffer), para que
 * el automix sepa donde empezar, donde entrar y como alinear los golpes.
 *
 * POR QUE AQUI Y NO EN RUST: al cargar una cancion en un deck ya tenemos
 * todas sus muestras en memoria (ver AudioEngine). Sacar de ahi los silencios,
 * la caida de energia del final y el primer golpe cuesta milisegundos (igual
 * que la auto-nivelacion RMS que ya existia). Y la fase del pulso de la
 * cancion que SUENA se mide en el momento de la mezcla, sobre el audio real
 * de ese instante: ningun valor guardado es mas exacto que eso (un BPM entero,
 * 133 en vez de 132.94, acumula un cuarto de golpe de error en 3 minutos).
 *
 * Todo se calcula sobre una MEZCLA A MONO con saltos (stride) para no castigar
 * la CPU en los portatiles de gama baja.
 */

export interface AnalisisCancion {
  /** Segundos de silencio al inicio (donde de verdad empieza el sonido). */
  silencioInicio: number;
  /** Segundos de silencio al final (desde donde ya no suena nada). */
  silencioFin: number;
  /** Instante (s) donde el final "se apaga" (cae la energia). Si no hay cola floja: null. */
  inicioOutro: number | null;
  /** Instante (s) del primer golpe fuerte (ya pasado el silencio inicial). null si no hay BPM. */
  primerGolpe: number | null;
}

/**
 * Silencio = muy por debajo del nivel del cuerpo de la cancion (no un valor
 * fijo): hay MP3 masterizados bajitos (cuerpo a -37 dB) con intros de guitarra
 * a -47 dB que un umbral fijo de -40 dB se comeria. Por eso el umbral es
 * RELATIVO al cuerpo, con un piso absoluto de -70 dBFS.
 */
const REL_SILENCIO_INICIO = Math.pow(10, -35 / 20); // -35 dB bajo el cuerpo: solo silencio de verdad
const REL_SILENCIO_FIN = Math.pow(10, -28 / 20); // -28 dB: la cola de un fade ya no se oye en una fiesta
const PISO_SILENCIO = Math.pow(10, -70 / 20);
/** Cuanto audio (s) mirar como maximo al inicio/final para los silencios. */
const MAX_SILENCIO = 30;
/** Fraccion de la energia del cuerpo por debajo de la cual el final cuenta como "cola floja" (-4.4 dB). */
const FRACCION_OUTRO = 0.6;
/** Como maximo cuantos segundos de cola floja reconocemos (lo demas es la cancion). */
const MAX_OUTRO = 30;
/** Segundos de audio que se miran para encontrar el primer golpe. */
const VENTANA_PRIMER_GOLPE = 16;

/** RMS de una ventana [a, b) de muestras, mezclando canales, con salto `stride`. */
function rmsVentana(buffer: AudioBuffer, a: number, b: number, stride: number): number {
  const chs = buffer.numberOfChannels;
  let sum = 0;
  let n = 0;
  for (let c = 0; c < chs; c++) {
    const d = buffer.getChannelData(c);
    for (let i = a; i < b; i += stride) {
      const s = d[i];
      sum += s * s;
      n++;
    }
  }
  return n > 0 ? Math.sqrt(sum / n) : 0;
}

/** Energia por ventanas de 1 s (con salto 16: ~2.700 muestras por segundo, suficiente). */
function envolvente1s(buffer: AudioBuffer): Float32Array {
  const ventana = Math.floor(buffer.sampleRate);
  const n = Math.floor(buffer.length / ventana);
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) e[i] = rmsVentana(buffer, i * ventana, (i + 1) * ventana, 16);
  return e;
}

/** Nivel tipico del cuerpo de la cancion: mediana de la energia del tramo central. */
function nivelCuerpo(envolvente: Float32Array): number {
  const n = envolvente.length;
  const centro = Array.from(envolvente.subarray(Math.floor(n * 0.2), Math.max(Math.floor(n * 0.2) + 1, Math.floor(n * 0.8)))).sort((x, y) => x - y);
  return centro.length ? centro[Math.floor(centro.length / 2)] : 0;
}

function silencioInicial(buffer: AudioBuffer, umbral: number): number {
  const sr = buffer.sampleRate;
  const ventana = Math.floor(sr * 0.05);
  const fin = Math.min(buffer.length, Math.floor(sr * MAX_SILENCIO));
  for (let a = 0; a + ventana <= fin; a += ventana) {
    if (rmsVentana(buffer, a, a + ventana, 4) > umbral) return a / sr;
  }
  return 0; // todo silencio en los primeros 30 s: no recortamos nada
}

function silencioFinal(buffer: AudioBuffer, umbral: number): number {
  const sr = buffer.sampleRate;
  const ventana = Math.floor(sr * 0.05);
  const minimo = Math.max(0, buffer.length - Math.floor(sr * MAX_SILENCIO));
  for (let b = buffer.length; b - ventana >= minimo; b -= ventana) {
    if (rmsVentana(buffer, b - ventana, b, 4) > umbral) return (buffer.length - b) / sr;
  }
  return 0;
}

/**
 * Donde empieza la "cola floja": el ultimo tramo donde la energia cae por
 * debajo del 60 % del nivel del cuerpo y ya no vuelve a subir. Si ese tramo
 * es mas largo que MAX_OUTRO, se devuelve el instante que deja exactamente
 * MAX_OUTRO s de cola.
 */
function inicioOutro(buffer: AudioBuffer, energia: Float32Array, cuerpo: number, silencioFin: number): number | null {
  const nVent = energia.length;
  if (nVent < 20 || cuerpo <= 0) return null; // menos de 20 s: no hay cola que recortar
  const finUtil = buffer.duration - silencioFin;
  const umbral = cuerpo * FRACCION_OUTRO;
  // Desde el final (sin el silencio) hacia atras: ¿hasta donde se mantiene flojo?
  let i = Math.min(nVent - 1, Math.floor(finUtil) - 1);
  while (i >= 0 && energia[i] < umbral) i--;
  const flojoDesde = i + 1; // en segundos
  const colaSeg = finUtil - flojoDesde;
  if (colaSeg < 3) return null; // un final seco: no hay cola que comerse
  return Math.max(flojoDesde, finUtil - MAX_OUTRO);
}

/**
 * Envolvente de ataques (onsets) de un tramo [desde, hasta) en segundos:
 * energia por cuadros de `hop` muestras y solo sus SUBIDAS. Es la misma idea
 * que usa bpm.rs en Rust para el tempo.
 */
function envolventeAtaques(
  buffer: AudioBuffer,
  desde: number,
  hasta: number,
  hop: number
): { ataques: Float32Array; inicioMuestra: number } {
  const sr = buffer.sampleRate;
  const a0 = Math.max(0, Math.floor(desde * sr));
  const a1 = Math.min(buffer.length, Math.floor(hasta * sr));
  const n = Math.max(0, Math.floor((a1 - a0) / hop));
  const energia = new Float32Array(n);
  const chs = buffer.numberOfChannels;
  for (let c = 0; c < chs; c++) {
    const d = buffer.getChannelData(c);
    for (let f = 0; f < n; f++) {
      const b = a0 + f * hop;
      let s = 0;
      for (let i = b; i < b + hop; i += 2) {
        const v = d[i];
        s += v * v;
      }
      energia[f] += s;
    }
  }
  const ataques = new Float32Array(n);
  let prev = 0;
  for (let f = 0; f < n; f++) {
    const e = Math.sqrt(energia[f]);
    const dif = e - prev;
    ataques[f] = dif > 0 ? dif : 0;
    prev = e;
  }
  return { ataques, inicioMuestra: a0 };
}

/**
 * Fase del pulso dentro de un tramo: devuelve el instante (s, en tiempo del
 * buffer) de un golpe dentro del tramo, con el periodo del BPM dado. Se prueba
 * cada desfase posible y gana el que mas ataques acumula sobre la rejilla
 * (filtro peine). Devuelve null si el tramo no tiene suficiente audio.
 */
export function golpeEnTramo(buffer: AudioBuffer, bpm: number, desde: number, hasta: number): number | null {
  if (!(bpm > 0)) return null;
  const sr = buffer.sampleRate;
  const hop = 256; // ~5.8 ms de resolucion a 44.1 kHz
  const { ataques, inicioMuestra } = envolventeAtaques(buffer, desde, hasta, hop);
  const periodo = (60 / bpm) * sr / hop; // en cuadros
  const n = ataques.length;
  if (n < periodo * 2) return null;
  const P = Math.floor(periodo);
  let mejorFase = 0;
  let mejor = -1;
  const puntuaciones = new Float32Array(P);
  for (let fase = 0; fase < P; fase++) {
    let s = 0;
    for (let t = fase; t < n; t += periodo) {
      const i = Math.floor(t);
      const frac = t - i;
      s += ataques[i] * (1 - frac) + (i + 1 < n ? ataques[i + 1] * frac : 0);
    }
    puntuaciones[fase] = s;
    if (s > mejor) {
      mejor = s;
      mejorFase = fase;
    }
  }
  if (mejor <= 0) return null;
  // Afinado sub-cuadro con una parabola entre los vecinos.
  const l = puntuaciones[(mejorFase - 1 + P) % P];
  const r = puntuaciones[(mejorFase + 1) % P];
  const denom = l - 2 * mejor + r;
  const ajuste = denom !== 0 ? (0.5 * (l - r)) / denom : 0;
  const faseCuadros = mejorFase + Math.max(-0.5, Math.min(0.5, ajuste));
  return (inicioMuestra + faseCuadros * hop) / sr;
}

/** Analisis completo al cargar. */
export function analizarCancion(buffer: AudioBuffer, bpm: number | null): AnalisisCancion {
  const energia = envolvente1s(buffer);
  const cuerpo = nivelCuerpo(energia);
  const silencioInicio = silencioInicial(buffer, Math.max(PISO_SILENCIO, cuerpo * REL_SILENCIO_INICIO));
  const silencioFin = silencioFinal(buffer, Math.max(PISO_SILENCIO, cuerpo * REL_SILENCIO_FIN));
  const outro = inicioOutro(buffer, energia, cuerpo, silencioFin);
  let primerGolpe: number | null = null;
  if (bpm && bpm > 0) {
    const golpe = golpeEnTramo(buffer, bpm, silencioInicio, silencioInicio + VENTANA_PRIMER_GOLPE);
    if (golpe !== null) {
      // El golpe encontrado puede ser el 3º o 4º de la rejilla; retrocedemos
      // hasta el primero que quede DESPUES del silencio inicial.
      const periodo = 60 / bpm;
      let g = golpe;
      while (g - periodo >= silencioInicio) g -= periodo;
      primerGolpe = g;
    }
  }
  return { silencioInicio, silencioFin, inicioOutro: outro, primerGolpe };
}

/**
 * Siguiente golpe de la cancion DESPUES del instante `pos` (s, tiempo del
 * buffer), midiendo la fase sobre el audio real alrededor de `pos`.
 * Si no se puede medir, devuelve null (se mezcla sin alinear).
 */
export function siguienteGolpe(buffer: AudioBuffer, bpm: number, pos: number): number | null {
  const periodo = 60 / bpm;
  const desde = Math.max(0, pos - 8);
  const hasta = Math.min(buffer.duration, pos + 1);
  const g = golpeEnTramo(buffer, bpm, desde, hasta);
  if (g === null) return null;
  let t = g;
  while (t < pos) t += periodo;
  while (t - periodo >= pos) t -= periodo;
  return t;
}
