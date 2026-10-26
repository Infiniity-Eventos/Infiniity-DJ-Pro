/**
 * Motor de audio de Infiniity DJ (Web Audio API con AudioBuffer).
 *
 * POR QUE ASI (Linux/WebKitGTK):
 *  - `createMediaElementSource` (enrutar un <audio> a la Web Audio) NO funciona
 *    en WebKitGTK, y reproducir/buscar dentro de un Blob con <audio> es poco
 *    fiable (saltos, seek roto). La via robusta es decodificar la cancion a PCM
 *    (`decodeAudioData`) y reproducirla con `AudioBufferSourceNode`, que si esta
 *    bien soportado. Da reproduccion sin saltos y busqueda instantanea y precisa.
 *
 * BEATMATCH: cambiar `playbackRate` en el AudioBufferSourceNode mueve el tono
 * junto con el tempo (como un tornamesa). Es gratis en CPU (sin time-stretch).
 *
 * GOLPES ALINEADOS: al cargar, se analiza el audio decodificado (silencios,
 * cola floja del final, primer golpe; ver analisis.ts). En la transicion, la
 * cancion nueva arranca EN SU PRIMER GOLPE justo en un golpe de la que suena,
 * programado con precision de muestra en el reloj del motor (`source.start(when)`).
 *
 * RENDIMIENTO/RAM: cada deck mantiene UN AudioBuffer decodificado (~80MB por
 * cancion). Maximo 2 a la vez; al cargar otra cancion en un deck, el buffer
 * anterior queda libre para el recolector de basura.
 *
 * Grafo por deck:  BufferSource -> normGain -> volumeGain -> xfadeGain -> master -> salida
 */

import { useStore, FX_NEUTRO, type DeckId, type FxKey, type FxValues } from "../state/store";
import { readMediaBytes } from "../lib/tauri";
import { analizarCancion, golpeEnTramo, siguienteGolpe, type AnalisisCancion } from "./analisis";
import {
  aplicarSalidaGuardada,
  comprobarSalida,
  olvidarSalidaAplicada,
  registrarRehacerConexion,
  rehacerConexionDeSonido,
} from "../lib/salidaAudio";

/**
 * Le pone un limite de tiempo a una promesa.
 *
 * POR QUE: en un equipo de prueba, cargar una cancion recien descargada dejaba
 * el deck "cargando" para SIEMPRE. No fallaba (habria salido el aviso de
 * error): simplemente nunca terminaba. Un deck colgado sin explicacion, en
 * pleno evento, es lo peor que puede pasar. Con esto, al menos, se entera de
 * que algo se atasco y puede probar otra cancion.
 */
function conLimite<T>(promesa: Promise<T>, ms: number, que: string): Promise<T> {
  return new Promise<T>((resolver, rechazar) => {
    const t = window.setTimeout(
      () => rechazar(new Error(`${que} se quedó bloqueado tras ${Math.round(ms / 1000)}s`)),
      ms
    );
    promesa.then(
      (v) => {
        window.clearTimeout(t);
        resolver(v);
      },
      (e) => {
        window.clearTimeout(t);
        rechazar(e);
      }
    );
  });
}

interface Deck {
  buffer: AudioBuffer | null;
  source: AudioBufferSourceNode | null;
  normGain: GainNode; // auto-nivelacion: iguala la sonoridad entre canciones
  volumeGain: GainNode;
  xfadeGain: GainNode;
  naturalBpm: number | null;
  rate: number; // playbackRate actual (1 = natural)
  offset: number; // posicion (seg) donde arranco la reproduccion actual / donde quedo en pausa
  startCtxTime: number; // ctx.currentTime cuando arranco (o arrancara) la reproduccion actual
  playing: boolean;
  endedGuard: boolean; // true cuando nosotros paramos la fuente (para ignorar onended)
  loadToken: number; // identifica la carga vigente (descarta cargas viejas)
  analisis: AnalisisCancion | null; // silencios, outro, primer golpe (ver analisis.ts)
  /** Rampa de velocidad en curso (programada en el reloj de audio). null si no hay. */
  rampa: { t0: number; r0: number; r1: number; dur: number } | null;
  fx: NodosFx;
}

/**
 * Efectos de un deck (guia .mega-cuestionario/Guía para Efectos.md). Todo son
 * nodos estandar de Web Audio: corren en el hilo de audio, no en la interfaz.
 *
 *   normGain → graves → medios → agudos → filtro → ┬→ seco ───────────────┐
 *                                                  └→ [voz humedo] → wet ─┴→ swapLow → volumeGain
 *
 * Voz humedo (bajar la voz): la voz casi siempre va en el CENTRO del estereo,
 * asi que (izq − der) la cancela. Como el bajo y el bombo tambien suelen ir al
 * centro, se devuelven los graves originales por debajo de 180 Hz. Y encima se
 * recorta la banda donde vive la voz. La perilla mezcla seco/humedo.
 *
 * swapLow: filtro de graves INTERNO que solo usa la transicion (cambio de
 * graves): asi las perillas del usuario no se mueven solas.
 */
interface NodosFx {
  graves: BiquadFilterNode;
  medios: BiquadFilterNode;
  agudos: BiquadFilterNode;
  filtro: BiquadFilterNode;
  seco: GainNode;
  humedo: GainNode;
  swapLow: BiquadFilterNode;
  valores: FxValues;
}

export interface MixResult {
  ok: boolean;
  reason?: string;
}

export interface OpcionesTransicion {
  /** Duracion del movimiento del crossfader, en segundos. */
  duracionSeg: number;
  /**
   * Si es true y los ritmos son incompatibles (mas del limite de velocidad),
   * la transicion se niega con un aviso (comportamiento del boton MEZCLAR).
   * El automix pasa false: mezcla igual, solo que sin igualar velocidad.
   */
  exigirCompatibles: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Se ignoran silencios mas cortos que esto (no vale la pena recortar). */
const MIN_RECORTE = 0.05;

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private decks: Record<DeckId, Deck> | null = null;
  /*
   * ANIMACIONES EN EL RELOJ DE AUDIO (no en requestAnimationFrame):
   * el navegador congela rAF cuando la ventana esta oculta o minimizada, y una
   * transicion a medias dejaba los DOS decks sonando a todo volumen. Ahora el
   * crossfader y la velocidad se programan como curvas en los AudioParam (las
   * ejecuta el hilo de audio aunque la pantalla no se pinte); los
   * temporizadores de abajo solo refrescan la interfaz y avisan del final.
   */
  private rateAnim: Record<DeckId, { intervalo: number; fin: number; resolver: (ok: boolean) => void } | null> = { A: null, B: null };
  private mixAnim: { intervalo: number; fin: number; t0: number; x0: number; x1: number; dur: number; resolver: (ok: boolean) => void } | null = null;
  private tokenSeq = 0;
  /** Avisa cuando una cancion termina sola (fin natural). Lo usa el automix. */
  onFinNatural: ((id: DeckId) => void) | null = null;
  /** Efectos de un toque (drops): audio decodificado y, si suena, su fuente. */
  private efectos = new Map<string, { buffer: AudioBuffer | null; cargando: Promise<AudioBuffer | null> | null; source: AudioBufferSourceNode | null; gain: GainNode | null }>();
  /** Esta en marcha un intento de levantar el motor (no solapar dos). */
  private levantando = false;
  /** Temporizador que comprueba que el sonido siga saliendo por donde debe. */
  private vigilante: number | null = null;
  /** Comprobaciones seguidas con problema (se avisa a la segunda, no a la primera). */
  private fallosSalida = 0;
  /** Ya se aviso del problema de salida (no repetirlo cada pocos segundos). */
  private avisadoSalida = false;

  ensure(): void {
    if (this.ctx) return;
    const ctx = new AudioContext({ latencyHint: "playback" });
    const master = ctx.createGain();
    master.gain.value = useStore.getState().masterVolume;
    // Limitador de seguridad al final: como la nivelacion ahora apunta mas
    // alto (ver computeNormGain), dos decks sonando a la vez podrian pasarse
    // del maximo y distorsionar. Esto frena solo los picos; no cambia el
    // volumen normal. Corre en el hilo de audio nativo: no cuesta CPU visible.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;
    master.connect(limiter);
    limiter.connect(ctx.destination);

    const makeDeck = (): Deck => {
      const normGain = ctx.createGain();
      const volumeGain = ctx.createGain();
      const xfadeGain = ctx.createGain();
      const fx = this.crearFx(ctx);
      normGain.connect(fx.graves);
      fx.swapLow.connect(volumeGain);
      volumeGain.connect(xfadeGain);
      xfadeGain.connect(master);
      return {
        buffer: null,
        source: null,
        normGain,
        volumeGain,
        xfadeGain,
        naturalBpm: null,
        rate: 1,
        offset: 0,
        startCtxTime: 0,
        playing: false,
        endedGuard: false,
        loadToken: 0,
        analisis: null,
        rampa: null,
        fx,
      };
    };

    this.ctx = ctx;
    this.master = master;
    this.decks = { A: makeDeck(), B: makeDeck() };
    this.applyCrossfader(useStore.getState().crossfader);

    this.vigilarMotor(ctx);
    this.vigilarSalida();

    // Recien creado el motor ya existe la conexion con el sonido del sistema:
    // es el momento de mandarla a la salida elegida (la cabina), ANTES de que
    // suene la primera cancion por los parlantes del portatil.
    void aplicarSalidaGuardada();
  }

  private deck(id: DeckId): Deck {
    this.ensure();
    return this.decks![id];
  }

  // -------- Efectos de un toque (drops: "Mezclando Infiniity Eventos") --------

  /**
   * Suena ENCIMA de lo que haya (va directo al master, pasa por el VOL general
   * y el limitador), sin tocar los decks ni el automix. Si ya esta sonando,
   * volver a disparar lo apaga con un fundido corto.
   * El archivo viene dentro del programa (public/efectos): esta en todas las
   * PC apenas actualizan, sin depender de Sync.
   */
  async dispararEfecto(id: string, url: string): Promise<void> {
    this.ensure();
    if (!(await this.despertar())) return;
    const ctx = this.ctx!;
    let e = this.efectos.get(id);
    if (!e) {
      e = { buffer: null, cargando: null, source: null, gain: null };
      this.efectos.set(id, e);
    }
    const st = useStore.getState();
    if (e.source) {
      // Ya suena: apagarlo suave.
      const g = e.gain!.gain;
      const now = ctx.currentTime;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + 0.3);
      const src = e.source;
      e.source = null;
      window.setTimeout(() => {
        try {
          src.stop();
        } catch {
          /* ya termino */
        }
      }, 320);
      st.setEfectoSonando(id, false);
      return;
    }
    if (!e.buffer) {
      if (!e.cargando) {
        e.cargando = fetch(url)
          .then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.arrayBuffer();
          })
          .then((bytes) => ctx.decodeAudioData(bytes))
          .catch((err) => {
            console.error("[AudioEngine.dispararEfecto] no se pudo cargar", id, err);
            useStore.getState().showToast(`No se pudo cargar el efecto (${err})`);
            return null;
          });
      }
      e.buffer = await e.cargando;
      e.cargando = null;
      if (!e.buffer) return;
    }
    const gain = ctx.createGain();
    gain.gain.value = 1;
    gain.connect(this.master!);
    const src = ctx.createBufferSource();
    src.buffer = e.buffer;
    src.connect(gain);
    src.onended = () => {
      if (e!.source === src) {
        e!.source = null;
        useStore.getState().setEfectoSonando(id, false);
      }
      gain.disconnect();
    };
    e.source = src;
    e.gain = gain;
    src.start();
    st.setEfectoSonando(id, true);
  }

  // -------- Efectos --------

  private crearFx(ctx: AudioContext): NodosFx {
    const graves = ctx.createBiquadFilter();
    graves.type = "lowshelf";
    graves.frequency.value = 200;
    const medios = ctx.createBiquadFilter();
    medios.type = "peaking";
    medios.frequency.value = 1000;
    medios.Q.value = 0.7;
    const agudos = ctx.createBiquadFilter();
    agudos.type = "highshelf";
    agudos.frequency.value = 3000;
    const filtro = ctx.createBiquadFilter();
    filtro.type = "lowpass";
    filtro.frequency.value = 20000;
    filtro.Q.value = 0.5;
    graves.connect(medios);
    medios.connect(agudos);
    agudos.connect(filtro);

    // Camino seco.
    const seco = ctx.createGain();
    seco.gain.value = 1;
    filtro.connect(seco);

    // Camino humedo: cancelar el centro con (izq − der). La MISMA resta sale
    // por los dos lados (se pierde la anchura estereo, pero da igual): si se
    // mandara izq−der por un lado y der−izq por el otro, un equipo de sonido
    // MONO, como muchos de eventos, sumaria los dos y se cancelaria TODO
    // menos los graves. Medido con tonos de prueba el 2026-10-18.
    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);
    filtro.connect(splitter);
    const lMas = ctx.createGain();
    lMas.gain.value = 1;
    const rMenos = ctx.createGain();
    rMenos.gain.value = -1;
    splitter.connect(lMas, 0);
    splitter.connect(rMenos, 1);
    lMas.connect(merger, 0, 0);
    rMenos.connect(merger, 0, 0);
    lMas.connect(merger, 0, 1);
    rMenos.connect(merger, 0, 1);
    // ...devolver los graves originales (bajo y bombo tambien van al centro)...
    const gravesOriginales = ctx.createBiquadFilter();
    gravesOriginales.type = "lowpass";
    gravesOriginales.frequency.value = 180;
    gravesOriginales.Q.value = 0.7;
    filtro.connect(gravesOriginales);
    gravesOriginales.connect(merger, 0, 0);
    gravesOriginales.connect(merger, 0, 1);
    // ...y recortar la banda de la voz por si queda un fantasma.
    const recorteVoz = ctx.createBiquadFilter();
    recorteVoz.type = "peaking";
    recorteVoz.frequency.value = 1500;
    recorteVoz.Q.value = 0.8;
    recorteVoz.gain.value = -6;
    merger.connect(recorteVoz);
    const humedo = ctx.createGain();
    humedo.gain.value = 0;
    recorteVoz.connect(humedo);

    // Cambio de graves interno (lo usa la transicion).
    const swapLow = ctx.createBiquadFilter();
    swapLow.type = "lowshelf";
    swapLow.frequency.value = 200;
    swapLow.gain.value = 0;
    seco.connect(swapLow);
    humedo.connect(swapLow);

    return { graves, medios, agudos, filtro, seco, humedo, swapLow, valores: { ...FX_NEUTRO } };
  }

  /** Aplica una perilla (0..1). Suave: los AudioParam se mueven en ~20 ms para no hacer clics. */
  setFx(id: DeckId, key: FxKey, valor: number): void {
    const d = this.deck(id);
    const v = clamp(valor, 0, 1);
    d.fx.valores[key] = v;
    const suave = (p: AudioParam, x: number) => {
      p.cancelScheduledValues(this.ctx!.currentTime);
      p.setTargetAtTime(x, this.ctx!.currentTime, 0.01);
    };
    switch (key) {
      case "graves":
      case "medios":
      case "agudos": {
        // Centro = 0 dB; extremos = ±12 dB (abajo del todo casi corta: -24 dB).
        const db = v < 0.5 ? -24 * (0.5 - v) * 2 : 12 * (v - 0.5) * 2;
        suave(d.fx[key].gain, db);
        break;
      }
      case "filtro": {
        // Centro = nada. Izquierda: pasa-bajos que va cerrando (20 kHz → 150 Hz).
        // Derecha: pasa-altos que va subiendo (20 Hz → 6 kHz). Escala logaritmica.
        const f = d.fx.filtro;
        if (Math.abs(v - 0.5) < 0.01) {
          f.type = "lowpass";
          suave(f.frequency, 20000);
          suave(f.Q, 0.5);
        } else if (v < 0.5) {
          f.type = "lowpass";
          const p = (0.5 - v) * 2; // 0..1
          suave(f.frequency, 20000 * Math.pow(150 / 20000, p));
          suave(f.Q, 0.5 + 1.5 * p);
        } else {
          f.type = "highpass";
          const p = (v - 0.5) * 2;
          suave(f.frequency, 20 * Math.pow(6000 / 20, p));
          suave(f.Q, 0.5 + 1.5 * p);
        }
        break;
      }
      case "voz": {
        // Mezcla seco/humedo. El humedo suena mas bajito (la resta quita energia): se compensa un poco.
        suave(d.fx.seco.gain, 1 - v);
        suave(d.fx.humedo.gain, v * 1.3);
        break;
      }
    }
    useStore.getState().patchDeck(id, { fx: { ...d.fx.valores } });
  }

  /** Todas las perillas del deck al neutro (al cargar otra cancion). */
  resetFx(id: DeckId): void {
    (Object.keys(FX_NEUTRO) as FxKey[]).forEach((k) => this.setFx(id, k, FX_NEUTRO[k]));
  }

  getFx(id: DeckId): FxValues {
    return { ...this.deck(id).fx.valores };
  }

  /** Detiene la fuente actual sin marcar "fin de cancion". */
  private stopSource(id: DeckId): void {
    const d = this.deck(id);
    this.plegarRampa(id);
    if (d.source) {
      d.endedGuard = true;
      try {
        d.source.stop();
      } catch {
        /* ya estaba detenida */
      }
      d.source.disconnect();
      d.source = null;
    }
  }

  /** Donde empieza de verdad el sonido (tras el silencio inicial). */
  private inicioUtil(d: Deck): number {
    const s = d.analisis?.silencioInicio ?? 0;
    return s >= MIN_RECORTE ? s : 0;
  }

  /** Donde termina de verdad el sonido (antes del silencio final). */
  private finUtil(d: Deck): number {
    if (!d.buffer) return 0;
    const s = d.analisis?.silencioFin ?? 0;
    return d.buffer.duration - (s >= MIN_RECORTE ? s : 0);
  }

  /**
   * Crea y arranca una fuente desde `offset` segundos, en el instante `when`
   * del reloj del motor (ahora si no se indica). El silencio final se recorta
   * siempre: la fuente se detiene sola al llegar al ultimo sonido.
   */
  private startFrom(id: DeckId, offset: number, when?: number): void {
    const d = this.deck(id);
    if (!d.buffer || !this.ctx) return;
    const fin = this.finUtil(d);
    const off = clamp(offset, 0, Math.max(0, fin - 0.02));
    const src = this.ctx.createBufferSource();
    src.buffer = d.buffer;
    src.playbackRate.value = d.rate;
    src.connect(d.normGain);
    d.endedGuard = false;
    src.onended = () => {
      // El evento llega DESPUES (asincrono): si al buscar dentro de la cancion
      // ya se creo otra fuente, este "fin" es de la fuente vieja y no cuenta.
      // Sin esto, un seek se tomaba como fin natural y el automix arrancaba la
      // siguiente de golpe.
      if (d.source !== src) return;
      if (d.endedGuard) return; // lo paramos nosotros (pausa/seek/carga)
      // Fin natural de la cancion: queda lista para sonar otra vez desde el inicio.
      d.playing = false;
      d.offset = this.inicioUtil(d);
      useStore.getState().patchDeck(id, { isPlaying: false });
      this.onFinNatural?.(id);
    };
    const arranque = when !== undefined ? Math.max(when, this.ctx.currentTime) : 0;
    src.start(arranque, off, Math.max(0.01, fin - off));
    d.source = src;
    d.offset = off;
    d.startCtxTime = arranque || this.ctx.currentTime;
    d.playing = true;
  }

  // -------- Carga --------

  async load(
    id: DeckId,
    path: string,
    naturalBpm: number | null,
    trackName: string,
    gainDb: number | null = null
  ): Promise<boolean> {
    this.ensure();
    const d = this.deck(id);
    this.cancelRateAnim(id);
    this.stopSource(id);
    const token = ++this.tokenSeq;
    d.loadToken = token;
    d.playing = false;
    d.offset = 0;
    d.rate = 1;
    d.naturalBpm = naturalBpm;
    d.analisis = null;
    this.resetFx(id); // otra cancion, perillas al neutro (S4)

    const { patchDeck } = useStore.getState();
    patchDeck(id, {
      trackPath: path,
      trackName,
      bpm: naturalBpm,
      isPlaying: false,
      rate: 1,
      duration: 0,
      loading: true,
    });

    let bytes: ArrayBuffer;
    try {
      bytes = await conLimite(readMediaBytes(path), 30000, "leer el archivo");
    } catch (err) {
      if (d.loadToken === token) {
        patchDeck(id, { loading: false });
        useStore.getState().showToast(`No se pudo leer: ${trackName} (${err})`);
      }
      console.error("[AudioEngine.load] read_media fallo", err);
      return false;
    }
    if (d.loadToken !== token) return false; // se cargo otra cancion mientras leiamos

    let buffer: AudioBuffer;
    try {
      buffer = await conLimite(this.ctx!.decodeAudioData(bytes), 60000, "decodificar el audio");
    } catch (err) {
      if (d.loadToken === token) {
        patchDeck(id, { loading: false });
        useStore.getState().showToast(`No se pudo decodificar: ${trackName} (${err})`);
      }
      console.error("[AudioEngine.load] decodeAudioData fallo", err);
      return false;
    }
    if (d.loadToken !== token) return false; // llego tarde: descartar

    d.buffer = buffer;
    // Si la cancion trae ReplayGain (lo escribe la skill), se usa directo:
    // suena pareja desde el primer segundo. Si no, se mide como antes.
    d.normGain.gain.value =
      gainDb !== null && Number.isFinite(gainDb)
        ? clamp(Math.pow(10, gainDb / 20), 0.25, 4)
        : this.computeNormGain(buffer);
    // Silencios, cola floja y primer golpe: milisegundos sobre el audio ya decodificado.
    try {
      d.analisis = analizarCancion(buffer, naturalBpm);
    } catch (err) {
      // Sin analisis se reproduce igual (sin recortes ni golpes alineados).
      console.error("[AudioEngine.load] analisis fallo", err);
      useStore.getState().showToast(`No se pudo analizar ${trackName}: se mezclara sin alinear golpes`);
      d.analisis = null;
    }
    d.offset = this.inicioUtil(d);
    patchDeck(id, { duration: buffer.duration, loading: false });
    return true;
  }

  /**
   * Auto-nivelacion de volumen: mide la sonoridad (RMS) y el pico de la cancion
   * y devuelve una ganancia para que TODAS suenen parejo, sin saturar.
   * Analiza una MUESTRA (no todas las muestras) para no castigar la CPU.
   */
  private computeNormGain(buffer: AudioBuffer): number {
    const chs = buffer.numberOfChannels;
    const len = buffer.length;
    if (len === 0) return 1;
    // Como maximo ~500k muestras por canal: rapidisimo incluso en gama baja.
    const stride = Math.max(1, Math.floor(len / 500000));
    let sumSq = 0;
    let peak = 0;
    let count = 0;
    for (let c = 0; c < chs; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < len; i += stride) {
        const s = data[i];
        sumSq += s * s;
        const a = s < 0 ? -s : s;
        if (a > peak) peak = a;
        count++;
      }
    }
    const rms = Math.sqrt(sumSq / count);
    // Objetivo de sonoridad ~-14 dBFS (como Spotify/YouTube). Antes era 0.1
    // (-20 dBFS): una cancion moderna, masterizada fuerte (RMS ~0.3), quedaba
    // atenuada a un tercio (-10 dB) y en los eventos "sonaba re pasito". Con
    // 0.2 las fuertes bajan poco y las flojas suben; el limitador del master
    // atrapa los picos.
    const REF_RMS = 0.2;
    let gain = rms > 0.0001 ? REF_RMS / rms : 1;
    // No sobrepasar el pico ~0.97 (evita saturacion/distorsion).
    if (peak > 0) gain = Math.min(gain, 0.97 / peak);
    // Nunca bajar una cancion a menos de la mitad: mejor un poco despareja
    // que "pasito" en pleno baile.
    return clamp(gain, 0.5, 4);
  }

  /**
   * Lo que el motor puede contar de si mismo, para el informe de fallos.
   *
   * El dato que mas dice es el RELOJ: si el motor esta «running» pero el reloj
   * no avanza entre dos informes, el sonido esta parado por debajo aunque todo
   * parezca correcto.
   */
  resumen(): string {
    const st = useStore.getState();
    const lineas = [
      `motor de sonido: ${this.ctx ? this.ctx.state : "sin crear todavia"}`,
      `frecuencia del motor: ${this.ctx ? this.ctx.sampleRate : "?"} Hz`,
      `reloj del motor: ${this.ctx ? this.ctx.currentTime.toFixed(2) : "?"} s`,
      `volumen general: ${Math.round(st.masterVolume * 100)}%`,
      `crossfader: ${st.crossfader.toFixed(2)} (0 = todo A, 1 = todo B)`,
    ];
    (["A", "B"] as DeckId[]).forEach((id) => {
      const d = this.decks?.[id];
      const e = st.decks[id];
      lineas.push(
        `deck ${id}: ${e.trackName || "(vacio)"} | sonando=${d?.playing ?? false}` +
          ` | posicion=${this.getPosition(id).toFixed(1)}s | velocidad=${(d?.rate ?? 1).toFixed(3)}`
      );
    });
    return lineas.join("\n");
  }

  // -------- Salud del motor de sonido --------

  /**
   * VIGILANTE DEL MOTOR DE SONIDO.
   *
   * POR QUE: WebKitGTK puede dejar el motor en «suspended» o en «interrupted»
   * (un estado propio suyo, fuera del estandar) cuando el aparato de sonido
   * cambia por debajo — por ejemplo al mandar el sonido a un parlante
   * Bluetooth, que trabaja a otra frecuencia y con mucho mas retardo. Cuando
   * eso pasa la musica se para EN SECO.
   *
   * Antes nadie vigilaba esto: `despertar()` mira el estado del motor solo al
   * darle play, asi que si se caia con la cancion ya sonando, la app no se
   * enteraba y no decia NADA. Se quedaba muda en mitad del evento y parecia
   * que el programa se habia colgado. Era el fallo reportado con Bluetooth.
   */
  private vigilarMotor(ctx: AudioContext): void {
    ctx.onstatechange = () => {
      if (ctx !== this.ctx) return; // motor viejo, ya reemplazado
      if (ctx.state === "running") return;
      const sonando = !!this.decks && (this.decks.A.playing || this.decks.B.playing);
      if (!sonando) return; // sin musica puesta, dormirse es lo normal
      void this.levantarMotor(ctx.state);
    };
  }

  /** Intenta que el sonido vuelva: primero reanudar, y si no, rehacer la conexion. */
  private async levantarMotor(estado: string): Promise<void> {
    if (this.levantando) return;
    this.levantando = true;
    const { showToast } = useStore.getState();
    showToast(`El sonido se paró (motor «${estado}»). Recuperando...`);
    try {
      try {
        await this.ctx?.resume();
      } catch (err) {
        console.error("[AudioEngine] no se pudo reanudar el motor", err);
      }
      if (this.ctx?.state === "running") {
        showToast("Sonido recuperado");
        return;
      }
      // Reanudar no bastó: la conexion con el sonido del sistema esta rota y
      // hay que hacerla de nuevo (la cancion sigue en memoria, no se pierde).
      await rehacerConexionDeSonido();
      // En variable aparte a proposito: `this.ctx` es OTRO objeto despues de
      // rehacer la conexion, y si no TypeScript cree que sigue sin arrancar.
      const estadoNuevo: string | undefined = this.ctx?.state;
      showToast(
        estadoNuevo === "running"
          ? "Sonido recuperado"
          : `El sonido no arranca (motor «${estadoNuevo}»). Revisa la salida de audio del equipo.`
      );
    } catch (err) {
      console.error("[AudioEngine] no se pudo recuperar el sonido", err);
      showToast(
        `No se pudo recuperar el sonido: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      this.levantando = false;
    }
  }

  /**
   * Comprueba cada pocos segundos que, con musica puesta, el sonido siga
   * saliendo de verdad por la salida elegida. Es la unica forma de enterarse
   * de que se corto por abajo: el parlante Bluetooth se desconecto, el aparato
   * se durmio, o el sistema movio el flujo por su cuenta. Nada de eso avisa al
   * navegador interno, asi que sin esto la app se queda muda sin decir nada.
   *
   * Solo INFORMA, no toca nada: una falsa alarma en mitad de un evento no
   * puede provocar un corte que no existia.
   */
  private vigilarSalida(): void {
    if (this.vigilante !== null) return;
    this.vigilante = window.setInterval(() => void this.revisarSalida(), 8000);
  }

  private async revisarSalida(): Promise<void> {
    const { audioSink, showToast } = useStore.getState();
    if (!audioSink || !this.decks) return;
    if (!this.decks.A.playing && !this.decks.B.playing) return;
    let problema: string | null = null;
    try {
      problema = await comprobarSalida(audioSink);
    } catch (err) {
      // Que falle la comprobacion no es que falle el sonido: no se alarma al
      // usuario por esto, pero queda en el registro.
      console.error("[AudioEngine] no se pudo comprobar la salida de audio", err);
      return;
    }
    if (!problema) {
      this.fallosSalida = 0;
      this.avisadoSalida = false;
      return;
    }
    // Se avisa a la SEGUNDA comprobacion seguida con problema: recien dado el
    // play la salida tarda un momento en arrancar y seria una falsa alarma.
    this.fallosSalida += 1;
    if (this.fallosSalida < 2 || this.avisadoSalida) return;
    this.avisadoSalida = true;
    showToast(`Puede que no se esté oyendo: ${problema}. Revisa «Salida de audio».`);
  }

  /**
   * Rehace la conexion con el sonido del sistema SIN perder lo que suena.
   *
   * POR QUE EXISTE: hay dos casos en los que la conexion actual ya no sirve y
   * no se puede arreglar desde dentro — (1) mandar el sonido a un parlante
   * Bluetooth, porque arrastrar el flujo que ya suena no aguanta el cambio de
   * frecuencia y de retardo (ver la cabecera de `lib/salidaAudio.ts`), y (2)
   * que WebKitGTK deje el motor «interrupted» y no quiera reanudar.
   *
   * COMO NO SE PIERDE LA CANCION: el audio decodificado (`AudioBuffer`) no
   * pertenece a ningun motor, asi que se reusa tal cual en el nuevo — no hay
   * que volver a leer ni decodificar el archivo. Lo unico que se rehace son
   * los nodos del grafo. Cada deck vuelve a arrancar en el segundo exacto en
   * el que iba.
   */
  async rehacerConexion(): Promise<void> {
    const viejo = this.ctx;
    if (!viejo || !this.decks) return;

    // En mitad de una transicion no: rehacer el grafo la dejaria a medias, con
    // el crossfader colgado donde estuviera y los dos decks sonando.
    if (this.mixAnim) {
      throw new Error(
        "hay una transición en marcha; espera a que termine y vuelve a intentarlo"
      );
    }
    // Con una cancion a medio cargar tampoco: la carga en curso escribiria en
    // el deck viejo y la cancion no llegaria a aparecer nunca.
    const { decks: estadoDecks } = useStore.getState();
    if (estadoDecks.A.loading || estadoDecks.B.loading) {
      throw new Error(
        "hay una canción cargando; espera a que termine y vuelve a intentarlo"
      );
    }

    const ids: DeckId[] = ["A", "B"];
    // Cerrar las rampas de velocidad ANTES de la foto: `plegarRampa()` deja la
    // velocidad y la posicion reales al dia, y sin eso la foto se llevaria la
    // velocidad con la que la rampa EMPEZO.
    ids.forEach((id) => this.cancelRateAnim(id));
    const fotos = ids.map((id) => {
      const d = this.decks![id];
      return {
        id,
        buffer: d.buffer,
        naturalBpm: d.naturalBpm,
        analisis: d.analisis,
        rate: d.rate,
        posicion: this.getPosition(id),
        sonaba: d.playing,
        fx: { ...d.fx.valores },
        volumen: d.volumeGain.gain.value,
        norm: d.normGain.gain.value,
        loadToken: d.loadToken,
      };
    });
    // Los buffers de los efectos tambien se reusan; sus nodos, no.
    const efectos = new Map<string, AudioBuffer | null>();
    this.efectos.forEach((e, k) => efectos.set(k, e.buffer));

    ids.forEach((id) => this.stopSource(id));
    this.efectos.clear();

    this.ctx = null;
    this.master = null;
    this.decks = null;
    try {
      await viejo.close();
    } catch (err) {
      // No es fatal: el motor nuevo se crea igual. Pero que quede dicho.
      console.error("[AudioEngine] no se pudo cerrar el motor viejo", err);
    }

    olvidarSalidaAplicada(); // el flujo de sonido es OTRO: hay que remandarlo
    this.ensure(); // motor y grafo nuevos (volumen general y crossfader incluidos)
    const ctx = this.ctx!;

    fotos.forEach((f) => {
      const d = this.decks![f.id];
      d.buffer = f.buffer;
      d.naturalBpm = f.naturalBpm;
      d.analisis = f.analisis;
      d.rate = f.rate;
      d.offset = f.posicion;
      d.loadToken = f.loadToken;
      d.normGain.gain.value = f.norm;
      d.volumeGain.gain.value = f.volumen;
      (Object.keys(f.fx) as FxKey[]).forEach((k) => this.setFx(f.id, k, f.fx[k]));
    });
    efectos.forEach((buffer, k) =>
      this.efectos.set(k, { buffer, cargando: null, source: null, gain: null })
    );

    if (ctx.state !== "running") {
      try {
        await ctx.resume();
      } catch (err) {
        console.error("[AudioEngine] el motor nuevo no quiso arrancar", err);
      }
    }

    // Reanudar cada deck donde iba.
    fotos.forEach((f) => {
      if (f.sonaba && f.buffer) this.startFrom(f.id, f.posicion);
    });

    // Solo AHORA existe de verdad el flujo de sonido (lo abre el navegador
    // interno al empezar a sonar): recien ahora se puede mandar a la cabina.
    await aplicarSalidaGuardada();
  }

  // -------- Transporte --------

  /** Arranca el motor de sonido si esta dormido. Devuelve false (y avisa) si no pudo. */
  private async despertar(): Promise<boolean> {
    // Antes, si esto fallaba se ignoraba el error y se seguia como si nada:
    // la app se marcaba "reproduciendo" pero no sonaba y el tiempo no avanzaba,
    // asi que parecia que el boton de play no hacia nada. Si el motor no
    // arranca hay que DECIRLO, no disimular.
    if (this.ctx && this.ctx.state !== "running") {
      try {
        await this.ctx.resume();
      } catch (err) {
        console.error("[AudioEngine] no se pudo reanudar el audio", err);
      }
    }
    if (this.ctx && this.ctx.state !== "running") {
      useStore
        .getState()
        .showToast(
          `No se pudo iniciar el sonido (motor «${this.ctx.state}»). Revisa la salida de audio del equipo.`
        );
      return false;
    }
    return true;
  }

  async play(id: DeckId): Promise<void> {
    const d = this.deck(id);
    if (!d.buffer || d.playing) return;
    if (!(await this.despertar())) return;

    // Asegurar la salida elegida: si el motor se durmio y rehizo su conexion
    // con el sonido del sistema, volvio sola a los parlantes del portatil.
    void aplicarSalidaGuardada();

    this.startFrom(id, d.offset);
    useStore.getState().patchDeck(id, { isPlaying: true });
  }

  /**
   * Pitido corto de prueba, para comprobar POR DONDE esta saliendo el sonido
   * sin tener que poner una cancion delante de la gente. Sale por el volumen
   * general, igual que la musica.
   */
  async probarSalida(): Promise<void> {
    this.ensure();
    const ctx = this.ctx!;
    if (ctx.state !== "running") {
      await ctx.resume();
    }
    if (ctx.state !== "running") {
      throw new Error(`el motor de sonido no arranco (está «${ctx.state}»)`);
    }

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = 440;
    osc.connect(g);
    g.connect(this.master!);

    // Entrada y salida suaves: un tono que arranca de golpe da un chasquido
    // seco, y en una cabina con parlantes grandes eso suena fatal.
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.25, t + 0.05);
    g.gain.setValueAtTime(0.25, t + 0.7);
    g.gain.linearRampToValueAtTime(0, t + 0.85);
    osc.start(t);
    osc.stop(t + 0.9);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
  }

  pause(id: DeckId): void {
    const d = this.deck(id);
    if (!d.playing) return;
    d.offset = this.getPosition(id);
    this.stopSource(id);
    d.playing = false;
    useStore.getState().patchDeck(id, { isPlaying: false });
  }

  togglePlay(id: DeckId): void {
    if (this.deck(id).playing) this.pause(id);
    else void this.play(id);
  }

  setVolume(id: DeckId, v: number): void {
    const d = this.deck(id);
    d.volumeGain.gain.value = clamp(v, 0, 1);
    useStore.getState().patchDeck(id, { volume: clamp(v, 0, 1) });
  }

  setMasterVolume(v: number): void {
    this.ensure();
    if (this.master) this.master.gain.value = clamp(v, 0, 1);
    useStore.getState().setMasterVolume(clamp(v, 0, 1));
  }

  /** Va a una posicion absoluta (segundos). */
  private seekTo(id: DeckId, seconds: number): void {
    const d = this.deck(id);
    if (!d.buffer) return;
    const pos = clamp(seconds, 0, d.buffer.duration);
    if (d.playing) {
      this.stopSource(id);
      this.startFrom(id, pos);
    } else {
      d.offset = pos;
    }
  }

  /** Salta a una fraccion (0..1) del total. */
  seekFraction(id: DeckId, frac: number): void {
    const d = this.deck(id);
    if (d.buffer) this.seekTo(id, frac * d.buffer.duration);
  }

  /** Adelanta/retrocede unos segundos (como mover el disco). */
  nudge(id: DeckId, seconds: number): void {
    this.seekTo(id, this.getPosition(id) + seconds);
  }

  /** Velocidad real en este instante (en mitad de una rampa va cambiando). */
  private rateActual(d: Deck): number {
    if (!d.rampa || !this.ctx) return d.rate;
    const t = Math.max(0, this.ctx.currentTime - d.rampa.t0);
    if (t >= d.rampa.dur) return d.rampa.r1;
    return d.rampa.r0 + (d.rampa.r1 - d.rampa.r0) * (t / d.rampa.dur);
  }

  /** Cierra la rampa en curso dejando la contabilidad (posicion, velocidad) al dia. */
  private plegarRampa(id: DeckId): void {
    const d = this.deck(id);
    if (!d.rampa || !this.ctx) return;
    const pos = this.getPosition(id);
    const r = this.rateActual(d);
    d.rampa = null;
    d.offset = pos;
    d.startCtxTime = this.ctx.currentTime;
    d.rate = r;
    if (d.source) {
      const p = d.source.playbackRate;
      p.cancelScheduledValues(this.ctx.currentTime);
      p.value = r;
    }
  }

  setRate(id: DeckId, rate: number): void {
    const d = this.deck(id);
    this.cancelRateAnim(id);
    if (d.playing && this.ctx) {
      // Rebasar la contabilidad de posicion para que no de un salto.
      d.offset = this.getPosition(id);
      d.startCtxTime = Math.max(d.startCtxTime, this.ctx.currentTime);
      d.rate = rate;
      if (d.source) d.source.playbackRate.value = rate;
    } else {
      d.rate = rate;
    }
    useStore.getState().patchDeck(id, { rate });
  }

  setNaturalBpm(id: DeckId, bpm: number | null): void {
    const d = this.deck(id);
    d.naturalBpm = bpm;
    // El primer golpe depende del BPM: se vuelve a buscar con el nuevo.
    if (d.buffer && d.analisis) {
      const a = d.analisis;
      let primerGolpe: number | null = null;
      if (bpm && bpm > 0) {
        const g = golpeEnTramo(d.buffer, bpm, a.silencioInicio, a.silencioInicio + 16);
        if (g !== null) {
          const periodo = 60 / bpm;
          let t = g;
          while (t - periodo >= a.silencioInicio) t -= periodo;
          primerGolpe = t;
        }
      }
      d.analisis = { ...a, primerGolpe };
    }
    useStore.getState().patchDeck(id, { bpm });
  }

  getPosition(id: DeckId): number {
    const d = this.decks?.[id];
    if (!d || !d.buffer) return 0;
    if (d.playing && this.ctx) {
      // Si la fuente esta programada para arrancar mas adelante, todavia esta en `offset`.
      const t = Math.max(0, this.ctx.currentTime - d.startCtxTime);
      let avance: number;
      if (d.rampa) {
        // Velocidad que cambia linealmente: el avance es el area bajo la rampa.
        const { r0, r1, dur } = d.rampa;
        avance = t < dur ? r0 * t + ((r1 - r0) * t * t) / (2 * dur) : ((r0 + r1) / 2) * dur + r1 * (t - dur);
      } else {
        avance = t * d.rate;
      }
      return clamp(d.offset + avance, 0, d.buffer.duration);
    }
    return d.offset;
  }
  getDuration(id: DeckId): number {
    return this.decks?.[id].buffer?.duration ?? 0;
  }
  isPlaying(id: DeckId): boolean {
    return this.decks?.[id].playing ?? false;
  }
  hasBuffer(id: DeckId): boolean {
    return !!this.decks?.[id].buffer;
  }
  getRate(id: DeckId): number {
    return this.decks?.[id].rate ?? 1;
  }
  getNaturalBpm(id: DeckId): number | null {
    return this.decks?.[id].naturalBpm ?? null;
  }
  getAnalisis(id: DeckId): AnalisisCancion | null {
    return this.decks?.[id].analisis ?? null;
  }
  /** Ultimo instante con sonido (duracion menos el silencio final). */
  getFinUtil(id: DeckId): number {
    const d = this.decks?.[id];
    return d ? this.finUtil(d) : 0;
  }

  // -------- Crossfader (corte lineal) --------

  applyCrossfader(x: number): void {
    if (!this.decks) return;
    // Corte lineal: en el CENTRO ambos decks al 100%; al mover hacia un lado, el
    // deck OPUESTO baja hasta 0. (A la izquierda solo suena A; a la derecha solo B.)
    this.decks.A.xfadeGain.gain.value = x <= 0.5 ? 1 : 2 * (1 - x);
    this.decks.B.xfadeGain.gain.value = x >= 0.5 ? 1 : 2 * x;
  }

  setCrossfader(x: number): void {
    const clamped = clamp(x, 0, 1);
    this.applyCrossfader(clamped);
    useStore.getState().setCrossfader(clamped);
  }

  // -------- Animacion de tempo (beatmatch gradual) --------

  private cancelRateAnim(id: DeckId): void {
    const a = this.rateAnim[id];
    if (a) {
      window.clearInterval(a.intervalo);
      window.clearTimeout(a.fin);
      this.rateAnim[id] = null;
      this.plegarRampa(id); // se queda con la velocidad que llevaba
      useStore.getState().patchDeck(id, { rate: this.deck(id).rate });
      a.resolver(false);
    }
  }

  /** Rampa lineal de velocidad en el reloj de audio. Resuelve true si termino, false si se cancelo. */
  private animateRate(id: DeckId, target: number, durationMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      this.cancelRateAnim(id);
      const d = this.deck(id);
      if (!this.ctx || !d.playing || !d.source) {
        d.rate = target;
        useStore.getState().patchDeck(id, { rate: target });
        resolve(true);
        return;
      }
      this.plegarRampa(id);
      const now = this.ctx.currentTime;
      const dur = durationMs / 1000;
      d.offset = this.getPosition(id);
      d.startCtxTime = now;
      d.rampa = { t0: now, r0: d.rate, r1: target, dur };
      const p = d.source.playbackRate;
      p.cancelScheduledValues(now);
      p.setValueAtTime(d.rate, now);
      p.linearRampToValueAtTime(target, now + dur);
      const intervalo = window.setInterval(() => {
        useStore.getState().patchDeck(id, { rate: this.rateActual(d) });
      }, 250);
      const fin = window.setTimeout(() => {
        window.clearInterval(intervalo);
        this.rateAnim[id] = null;
        this.plegarRampa(id);
        d.rate = target;
        useStore.getState().patchDeck(id, { rate: target });
        resolve(true);
      }, durationMs + 30);
      this.rateAnim[id] = { intervalo, fin, resolver: resolve };
    });
  }

  /** Crossfader en el instante t de la animacion en curso. */
  private crossfaderEn(a: NonNullable<typeof this.mixAnim>, ctxTime: number): number {
    const p = Math.min(1, Math.max(0, (ctxTime - a.t0) / a.dur));
    return a.x0 + (a.x1 - a.x0) * p;
  }

  private cancelCrossfaderAnim(): void {
    const a = this.mixAnim;
    if (!a || !this.ctx || !this.decks) return;
    window.clearInterval(a.intervalo);
    window.clearTimeout(a.fin);
    this.mixAnim = null;
    const now = this.ctx.currentTime;
    const x = this.crossfaderEn(a, now);
    this.decks.A.xfadeGain.gain.cancelScheduledValues(now);
    this.decks.B.xfadeGain.gain.cancelScheduledValues(now);
    this.setCrossfader(x); // se queda donde iba
    a.resolver(false);
  }

  /**
   * Mueve el crossfader de donde esta a `target` en `durationMs`, como una
   * curva programada en las ganancias (hilo de audio). Resuelve true si
   * termino, false si se cancelo.
   */
  private animateCrossfader(target: number, durationMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      this.cancelCrossfaderAnim();
      this.ensure();
      const ctx = this.ctx!;
      const decks = this.decks!;
      const x0 = useStore.getState().crossfader;
      const x1 = clamp(target, 0, 1);
      const dur = Math.max(0.05, durationMs / 1000);
      const t0 = ctx.currentTime + 0.02;
      // Curva de IGUAL POTENCIA (no el corte lineal del crossfader manual): la
      // que sale empieza a bajar desde el primer segundo y la que entra sube
      // suave, sin que el volumen total se hunda en el medio. Con el corte
      // lineal, la que salia se quedaba al 100 % media transicion y en el
      // evento sonaban "dos canciones encima" (queja del equipo, 2026-10-18).
      const N = 256;
      const ga = new Float32Array(N);
      const gb = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const x = x0 + (x1 - x0) * (i / (N - 1));
        ga[i] = Math.cos((x * Math.PI) / 2);
        gb[i] = Math.sin((x * Math.PI) / 2);
      }
      for (const [g, curva] of [[decks.A.xfadeGain.gain, ga], [decks.B.xfadeGain.gain, gb]] as const) {
        g.cancelScheduledValues(ctx.currentTime);
        g.setValueAtTime(curva[0], ctx.currentTime);
        g.setValueCurveAtTime(curva, t0, dur);
      }
      const a = { intervalo: 0, fin: 0, t0, x0, x1, dur, resolver: resolve };
      // Solo para la interfaz: el deslizador sigue a la curva.
      a.intervalo = window.setInterval(() => {
        useStore.getState().setCrossfader(this.crossfaderEn(a, ctx.currentTime));
      }, 100);
      a.fin = window.setTimeout(() => {
        window.clearInterval(a.intervalo);
        this.mixAnim = null;
        // Dejar las ganancias "sueltas" en el valor final (sin automatizacion pendiente).
        decks.A.xfadeGain.gain.cancelScheduledValues(ctx.currentTime);
        decks.B.xfadeGain.gain.cancelScheduledValues(ctx.currentTime);
        this.setCrossfader(x1);
        resolve(true);
      }, durationMs + 60);
      this.mixAnim = a;
    });
  }

  // -------- Transicion (la usan el boton MEZCLAR y el automix) --------

  /**
   * Velocidad a la que debe sonar `t` para ir al paso de `outBpm`, contando
   * dobles y mitades como el mismo ritmo (95 ≈ 190). null si no hay BPM.
   */
  private velocidadAlPaso(outBpm: number | null, inBpm: number | null): number | null {
    if (!outBpm || !inBpm) return null;
    let mejor: number | null = null;
    for (const k of [0.5, 1, 2]) {
      const r = outBpm / (inBpm * k);
      if (mejor === null || Math.abs(r - 1) < Math.abs(mejor - 1)) mejor = r;
    }
    return mejor;
  }

  /**
   * Pasa de `from` a `to` con transicion suave:
   *  1. iguala la velocidad de `to` al ritmo de `from` (si estan dentro del limite),
   *  2. arranca `to` en su primer golpe, exactamente en un golpe de `from`,
   *  3. mueve el crossfader durante `duracionSeg`,
   *  4. pausa `from` y devuelve `to` a su velocidad natural.
   */
  async transicion(from: DeckId, to: DeckId, op: OpcionesTransicion): Promise<MixResult> {
    this.ensure();
    const st = useStore.getState();
    const { settings } = st;
    const f = this.deck(from);
    const t = this.deck(to);
    if (!t.buffer) {
      return { ok: false, reason: `Carga una cancion en el Deck ${to} primero` };
    }
    if (st.autoMixing) {
      return { ok: false, reason: "Ya hay una mezcla en curso" };
    }
    if (!(await this.despertar())) {
      return { ok: false, reason: "El motor de sonido no arranca" };
    }

    // 1. Velocidad.
    const outBpm = f.playing && f.naturalBpm ? f.naturalBpm * f.rate : null;
    let rate = 1;
    let alinear = false;
    const r = this.velocidadAlPaso(outBpm, t.naturalBpm);
    if (r !== null) {
      if (Math.abs(r - 1) <= settings.maxTempoDiff) {
        rate = r;
        alinear = true;
      } else if (op.exigirCompatibles) {
        return { ok: false, reason: "Estas dos canciones no combinan (ritmos muy distintos)" };
      }
    }

    st.setAutoMixing(true);
    this.cancelRateAnim(to);
    this.stopSource(to);
    t.rate = rate;
    st.patchDeck(to, { rate });

    // 2. Donde y cuando arranca la nueva.
    const an = t.analisis;
    const offIn = alinear && an?.primerGolpe !== null && an?.primerGolpe !== undefined
      ? an.primerGolpe
      : this.inicioUtil(t);
    let when = this.ctx!.currentTime + 0.05;
    if (alinear && f.buffer && f.naturalBpm) {
      const pos = this.getPosition(from);
      // Golpe de la que suena, medido sobre su audio real alrededor de ahora.
      const g = siguienteGolpe(f.buffer, f.naturalBpm, pos + 0.12);
      if (g !== null) when = this.ctx!.currentTime + (g - pos) / f.rate;
    }
    this.startFrom(to, offIn, when);
    st.patchDeck(to, { isPlaying: true });

    // 3. Crossfader + cambio de graves (D2): la nueva entra SIN graves; entre el
    //    40 % y el 70 % del recorrido se intercambian (los de la que sale bajan,
    //    los de la nueva suben), para que nunca suenen dos bombos encima.
    //    Programado en el reloj de audio, como el crossfader.
    const dur = op.duracionSeg;
    const ahora = this.ctx!.currentTime;
    const SIN_GRAVES = -18;
    const gIn = t.fx.swapLow.gain;
    const gOut = f.fx.swapLow.gain;
    gIn.cancelScheduledValues(ahora);
    gIn.setValueAtTime(SIN_GRAVES, ahora);
    gIn.setValueAtTime(SIN_GRAVES, ahora + dur * 0.4);
    gIn.linearRampToValueAtTime(0, ahora + dur * 0.7);
    gOut.cancelScheduledValues(ahora);
    gOut.setValueAtTime(0, ahora);
    gOut.setValueAtTime(0, ahora + dur * 0.4);
    gOut.linearRampToValueAtTime(SIN_GRAVES, ahora + dur * 0.7);

    const targetX = to === "B" ? 1 : 0;
    const termino = await this.animateCrossfader(targetX, dur * 1000);
    if (!termino) {
      // Cancelada a medias: se deja todo como esta (quien cancelo toma el mando),
      // salvo el cambio de graves interno, que vuelve a neutro.
      this.resetSwap("A");
      this.resetSwap("B");
      return { ok: false, reason: "Mezcla cancelada" };
    }

    // 4. Cierre.
    this.pause(from);
    this.resetSwap(from); // si vuelven a darle play, suena normal
    if (rate !== 1 && settings.returnToNatural) {
      await this.animateRate(to, 1, 4000);
    }
    st.setAutoMixing(false);
    return { ok: true };
  }

  /** Boton MEZCLAR: transicion con la duracion de los ajustes. */
  autoMix(sourceId: DeckId, targetId: DeckId): Promise<MixResult> {
    return this.transicion(sourceId, targetId, {
      duracionSeg: useStore.getState().settings.transitionSec,
      exigirCompatibles: true,
    });
  }

  /** Devuelve el cambio de graves interno de un deck al neutro. */
  private resetSwap(id: DeckId): void {
    const g = this.deck(id).fx.swapLow.gain;
    const now = this.ctx!.currentTime;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(0, now, 0.05);
  }

  cancelMix(): void {
    this.cancelCrossfaderAnim();
    this.cancelRateAnim("A");
    this.cancelRateAnim("B");
    useStore.getState().setAutoMixing(false);
  }
}

export const engine = new AudioEngine();

// El cambio de salida (lib/salidaAudio.ts) necesita poder rehacer la conexion
// de sonido. Se registra aqui en vez de importar el motor alla, que crearia un
// import circular.
registrarRehacerConexion(() => engine.rehacerConexion());

