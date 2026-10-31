/**
 * AUDÍFONOS DE LOS DECKS (guía .mega-cuestionario/Guía para Audífonos.md).
 *
 * Con la barra se elige lo que oye el público; con el botón de audífonos de
 * cada deck, lo que oye el DJ: ese deck completo, sin importar la barra ni su
 * volumen, para saber cuándo hacer el cambio. El sonido sale del mismo motor
 * (AudioEngine copia los decks antes de la barra) y Rust lo toca en la salida
 * de los audífonos (src-tauri/src/cue.rs). Lo que oye el público no cambia.
 *
 * Este archivo junta las piezas: busca la salida de los audífonos, la abre,
 * le pasa los trozos y, si algo falla, lo dice en pantalla (regla 4).
 */
import { engine } from "../audio/AudioEngine";
import { useStore, type DeckId } from "../state/store";
import {
  cueAbrir,
  cueCerrar,
  cueDatos,
  cueEstado,
  isTauri,
  preescuchaOpciones,
  type OpcionesPreescucha,
} from "./tauri";

/** Misma salida recordada que la pre-escucha de la lista (Preescucha.tsx). */
const CLAVE_SALIDA = "infiniity-dj-audifonos";

function salidaRecordada(): string | null {
  try {
    return localStorage.getItem(CLAVE_SALIDA);
  } catch (e) {
    console.warn("[audifonos] no se pudo leer la salida recordada", e);
    return null;
  }
}
export function recordarSalidaAudifonos(sink: string) {
  try {
    localStorage.setItem(CLAVE_SALIDA, sink);
  } catch (e) {
    console.warn("[audifonos] no se pudo recordar la salida", e);
  }
}

/** La de audífonos si se ve enchufada; si no, la recordada; si no, la primera. */
export function elegirSalidaAudifonos(o: OpcionesPreescucha): string | null {
  if (o.salidas.length === 0) return null;
  const rec = salidaRecordada();
  if (rec && o.salidas.some((s) => s.name === rec)) return rec;
  return (o.salidas.find((s) => s.audifonos === true) ?? o.salidas[0]).name;
}

// --- Envío de trozos -------------------------------------------------------

/** Llamadas en vuelo: si Rust tarda, se tiran trozos en vez de amontonarlos. */
let enVuelo = 0;
const MAX_EN_VUELO = 6;
let fallando = false;
let vigilante: number | null = null;

function enviar(pcm: Uint8Array) {
  if (fallando) return;
  if (enVuelo >= MAX_EN_VUELO) return; // se oye un corte en los audífonos; la cabina, nada
  enVuelo++;
  cueDatos(pcm)
    .catch((e) => {
      if (fallando) return;
      fallando = true;
      console.error("[audifonos] se cortaron", e);
      apagarTodo(`Los audífonos se cortaron: ${String(e)}`);
    })
    .finally(() => {
      enVuelo--;
    });
}

function vigilar(on: boolean) {
  if (!on) {
    if (vigilante !== null) window.clearInterval(vigilante);
    vigilante = null;
    return;
  }
  if (vigilante !== null) return;
  // Cada 2 s: ¿siguen abiertos? (se desconectaron los audífonos, murió pacat...)
  vigilante = window.setInterval(() => {
    cueEstado()
      .then((e) => {
        if (!e.abierto && !fallando) {
          fallando = true;
          apagarTodo(e.error ? `Los audífonos se cortaron: ${e.error}` : "Los audífonos se cerraron solos.");
        }
      })
      .catch((err) => console.error("[audifonos] no se pudo leer el estado", err));
  }, 2000);
}

// --- Lo que usa la pantalla ------------------------------------------------

/** Apaga los audífonos de los dos decks y cierra la salida. `error` se muestra. */
export function apagarTodo(error = "") {
  const st = useStore.getState();
  st.patchAudifonos({ A: false, B: false, abriendo: false, error });
  engine.setCueDeck("A", false);
  engine.setCueDeck("B", false);
  engine.setCueEnvio(null);
  vigilar(false);
  if (isTauri()) cueCerrar().catch((e) => console.error("[audifonos] no se pudo cerrar", e));
  if (error) st.showToast(error);
}

/** Abre (o reabre) la salida de los audífonos en `sink`. */
async function abrir(sink: string) {
  await cueAbrir(sink, engine.frecuencia());
  fallando = false;
  enVuelo = 0;
  engine.setCueEnvio(enviar);
  vigilar(true);
}

/** Botón de audífonos de un deck. */
export async function alternarAudifonos(id: DeckId) {
  const st = useStore.getState();
  const a = st.audifonos;
  if (a.abriendo) return;
  const encender = !a[id];

  if (!encender) {
    const otro: DeckId = id === "A" ? "B" : "A";
    if (!a[otro]) {
      apagarTodo();
      return;
    }
    st.patchAudifonos({ [id]: false });
    engine.setCueDeck(id, false);
    return;
  }

  if (!isTauri()) {
    st.patchAudifonos({ error: "Los audífonos solo funcionan en la app instalada." });
    st.showToast("Los audífonos solo funcionan en la app instalada.");
    return;
  }

  // Ya abiertos (el otro deck está en audífonos): solo sumar este deck.
  if ((a.A || a.B) && !fallando) {
    st.patchAudifonos({ [id]: true, error: "" });
    engine.setCueDeck(id, true);
    return;
  }

  st.patchAudifonos({ abriendo: true, error: "" });
  try {
    const o = await preescuchaOpciones();
    const actual = useStore.getState().audifonos.sink;
    const sink = actual && o.salidas.some((s) => s.name === actual) ? actual : elegirSalidaAudifonos(o);
    if (!sink) {
      throw new Error(
        `No hay por dónde sacar los audífonos: la música sale por «${o.principal}», y por ahí la oiría todo el mundo. ` +
          "Hace falta una de dos: la cabina por Bluetooth y los audífonos de cable, o la cabina por cable y los audífonos Bluetooth."
      );
    }
    useStore.getState().patchAudifonos({ sink, [id]: true });
    await abrir(sink);
    engine.setCueDeck(id, true);
    useStore.getState().patchAudifonos({ abriendo: false });
    const desc = o.salidas.find((s) => s.name === sink);
    if (desc?.audifonos === false) {
      useStore
        .getState()
        .showToast("⚠ No detecto audífonos enchufados: puede estar sonando por los parlantes del portátil.");
    }
  } catch (e) {
    console.error("[audifonos] no se pudieron abrir", e);
    apagarTodo(e instanceof Error ? e.message : String(e));
  }
}

/** Cambiar la salida de los audífonos (la barrita de audífonos). */
export async function cambiarSalidaAudifonos(sink: string) {
  const st = useStore.getState();
  recordarSalidaAudifonos(sink);
  st.patchAudifonos({ sink, error: "" });
  if (!st.audifonos.A && !st.audifonos.B) return;
  st.patchAudifonos({ abriendo: true });
  try {
    await abrir(sink);
    useStore.getState().patchAudifonos({ abriendo: false });
  } catch (e) {
    console.error("[audifonos] no se pudo cambiar la salida", e);
    apagarTodo(e instanceof Error ? e.message : String(e));
  }
}

export function volumenAudifonos(v: number) {
  useStore.getState().patchAudifonos({ volumen: v });
  engine.setCueVolumen(v);
}
