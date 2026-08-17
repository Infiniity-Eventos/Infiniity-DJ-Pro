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
 * RENDIMIENTO/RAM: cada deck mantiene UN AudioBuffer decodificado (~80MB por
 * cancion). Maximo 2 a la vez; al cargar otra cancion en un deck, el buffer
 * anterior queda libre para el recolector de basura.
 *
 * Grafo por deck:  BufferSource -> volumeGain -> xfadeGain -> master -> salida
 */

import { useStore, type DeckId } from "../state/store";
import { readMediaBytes } from "../lib/tauri";

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
  startCtxTime: number; // ctx.currentTime cuando arranco la reproduccion actual
  playing: boolean;
  endedGuard: boolean; // true cuando nosotros paramos la fuente (para ignorar onended)
  loadToken: number; // identifica la carga vigente (descarta cargas viejas)
}

export interface MixResult {
  ok: boolean;
  reason?: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private decks: Record<DeckId, Deck> | null = null;
  private rateAnim: Record<DeckId, number | null> = { A: null, B: null };
  private mixRaf: number | null = null;
  private tokenSeq = 0;

  ensure(): void {
    if (this.ctx) return;
    const ctx = new AudioContext({ latencyHint: "playback" });
    const master = ctx.createGain();
    master.gain.value = useStore.getState().masterVolume;
    master.connect(ctx.destination);

    const makeDeck = (): Deck => {
      const normGain = ctx.createGain();
      const volumeGain = ctx.createGain();
      const xfadeGain = ctx.createGain();
      normGain.connect(volumeGain);
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
      };
    };

    this.ctx = ctx;
    this.master = master;
    this.decks = { A: makeDeck(), B: makeDeck() };
    this.applyCrossfader(useStore.getState().crossfader);
  }

  private deck(id: DeckId): Deck {
    this.ensure();
    return this.decks![id];
  }

  /** Detiene la fuente actual sin marcar "fin de cancion". */
  private stopSource(id: DeckId): void {
    const d = this.deck(id);
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

  /** Crea y arranca una fuente desde `offset` segundos. */
  private startFrom(id: DeckId, offset: number): void {
    const d = this.deck(id);
    if (!d.buffer || !this.ctx) return;
    const off = clamp(offset, 0, Math.max(0, d.buffer.duration - 0.02));
    const src = this.ctx.createBufferSource();
    src.buffer = d.buffer;
    src.playbackRate.value = d.rate;
    src.connect(d.normGain);
    d.endedGuard = false;
    src.onended = () => {
      if (d.endedGuard) return; // lo paramos nosotros (pausa/seek/carga)
      // Fin natural de la cancion.
      d.playing = false;
      d.offset = 0;
      useStore.getState().patchDeck(id, { isPlaying: false });
    };
    src.start(0, off);
    d.source = src;
    d.offset = off;
    d.startCtxTime = this.ctx.currentTime;
    d.playing = true;
  }

  // -------- Carga --------

  async load(id: DeckId, path: string, naturalBpm: number | null, trackName: string): Promise<void> {
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
      return;
    }
    if (d.loadToken !== token) return; // se cargo otra cancion mientras leiamos

    let buffer: AudioBuffer;
    try {
      buffer = await conLimite(this.ctx!.decodeAudioData(bytes), 60000, "decodificar el audio");
    } catch (err) {
      if (d.loadToken === token) {
        patchDeck(id, { loading: false });
        useStore.getState().showToast(`No se pudo decodificar: ${trackName} (${err})`);
      }
      console.error("[AudioEngine.load] decodeAudioData fallo", err);
      return;
    }
    if (d.loadToken !== token) return; // llego tarde: descartar

    d.buffer = buffer;
    d.offset = 0;
    d.normGain.gain.value = this.computeNormGain(buffer);
    patchDeck(id, { duration: buffer.duration, loading: false });
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
    const REF_RMS = 0.1; // objetivo de sonoridad (~-20 dBFS)
    let gain = rms > 0.0001 ? REF_RMS / rms : 1;
    // No sobrepasar el pico ~0.97 (evita saturacion/distorsion).
    if (peak > 0) gain = Math.min(gain, 0.97 / peak);
    return clamp(gain, 0.25, 4);
  }

  // -------- Transporte --------

  async play(id: DeckId): Promise<void> {
    const d = this.deck(id);
    if (!d.buffer || d.playing) return;
    // Arrancar el motor de sonido si esta dormido.
    //
    // Antes, si esto fallaba se ignoraba el error y se seguia como si nada:
    // la app se marcaba "reproduciendo" pero no sonaba y el tiempo no avanzaba,
    // asi que parecia que el boton de play no hacia nada. Si el motor no
    // arranca hay que DECIRLO, no disimular.
    if (this.ctx && this.ctx.state !== "running") {
      try {
        await this.ctx.resume();
      } catch (err) {
        console.error("[AudioEngine.play] no se pudo reanudar el audio", err);
      }
    }
    if (this.ctx && this.ctx.state !== "running") {
      useStore
        .getState()
        .showToast(
          `No se pudo iniciar el sonido (motor «${this.ctx.state}»). Revisa la salida de audio del equipo.`
        );
      return;
    }

    this.startFrom(id, d.offset);
    useStore.getState().patchDeck(id, { isPlaying: true });
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

  setRate(id: DeckId, rate: number): void {
    const d = this.deck(id);
    if (d.playing) {
      // Rebasar la contabilidad de posicion para que no de un salto.
      d.offset = this.getPosition(id);
      d.startCtxTime = this.ctx!.currentTime;
      d.rate = rate;
      if (d.source) d.source.playbackRate.value = rate;
    } else {
      d.rate = rate;
    }
    useStore.getState().patchDeck(id, { rate });
  }

  setNaturalBpm(id: DeckId, bpm: number | null): void {
    this.deck(id).naturalBpm = bpm;
    useStore.getState().patchDeck(id, { bpm });
  }

  getPosition(id: DeckId): number {
    const d = this.decks?.[id];
    if (!d || !d.buffer) return 0;
    if (d.playing && this.ctx) {
      const pos = d.offset + (this.ctx.currentTime - d.startCtxTime) * d.rate;
      return clamp(pos, 0, d.buffer.duration);
    }
    return d.offset;
  }
  getDuration(id: DeckId): number {
    return this.decks?.[id].buffer?.duration ?? 0;
  }
  isPlaying(id: DeckId): boolean {
    return this.decks?.[id].playing ?? false;
  }

  // -------- Crossfader (curva de igual potencia) --------

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
    if (this.rateAnim[id] !== null) {
      cancelAnimationFrame(this.rateAnim[id]!);
      this.rateAnim[id] = null;
    }
  }

  private animateRate(id: DeckId, target: number, durationMs: number): Promise<void> {
    return new Promise((resolve) => {
      this.cancelRateAnim(id);
      const start = this.deck(id).rate;
      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / durationMs);
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        this.setRate(id, start + (target - start) * e);
        if (p < 1) {
          this.rateAnim[id] = requestAnimationFrame(step);
        } else {
          this.rateAnim[id] = null;
          resolve();
        }
      };
      this.rateAnim[id] = requestAnimationFrame(step);
    });
  }

  private animateCrossfader(target: number, durationMs: number): Promise<void> {
    return new Promise((resolve) => {
      if (this.mixRaf !== null) cancelAnimationFrame(this.mixRaf);
      const start = useStore.getState().crossfader;
      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / durationMs);
        this.setCrossfader(start + (target - start) * p);
        if (p < 1) {
          this.mixRaf = requestAnimationFrame(step);
        } else {
          this.mixRaf = null;
          resolve();
        }
      };
      this.mixRaf = requestAnimationFrame(step);
    });
  }

  // -------- Mezcla inteligente --------

  private matchRate(sourceId: DeckId, targetId: DeckId, maxDiff: number): number | null {
    const s = this.deck(sourceId);
    const t = this.deck(targetId);
    if (!s.naturalBpm || !t.naturalBpm) return null;
    const sourceEffective = s.naturalBpm * s.rate;
    const rate = sourceEffective / t.naturalBpm;
    if (Math.abs(rate - 1) > maxDiff) return null;
    return rate;
  }

  async autoMix(sourceId: DeckId, targetId: DeckId): Promise<MixResult> {
    this.ensure();
    const st = useStore.getState();
    const { settings } = st;

    const t = this.deck(targetId);
    if (!t.buffer) {
      return { ok: false, reason: `Carga una cancion en el Deck ${targetId} primero` };
    }
    if (st.autoMixing) {
      return { ok: false, reason: "Ya hay una mezcla en curso" };
    }

    const bothBpm = this.deck(sourceId).naturalBpm && t.naturalBpm;
    const rate = bothBpm ? this.matchRate(sourceId, targetId, settings.maxTempoDiff) : null;

    if (bothBpm && rate === null) {
      return { ok: false, reason: "Estas dos canciones no combinan (ritmos muy distintos)" };
    }

    st.setAutoMixing(true);
    const durationMs = settings.transitionSec * 1000;
    const targetX = targetId === "B" ? 1 : 0;

    if (rate !== null) this.setRate(targetId, 1); // arranca en su tempo natural
    await this.play(targetId);

    const promises: Promise<void>[] = [];
    if (rate !== null) {
      const alignMs = Math.min(2500, durationMs * 0.4);
      promises.push(this.animateRate(targetId, rate, alignMs));
    }
    promises.push(this.animateCrossfader(targetX, durationMs));
    await Promise.all(promises);

    this.pause(sourceId);

    if (rate !== null && settings.returnToNatural) {
      await this.animateRate(targetId, 1, 4000);
    }

    st.setAutoMixing(false);
    return { ok: true };
  }

  cancelMix(): void {
    if (this.mixRaf !== null) cancelAnimationFrame(this.mixRaf);
    this.mixRaf = null;
    this.cancelRateAnim("A");
    this.cancelRateAnim("B");
    useStore.getState().setAutoMixing(false);
  }
}

export const engine = new AudioEngine();
