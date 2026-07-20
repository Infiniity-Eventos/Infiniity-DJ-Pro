/**
 * Motor de audio de Infiniity DJ (Web Audio API).
 *
 * Diseno pensado para GAMA BAJA:
 *  - Cada deck reproduce con un <audio> (MediaElement) que transmite el archivo
 *    desde el disco, en vez de cargarlo entero en memoria. Esto usa muy poca RAM
 *    incluso con WAV largos.
 *  - El cambio de tempo (beatmatch) se hace con `playbackRate` y
 *    `preservesPitch = false`: es practicamente gratis en CPU (como el pitch de
 *    un tornamesa), en vez del "time-stretch" que consume mucho.
 *  - Los volumenes se manejan con GainNodes (en el hilo de audio), asi la mezcla
 *    no se entrecorta aunque la interfaz este ocupada.
 *
 * Grafo por deck:  <audio> -> source -> volumeGain -> xfadeGain -> masterGain -> salida
 */

import { useStore, type DeckId } from "../state/store";

interface Deck {
  el: HTMLAudioElement;
  source: MediaElementAudioSourceNode | null;
  volumeGain: GainNode;
  xfadeGain: GainNode;
  naturalBpm: number | null;
}

export interface MixResult {
  ok: boolean;
  reason?: string;
}

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private decks: Record<DeckId, Deck> | null = null;
  private rateAnim: Record<DeckId, number | null> = { A: null, B: null };
  private mixRaf: number | null = null;

  /** Se debe llamar tras el primer gesto del usuario (requisito del navegador). */
  ensure(): void {
    if (this.ctx) return;
    const ctx = new AudioContext({ latencyHint: "playback" });
    const master = ctx.createGain();
    master.gain.value = useStore.getState().masterVolume;
    master.connect(ctx.destination);

    const makeDeck = (): Deck => {
      const el = new Audio();
      el.preload = "auto";
      el.crossOrigin = "anonymous";
      // Clave para el rendimiento: dejar que el tempo mueva el tono (como vinilo).
      (el as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = false;
      const volumeGain = ctx.createGain();
      const xfadeGain = ctx.createGain();
      volumeGain.connect(xfadeGain);
      xfadeGain.connect(master);
      return { el, source: null, volumeGain, xfadeGain, naturalBpm: null };
    };

    this.ctx = ctx;
    this.master = master;
    this.decks = { A: makeDeck(), B: makeDeck() };

    // Aplicar crossfader inicial.
    this.applyCrossfader(useStore.getState().crossfader);
  }

  private deck(id: DeckId): Deck {
    this.ensure();
    return this.decks![id];
  }

  /** Conecta el <audio> al grafo la primera vez que se reproduce. */
  private connectSource(id: DeckId): void {
    const d = this.deck(id);
    if (!d.source && this.ctx) {
      d.source = this.ctx.createMediaElementSource(d.el);
      d.source.connect(d.volumeGain);
    }
  }

  // -------- Carga y transporte --------

  load(id: DeckId, url: string, naturalBpm: number | null, trackName: string, trackPath: string): void {
    this.ensure();
    const d = this.deck(id);
    this.cancelRateAnim(id);
    d.el.src = url;
    d.el.playbackRate = 1;
    d.naturalBpm = naturalBpm;
    const { patchDeck } = useStore.getState();
    patchDeck(id, {
      trackPath,
      trackName,
      bpm: naturalBpm,
      isPlaying: false,
      rate: 1,
      duration: 0,
      loading: true,
    });
    const onMeta = () => {
      patchDeck(id, { duration: d.el.duration || 0, loading: false });
      d.el.removeEventListener("loadedmetadata", onMeta);
    };
    d.el.addEventListener("loadedmetadata", onMeta);
    d.el.addEventListener(
      "ended",
      () => patchDeck(id, { isPlaying: false }),
      { once: true }
    );
  }

  async play(id: DeckId): Promise<void> {
    this.ensure();
    const d = this.deck(id);
    if (!d.el.src) return;
    this.connectSource(id);
    if (this.ctx?.state === "suspended") await this.ctx.resume();
    try {
      await d.el.play();
      useStore.getState().patchDeck(id, { isPlaying: true });
    } catch {
      /* el navegador puede rechazar si no hubo gesto; se reintenta al tocar play */
    }
  }

  pause(id: DeckId): void {
    const d = this.deck(id);
    d.el.pause();
    useStore.getState().patchDeck(id, { isPlaying: false });
  }

  togglePlay(id: DeckId): void {
    const playing = !this.deck(id).el.paused;
    if (playing) this.pause(id);
    else void this.play(id);
  }

  setVolume(id: DeckId, v: number): void {
    const d = this.deck(id);
    d.volumeGain.gain.value = v;
    useStore.getState().patchDeck(id, { volume: v });
  }

  setMasterVolume(v: number): void {
    this.ensure();
    if (this.master) this.master.gain.value = v;
    useStore.getState().setMasterVolume(v);
  }

  /** Salta a una posicion (0..1 del total). */
  seekFraction(id: DeckId, frac: number): void {
    const d = this.deck(id);
    if (d.el.duration) d.el.currentTime = frac * d.el.duration;
  }

  /** Adelanta/retrocede unos segundos (como mover el disco). */
  nudge(id: DeckId, seconds: number): void {
    const d = this.deck(id);
    if (!d.el.duration) return;
    d.el.currentTime = Math.min(
      d.el.duration,
      Math.max(0, d.el.currentTime + seconds)
    );
  }

  setRate(id: DeckId, rate: number): void {
    const d = this.deck(id);
    d.el.playbackRate = rate;
    useStore.getState().patchDeck(id, { rate });
  }

  /** Actualiza el tempo natural (BPM) de un deck sin recargar la cancion. */
  setNaturalBpm(id: DeckId, bpm: number | null): void {
    this.deck(id).naturalBpm = bpm;
    useStore.getState().patchDeck(id, { bpm });
  }

  getPosition(id: DeckId): number {
    return this.decks ? this.decks[id].el.currentTime : 0;
  }
  getDuration(id: DeckId): number {
    return this.decks ? this.decks[id].el.duration || 0 : 0;
  }
  isPlaying(id: DeckId): boolean {
    return this.decks ? !this.decks[id].el.paused : false;
  }

  // -------- Crossfader (curva de igual potencia) --------

  applyCrossfader(x: number): void {
    if (!this.decks) return;
    const gA = Math.cos((x * Math.PI) / 2);
    const gB = Math.cos(((1 - x) * Math.PI) / 2);
    this.decks.A.xfadeGain.gain.value = gA;
    this.decks.B.xfadeGain.gain.value = gB;
  }

  setCrossfader(x: number): void {
    const clamped = Math.min(1, Math.max(0, x));
    this.applyCrossfader(clamped);
    useStore.getState().setCrossfader(clamped);
  }

  // -------- Animacion de tempo (para el beatmatch gradual) --------

  private cancelRateAnim(id: DeckId): void {
    if (this.rateAnim[id] !== null) {
      cancelAnimationFrame(this.rateAnim[id]!);
      this.rateAnim[id] = null;
    }
  }

  /** Lleva el playbackRate del deck desde su valor actual hasta `target`. */
  private animateRate(id: DeckId, target: number, durationMs: number): Promise<void> {
    return new Promise((resolve) => {
      this.cancelRateAnim(id);
      const d = this.deck(id);
      const start = d.el.playbackRate;
      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / durationMs);
        // suavizado (easeInOut)
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        const rate = start + (target - start) * e;
        d.el.playbackRate = rate;
        useStore.getState().patchDeck(id, { rate });
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

  /** Anima el crossfader de su posicion actual hasta `target` en durationMs. */
  private animateCrossfader(target: number, durationMs: number): Promise<void> {
    return new Promise((resolve) => {
      if (this.mixRaf !== null) cancelAnimationFrame(this.mixRaf);
      const start = useStore.getState().crossfader;
      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / durationMs);
        const x = start + (target - start) * p;
        this.setCrossfader(x);
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

  /**
   * Comprueba si dos decks se pueden beatmatchear dentro del limite de tempo.
   * Devuelve el factor de velocidad necesario para el deck que ENTRA, o null.
   */
  private matchRate(sourceId: DeckId, targetId: DeckId, maxDiff: number): number | null {
    const s = this.deck(sourceId);
    const t = this.deck(targetId);
    if (!s.naturalBpm || !t.naturalBpm) return null;
    const sourceEffective = s.naturalBpm * s.el.playbackRate;
    const rate = sourceEffective / t.naturalBpm;
    if (Math.abs(rate - 1) > maxDiff) return null; // ritmos muy distintos
    return rate;
  }

  /**
   * Ejecuta la mezcla automatica del deck `sourceId` (el que suena) hacia
   * `targetId` (el que entra).
   */
  async autoMix(sourceId: DeckId, targetId: DeckId): Promise<MixResult> {
    this.ensure();
    const st = useStore.getState();
    const { settings } = st;

    const t = this.deck(targetId);
    if (!t.el.src) {
      return { ok: false, reason: `Carga una cancion en el Deck ${targetId} primero` };
    }
    if (st.autoMixing) {
      return { ok: false, reason: "Ya hay una mezcla en curso" };
    }

    const bothBpm = this.deck(sourceId).naturalBpm && t.naturalBpm;
    const rate = bothBpm ? this.matchRate(sourceId, targetId, settings.maxTempoDiff) : null;

    if (bothBpm && rate === null) {
      // Ritmos incompatibles: por decision de diseno, NO forzamos.
      return {
        ok: false,
        reason: "Estas dos canciones no combinan (ritmos muy distintos)",
      };
    }

    st.setAutoMixing(true);
    const durationMs = settings.transitionSec * 1000;
    const targetX = targetId === "B" ? 1 : 0;

    // Arrancar el deck que entra.
    if (rate !== null) {
      t.el.playbackRate = 1; // arranca en su tempo natural...
    }
    await this.play(targetId);

    // Ajustar el tempo del que entra de forma GRADUAL (no un salto brusco).
    const promises: Promise<void>[] = [];
    if (rate !== null) {
      const alignMs = Math.min(2500, durationMs * 0.4);
      promises.push(this.animateRate(targetId, rate, alignMs));
    }
    // Cruzar los volumenes durante toda la transicion.
    promises.push(this.animateCrossfader(targetX, durationMs));
    await Promise.all(promises);

    // Terminada la transicion: apagar el deck anterior.
    this.pause(sourceId);

    // Opcional: la cancion nueva vuelve poco a poco a su tempo natural.
    if (rate !== null && settings.returnToNatural) {
      await this.animateRate(targetId, 1, 4000);
    }

    st.setAutoMixing(false);
    return { ok: true };
  }

  /** Cancela una mezcla en curso (deja todo donde este). */
  cancelMix(): void {
    if (this.mixRaf !== null) cancelAnimationFrame(this.mixRaf);
    this.mixRaf = null;
    this.cancelRateAnim("A");
    this.cancelRateAnim("B");
    useStore.getState().setAutoMixing(false);
  }
}

export const engine = new AudioEngine();
