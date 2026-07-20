import { useEffect } from "react";
import { onMidiControl } from "../lib/tauri";
import { engine } from "../audio/AudioEngine";
import { useStore, type DeckId } from "../state/store";

/**
 * Escucha los eventos que llegan de la controladora DDJ-200 (via Rust) y los
 * traduce a acciones del motor de audio.
 */
export function useMidi() {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onMidiControl((ev) => {
      const deckId: DeckId = ev.deck === 1 ? "B" : "A";
      switch (ev.action) {
        case "play":
          if (ev.value > 0) engine.togglePlay(deckId);
          break;
        case "cue":
          if (ev.value > 0) engine.seekFraction(deckId, 0);
          break;
        case "volume":
          engine.setVolume(deckId, ev.value);
          break;
        case "crossfader":
          engine.setCrossfader(ev.value);
          break;
        case "tempo": {
          // El slider de tempo mueve la velocidad dentro del limite permitido.
          const maxDiff = useStore.getState().settings.maxTempoDiff;
          engine.setRate(deckId, 1 - maxDiff + ev.value * 2 * maxDiff);
          break;
        }
        case "jog":
          engine.nudge(deckId, ev.value * 0.05);
          break;
        default:
          break;
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, []);
}
