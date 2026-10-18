import { useEffect } from "react";
import { useStore } from "../state/store";
import { syncEstado, syncMusica, isTauri } from "../lib/tauri";
import { reloadLibrary } from "../lib/library";

/**
 * Mantiene al día el estado de la sincronización (ver src-tauri/src/sync.rs):
 * - pregunta a Rust cada 3 s y lo deja en el store (para el botón Sync y el panel);
 * - en modo EQUIPO fija la biblioteca a la carpeta sincronizada (no hay selector);
 * - avisa a Rust cuando empieza/termina de sonar un deck (con música se frena);
 * - una vez por sesión, si faltan canciones por recibir, abre el aviso para que
 *   la persona autorice (es ella quien decide cuándo sincronizar).
 */
export function useSync() {
  useEffect(() => {
    if (!isTauri()) return;
    let vivo = true;
    let avisado = false;
    // Mientras llegan (o salen) canciones por Sync, la lista en pantalla se
    // queda vieja: se recarga sola cuando cambia lo pendiente, como mucho cada
    // 15 s, y una vez mas al terminar. Antes habia que cerrar y abrir.
    let pendientesAntes = -1;
    let ultimaRecarga = 0;
    const tick = async () => {
      try {
        const e = await syncEstado();
        if (!vivo) return;
        const st = useStore.getState();
        st.setSync(e);
        const movimiento = e.pendientes + e.por_subir;
        if (e.rol !== "ninguno" && pendientesAntes !== -1 && movimiento !== pendientesAntes) {
          const ahora = Date.now();
          if (movimiento === 0 || ahora - ultimaRecarga > 15000) {
            ultimaRecarga = ahora;
            await reloadLibrary();
          }
        }
        pendientesAntes = movimiento;
        if (e.rol !== "ninguno") {
          // La biblioteca es FIJA: la carpeta sincronizada (equipo) o la carpeta
          // madre (original). Nadie la cambia desde la interfaz.
          if (st.musicRoot !== e.raiz) {
            st.setMusicRoot(e.raiz);
            await reloadLibrary();
          }
        }
        if (e.rol === "equipo") {
          if (!avisado && e.activo && e.pendientes > 0 && !e.autorizado) {
            avisado = true;
            st.setSyncAviso(true);
          }
        }
      } catch (err) {
        console.error("[sync] no se pudo leer el estado", err);
      }
    };
    void tick();
    const id = window.setInterval(tick, 3000);
    return () => {
      vivo = false;
      window.clearInterval(id);
    };
  }, []);

  // Música sonando -> frenar la sincronización (y avisarlo en el botón Sync).
  const sonando = useStore((s) => s.decks.A.isPlaying || s.decks.B.isPlaying);
  useEffect(() => {
    if (!isTauri()) return;
    const rol = useStore.getState().sync?.rol;
    if (rol !== "equipo") return;
    syncMusica(sonando).catch((err) => console.error("[sync] no se pudo avisar la música", err));
  }, [sonando]);
}
