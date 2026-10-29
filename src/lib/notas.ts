import { notasLeer } from "./tauri";
import { useStore } from "../state/store";

/** Vuelve a leer las notas (llegan por Sync desde otras PC y se van cuando el original las atiende). */
export async function recargarNotas(): Promise<void> {
  const { musicRoot, setNotas } = useStore.getState();
  if (!musicRoot) return;
  try {
    setNotas(await notasLeer(musicRoot));
  } catch (err) {
    // Sin las notas la app funciona igual: solo no se ven las marcas.
    console.error("[notas] no se pudieron leer", err);
  }
}
