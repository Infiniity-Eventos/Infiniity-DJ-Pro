import { useEffect } from "react";
import { useStore } from "../state/store";
import { isTauri, mantenerDespierto } from "./tauri";

/**
 * Mientras suena musica (o el automix esta encendido), el portatil no se
 * suspende ni apaga la pantalla. Ver src-tauri/src/despierto.rs: el automix
 * mezclando solo es justo el caso en que nadie toca el raton, y el sistema lo
 * tomaba por "equipo quieto" (2026-10-28).
 */
export function useMantenerDespierto(): void {
  useEffect(() => {
    if (!isTauri()) return;
    let pedido: boolean | null = null;
    let avisado = false;

    const revisar = () => {
      const s = useStore.getState();
      const activo = s.decks.A.isPlaying || s.decks.B.isPlaying || s.automix.encendido;
      if (activo === pedido) return;
      pedido = activo;
      mantenerDespierto(activo)
        .then((r) => console.info(`[despierto] ${activo ? "activo" : "suelto"}: ${r}`))
        .catch((err) => {
          console.error("[despierto] el sistema no acepto mantener el equipo despierto:", err);
          // Una vez por sesion: si falla, falla igual cada vez.
          if (activo && !avisado) {
            avisado = true;
            s.showToast(
              "⚠ El portátil podría apagar la pantalla o dormirse con la música sonando. En la configuración de energía, pon «Nunca»."
            );
          }
        });
    };

    revisar();
    return useStore.subscribe(revisar);
  }, []);
}
