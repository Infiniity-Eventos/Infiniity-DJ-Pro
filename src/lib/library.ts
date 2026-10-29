/** Utilidades de alto nivel para (re)cargar la biblioteca en el estado global. */

import { ensureUnclassified, readLibrary } from "./tauri";
import { useStore } from "../state/store";
import { recargarNotas } from "./notas";

export async function reloadLibrary(): Promise<void> {
  const { musicRoot, setLibrary, setLibraryLoading, showToast } = useStore.getState();
  if (!musicRoot) return;
  setLibraryLoading(true);
  try {
    // Garantiza que exista la bandeja "Sin clasificar".
    await ensureUnclassified(musicRoot).catch(() => {});
    const lib = await readLibrary(musicRoot);
    setLibrary(lib);
    void recargarNotas();
  } catch {
    showToast("No se pudo leer la carpeta de musica");
  } finally {
    setLibraryLoading(false);
  }
}
