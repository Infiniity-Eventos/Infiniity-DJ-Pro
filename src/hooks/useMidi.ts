import { useEffect } from "react";
import { onMidiControl, onMidiStatus } from "../lib/tauri";
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
      // Perillas de efectos: siempre, incluso con el automix encendido (S8 de la guia de Efectos).
      if (ev.action === "graves" || ev.action === "medios" || ev.action === "agudos" || ev.action === "filtro") {
        engine.setFx(deckId, ev.action, ev.value);
        return;
      }
      // Con el automix encendido la controladora tampoco manda sobre los decks
      // ni el crossfader (D6). Se avisa solo con los botones, no con cada
      // movimiento de un fader (seria un aviso por milisegundo).
      if (useStore.getState().automix.encendido) {
        if (ev.action === "play" || ev.action === "cue") {
          if (ev.value > 0) useStore.getState().showAvisoCentral("Para mezclar tú mismo, apaga el automix");
        }
        return;
      }
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
          engine.empujar(deckId, ev.value);
          break;
        default:
          break;
      }
    }).then((fn) => {
      unlisten = fn;
    });
    // Conexion/desconexion automatica: reflejarla en el boton y avisar.
    let unlistenStatus: (() => void) | undefined;
    onMidiStatus((s) => {
      const { setMidi, showToast } = useStore.getState();
      setMidi(s.connected, s.port);
      showToast(
        s.connected
          ? `Controladora conectada: ${s.port ?? "DDJ-200"}`
          : "Controladora desconectada. Revisa el cable; la sigo buscando."
      );
    }).then((fn) => {
      unlistenStatus = fn;
    });
    return () => {
      if (unlisten) unlisten();
      if (unlistenStatus) unlistenStatus();
    };
  }, []);
}
