/**
 * Automix: la cola de canciones que se mezclan solas.
 *
 * COMO FUNCIONA (guia .mega-cuestionario/Guía para Automix.md):
 *  - Hay UNA cola. Se llena arrastrando canciones a la barra o con el boton
 *    "Poner automix" de una carpeta/artista (que la ordena por ritmo).
 *  - Alterna los decks A y B: la siguiente cancion se precarga en el deck
 *    libre en cuanto termina la transicion anterior (decodificar cuesta 1-3 s
 *    de CPU en los portatiles flojos: se hace con tiempo, nunca a ultima hora).
 *  - Cuatro veces por segundo mira donde va la cancion que suena. Al llegar al
 *    punto de mezcla (la cola floja del final en los generos bailables; los
 *    ultimos segundos en los lentos) arranca la transicion del motor, que
 *    alinea los golpes y mueve el crossfader solo.
 *  - Regla de la vuelta (D11): la siguiente es la PRIMERA cancion que todavia
 *    no ha sonado; si ya sonaron todas, la que sigue en orden circular desde
 *    la ultima elegida asi. Una cancion agregada en la segunda vuelta suena de
 *    inmediato y despues se continua por donde iba la vuelta.
 *  - Con el automix encendido, los controles de los decks y el crossfader
 *    quedan bloqueados (ver `automixBloquea`). El VOL general sigue.
 *  - Si una cancion no se puede cargar, se marca, se avisa y se salta. Nunca
 *    se queda callado mientras haya con que seguir.
 */

import { engine } from "./AudioEngine";
import { useStore, type DeckId, type EstadoAutomix, type ItemCola } from "../state/store";
import type { TrackInfo } from "../lib/tauri";
import { ordenarRuta } from "../lib/ruta";

/** Generos donde la cancion se deja casi entera (no se come la cola floja). */
const GENEROS_LENTOS = ["viejoteca", "carranga", "boleros", "bolero", "balada", "baladas"];
/** Duracion de la transicion (s) en bailables y en lentos. */
const DUR_BAILABLE = 8;
const DUR_LENTO = 6;
/** Cada cuanto se vigila la cancion que suena. 4 veces por segundo, como la barra de progreso. */
const TICK_MS = 250;
/** Espera tras una transicion antes de precargar la siguiente (deja respirar a la CPU). */
const ESPERA_PRECARGA_MS = 1500;

const otro = (d: DeckId): DeckId => (d === "A" ? "B" : "A");
let seqIds = 0;

export function itemDesdePista(t: TrackInfo): ItemCola {
  return {
    id: `c${++seqIds}`,
    path: t.path,
    nombre: t.title ? (t.artist ? `${t.title} · ${t.artist}` : t.title) : t.name,
    bpm: t.bpm,
    duracion: t.duration,
    gainDb: t.gain_db,
    sono: false,
    fallo: null,
  };
}

function generoDePista(t: TrackInfo | undefined): string {
  if (!t) return "";
  if (t.genre) return t.genre.toLowerCase();
  const partes = t.folder.split("/");
  return (partes[partes.length - 1] ?? "").toLowerCase();
}

function pistaPorRuta(path: string | null): TrackInfo | undefined {
  if (!path) return undefined;
  return useStore.getState().library?.tracks.find((t) => t.path === path);
}

class Automix {
  private timer: number | null = null;
  private deckActivo: DeckId | null = null; // el deck que suena bajo el automix
  private deckSiguiente: DeckId | null = null; // el deck con la cancion precargada
  private cargando = false;
  private mezclando = false;
  private siguienteCircular = false; // la precargada se eligio en modo "vuelta"
  private ultimoCircularId: string | null = null; // cursor de la vuelta (D11)
  private faltanPrev: number | null = null;
  private esperaPrecarga: number | null = null;

  constructor() {
    engine.onFinNatural = (id) => this.finNatural(id);
  }

  private get st() {
    return useStore.getState();
  }
  private get estado() {
    return this.st.automix;
  }
  private patch(p: Partial<EstadoAutomix>) {
    this.st.patchAutomix(p);
  }

  // ------------------------------------------------------------------
  // Encender / apagar
  // ------------------------------------------------------------------

  encender(): void {
    if (this.estado.encendido) return;
    engine.ensure();
    this.patch({ encendido: true, mensaje: null, faltan: null });
    const decks = this.st.decks;
    const sonA = decks.A.isPlaying;
    const sonB = decks.B.isPlaying;
    if (sonA && sonB) {
      // Los dos suenan: manda el lado del crossfader; el otro se apaga suave.
      const activo: DeckId = this.st.crossfader <= 0.5 ? "A" : "B";
      this.deckActivo = activo;
      void this.apagarSuave(otro(activo));
    } else if (sonA || sonB) {
      this.deckActivo = sonA ? "A" : "B";
    } else {
      this.deckActivo = null; // el tick arranca la primera de la cola
    }
    // Si lo que suena esta en la cola, se marca como "sonando".
    if (this.deckActivo) {
      const path = decks[this.deckActivo].trackPath;
      const item = this.estado.cola.find((c) => c.path === path);
      if (item) {
        this.patch({ sonandoId: item.id, cola: this.estado.cola.map((c) => (c.id === item.id ? { ...c, sono: true } : c)) });
      } else {
        this.patch({ sonandoId: null });
      }
    }
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  apagar(): void {
    if (!this.estado.encendido) return;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    if (this.esperaPrecarga !== null) window.clearTimeout(this.esperaPrecarga);
    this.esperaPrecarga = null;
    if (this.mezclando) engine.cancelMix(); // la transicion a medias se queda como esta
    this.mezclando = false;
    this.deckActivo = null;
    this.deckSiguiente = null;
    this.siguienteCircular = false;
    this.faltanPrev = null;
    this.patch({ encendido: false, sonandoId: null, siguienteId: null, siguienteLista: false, faltan: null, mensaje: null });
  }

  /** Baja el crossfader hacia el otro lado en 1,5 s y pausa el deck que queda callado. */
  private async apagarSuave(deck: DeckId): Promise<void> {
    const destino = deck === "A" ? 1 : 0;
    const inicio = this.st.crossfader;
    const pasos = 30;
    for (let i = 1; i <= pasos; i++) {
      await new Promise((r) => window.setTimeout(r, 50));
      if (!this.estado.encendido) return;
      engine.setCrossfader(inicio + (destino - inicio) * (i / pasos));
    }
    engine.pause(deck);
  }

  // ------------------------------------------------------------------
  // La cola
  // ------------------------------------------------------------------

  /** Agrega canciones al final de la cola. */
  agregar(pistas: TrackInfo[]): void {
    if (pistas.length === 0) return;
    const nuevos = pistas.map(itemDesdePista);
    this.patch({ cola: [...this.estado.cola, ...nuevos], mensaje: null });
    this.revisarSiguiente();
  }

  /** Mete `pista` en la posicion `indice` (arrastrada a la barra). */
  insertar(pista: TrackInfo, indice: number): void {
    const cola = [...this.estado.cola];
    const i = Math.max(0, Math.min(cola.length, indice));
    cola.splice(i, 0, itemDesdePista(pista));
    this.patch({ cola, mensaje: null });
    this.revisarSiguiente();
  }

  /**
   * "Poner automix" sobre una carpeta/artista: ordena por ritmo (empezando
   * por lo mas parecido a lo que suena) y enciende.
   */
  ponerCarpeta(pistas: TrackInfo[], etiqueta: string, modo: "limpiar" | "anadir"): void {
    const activo = this.deckActivo ?? (this.st.decks.A.isPlaying ? "A" : this.st.decks.B.isPlaying ? "B" : null);
    const bpmNatural = activo ? engine.getNaturalBpm(activo) : null;
    const bpmActual = activo && bpmNatural ? bpmNatural * engine.getRate(activo) : null;
    const pistaActual = activo ? pistaPorRuta(this.st.decks[activo].trackPath) ?? null : null;
    const ordenadas = ordenarRuta(pistas, bpmActual, pistaActual);
    const nuevos = ordenadas.map(itemDesdePista);
    if (modo === "limpiar") {
      this.ultimoCircularId = null;
      this.patch({ cola: nuevos, etiqueta, sonandoId: null, siguienteId: null, siguienteLista: false, mensaje: null });
    } else {
      this.patch({ cola: [...this.estado.cola, ...nuevos], etiqueta: `${this.estado.etiqueta ?? "cola"} + ${etiqueta}`, mensaje: null });
    }
    if (!this.estado.encendido) this.encender();
    else this.revisarSiguiente();
  }

  quitar(id: string): void {
    const cola = this.estado.cola;
    const i = cola.findIndex((c) => c.id === id);
    if (i < 0) return;
    if (this.ultimoCircularId === id) this.ultimoCircularId = cola[i - 1]?.id ?? null;
    const p: Partial<EstadoAutomix> = { cola: cola.filter((c) => c.id !== id) };
    if (this.estado.sonandoId === id) p.sonandoId = null;
    if (this.estado.siguienteId === id) {
      p.siguienteId = null;
      p.siguienteLista = false;
      this.deckSiguiente = null;
    }
    this.patch(p);
    this.revisarSiguiente();
  }

  /** Mueve el item `id` a la posicion `indice` (reordenar arrastrando). */
  mover(id: string, indice: number): void {
    const cola = [...this.estado.cola];
    const i = cola.findIndex((c) => c.id === id);
    if (i < 0) return;
    const [item] = cola.splice(i, 1);
    const j = Math.max(0, Math.min(cola.length, indice > i ? indice - 1 : indice));
    cola.splice(j, 0, item);
    this.patch({ cola });
    this.revisarSiguiente();
  }

  limpiar(): void {
    this.ultimoCircularId = null;
    this.deckSiguiente = null;
    this.patch({ cola: [], etiqueta: null, sonandoId: null, siguienteId: null, siguienteLista: false, mensaje: this.estado.encendido ? "cola vacía" : null, faltan: null });
  }

  /** Pasa ya a la siguiente, con la misma transicion suave. */
  saltar(): void {
    if (!this.estado.encendido) return;
    if (this.mezclando) {
      this.st.showToast("Ya está mezclando");
      return;
    }
    if (this.deckActivo === null) {
      this.arrancarDesdeCero();
      return;
    }
    if (!this.estado.siguienteLista || !this.deckSiguiente) {
      this.st.showToast(this.estado.siguienteId ? "La siguiente todavía está cargando..." : "No hay siguiente en la cola");
      return;
    }
    void this.iniciarMezcla();
  }

  // ------------------------------------------------------------------
  // Eleccion de la siguiente (regla D11)
  // ------------------------------------------------------------------

  private elegirSiguiente(): { item: ItemCola; circular: boolean } | null {
    const cola = this.estado.cola.filter((c) => !c.fallo);
    if (cola.length === 0) return null;
    const sonandoId = this.estado.sonandoId;
    // 1. La primera que no ha sonado.
    const nueva = cola.find((c) => !c.sono && c.id !== sonandoId);
    if (nueva) return { item: nueva, circular: false };
    // 2. Ya sonaron todas: la que sigue en la vuelta.
    const cursor = this.ultimoCircularId ?? sonandoId;
    const i = cursor ? cola.findIndex((c) => c.id === cursor) : -1;
    const sig = cola[(i + 1) % cola.length];
    return { item: sig, circular: true };
  }

  /** Tras cualquier cambio en la cola: si la precargada ya no es la que toca, se vuelve a precargar. */
  private revisarSiguiente(): void {
    if (!this.estado.encendido || this.mezclando || this.cargando) return;
    const e = this.elegirSiguiente();
    if (this.estado.siguienteId && e?.item.id !== this.estado.siguienteId) {
      this.deckSiguiente = null;
      this.patch({ siguienteId: null, siguienteLista: false });
    }
  }

  // ------------------------------------------------------------------
  // Precarga
  // ------------------------------------------------------------------

  private async prepararSiguiente(): Promise<void> {
    if (!this.estado.encendido || this.cargando || this.mezclando || this.deckActivo === null) return;
    const e = this.elegirSiguiente();
    if (!e) {
      this.deckSiguiente = null;
      this.patch({ siguienteId: null, siguienteLista: false, mensaje: this.estado.cola.length === 0 ? "cola vacía" : "nada que cargar" });
      return;
    }
    const libre = otro(this.deckActivo);
    const item = e.item;
    this.cargando = true;
    this.siguienteCircular = e.circular;
    this.patch({ siguienteId: item.id, siguienteLista: false, mensaje: null });
    const ok = await engine.load(libre, item.path, item.bpm, item.nombre, item.gainDb);
    this.cargando = false;
    if (!this.estado.encendido) return;
    if (!ok) {
      this.patch({
        cola: this.estado.cola.map((c) => (c.id === item.id ? { ...c, fallo: "no se pudo cargar" } : c)),
        siguienteId: null,
        siguienteLista: false,
      });
      this.st.showToast(`Automix: se salta "${item.nombre}" (no se pudo cargar)`);
      void this.prepararSiguiente();
      return;
    }
    // Mientras cargaba, ¿cambio la cola?
    const ahora = this.elegirSiguiente();
    if (!ahora || ahora.item.id !== item.id || !this.estado.cola.some((c) => c.id === item.id)) {
      this.patch({ siguienteId: null, siguienteLista: false });
      void this.prepararSiguiente();
      return;
    }
    this.deckSiguiente = libre;
    this.patch({ siguienteLista: true });
  }

  // ------------------------------------------------------------------
  // Vigilancia y mezcla
  // ------------------------------------------------------------------

  /** Punto de mezcla (s, tiempo del buffer) y duracion de la transicion para el deck activo. */
  private puntoMezcla(deck: DeckId): { en: number; dur: number } {
    const fin = engine.getFinUtil(deck);
    const pista = pistaPorRuta(this.st.decks[deck].trackPath);
    const genero = generoDePista(pista);
    if (GENEROS_LENTOS.some((g) => genero.includes(g))) {
      return { en: Math.max(0, fin - DUR_LENTO), dur: DUR_LENTO };
    }
    const an = engine.getAnalisis(deck);
    const outro = an?.inicioOutro ?? null;
    const en = outro !== null ? Math.min(outro, fin - 3) : fin - DUR_BAILABLE;
    return { en: Math.max(0, en), dur: DUR_BAILABLE };
  }

  private tick(): void {
    const e = this.estado;
    if (!e.encendido) return;
    if (this.mezclando) return;
    if (this.deckActivo === null) {
      if (!this.st.decks.A.isPlaying && !this.st.decks.B.isPlaying) this.arrancarDesdeCero();
      return;
    }
    const activo = this.deckActivo;
    if (!engine.isPlaying(activo)) return; // termino sola: lo atiende finNatural
    if (e.siguienteId === null && !this.cargando) {
      void this.prepararSiguiente();
    }
    const { en } = this.puntoMezcla(activo);
    const pos = engine.getPosition(activo);
    const faltan = Math.max(0, Math.ceil((en - pos) / engine.getRate(activo)));
    if (faltan !== this.faltanPrev) {
      this.faltanPrev = faltan;
      this.patch({ faltan });
    }
    if (pos >= en - 0.3 && e.siguienteLista && this.deckSiguiente) {
      void this.iniciarMezcla();
    }
  }

  private async iniciarMezcla(): Promise<void> {
    if (this.mezclando || this.deckActivo === null || this.deckSiguiente === null) return;
    const from = this.deckActivo;
    const to = this.deckSiguiente;
    const itemId = this.estado.siguienteId;
    const circular = this.siguienteCircular;
    const { dur } = this.puntoMezcla(from);
    this.mezclando = true;
    this.patch({ mensaje: "mezclando...", faltan: 0 });
    const res = await engine.transicion(from, to, { duracionSeg: dur, exigirCompatibles: false });
    if (!this.estado.encendido) return; // se apago a mitad
    this.mezclando = false;
    if (!res.ok) {
      // Se vuelve a intentar en el proximo tick; si la cancion termina antes, finNatural arranca la siguiente.
      this.patch({ mensaje: res.reason ?? "no se pudo mezclar" });
      console.error("[Automix] transicion fallo:", res.reason);
      return;
    }
    this.deckActivo = to;
    this.deckSiguiente = null;
    if (circular && itemId) this.ultimoCircularId = itemId;
    this.patch({
      cola: this.estado.cola.map((c) => (c.id === itemId ? { ...c, sono: true } : c)),
      sonandoId: itemId,
      siguienteId: null,
      siguienteLista: false,
      mensaje: null,
    });
    this.programarPrecarga();
  }

  private programarPrecarga(): void {
    if (this.esperaPrecarga !== null) window.clearTimeout(this.esperaPrecarga);
    this.esperaPrecarga = window.setTimeout(() => {
      this.esperaPrecarga = null;
      void this.prepararSiguiente();
    }, ESPERA_PRECARGA_MS);
  }

  /** Nada suena: arranca la precargada si esta lista, o carga y arranca la siguiente. */
  private arrancarDesdeCero(): void {
    if (this.cargando || this.mezclando) return;
    if (this.estado.siguienteLista && this.deckSiguiente && engine.hasBuffer(this.deckSiguiente)) {
      const deck = this.deckSiguiente;
      const itemId = this.estado.siguienteId;
      const circular = this.siguienteCircular;
      this.deckActivo = deck;
      this.deckSiguiente = null;
      engine.setCrossfader(deck === "A" ? 0 : 1);
      void engine.play(deck).then(() => {
        // Si el motor de sonido no arranco (ya aviso en pantalla), no nos quedamos esperando.
        if (this.deckActivo === deck && !engine.isPlaying(deck)) this.deckActivo = null;
      });
      if (circular && itemId) this.ultimoCircularId = itemId;
      this.patch({
        cola: this.estado.cola.map((c) => (c.id === itemId ? { ...c, sono: true } : c)),
        sonandoId: itemId,
        siguienteId: null,
        siguienteLista: false,
        mensaje: null,
      });
      this.programarPrecarga();
      return;
    }
    const e = this.elegirSiguiente();
    if (!e) {
      if (this.estado.mensaje !== "cola vacía") this.patch({ mensaje: "cola vacía", faltan: null });
      return;
    }
    // Deck para arrancar: el que no tenga cancion; si los dos tienen, A.
    const decks = this.st.decks;
    const deck: DeckId = !decks.A.trackPath ? "A" : !decks.B.trackPath ? "B" : "A";
    this.deckActivo = deck;
    // Se "precarga" en el deck activo y luego se arranca de una.
    this.cargando = true;
    this.siguienteCircular = e.circular;
    this.patch({ siguienteId: e.item.id, siguienteLista: false, mensaje: "cargando..." });
    void engine.load(deck, e.item.path, e.item.bpm, e.item.nombre, e.item.gainDb).then((ok) => {
      this.cargando = false;
      if (!this.estado.encendido) return;
      if (!ok) {
        this.deckActivo = null;
        this.patch({
          cola: this.estado.cola.map((c) => (c.id === e.item.id ? { ...c, fallo: "no se pudo cargar" } : c)),
          siguienteId: null,
          siguienteLista: false,
        });
        this.st.showToast(`Automix: se salta "${e.item.nombre}" (no se pudo cargar)`);
        return; // el proximo tick prueba con la siguiente
      }
      this.deckSiguiente = deck;
      this.deckActivo = null;
      this.patch({ siguienteLista: true });
      this.arrancarDesdeCero(); // ahora si: la toca de una
    });
  }

  private finNatural(deck: DeckId): void {
    if (!this.estado.encendido || deck !== this.deckActivo) return;
    // Termino sin mezcla (la siguiente no estaba lista o la cola estaba vacia).
    this.deckActivo = null;
    this.faltanPrev = null;
    this.patch({ faltan: null });
    this.arrancarDesdeCero();
  }
}

export const automix = new Automix();

/**
 * Para los controles de los decks y el crossfader: con el automix encendido
 * no responden, y se explica por que. Devuelve true si hay que bloquear.
 */
export function automixBloquea(): boolean {
  const st = useStore.getState();
  if (!st.automix.encendido) return false;
  // En el centro y grande: abajo, junto al chip de CPU, se perdia.
  st.showAvisoCentral("Para mezclar tú mismo, apaga el automix");
  return true;
}
