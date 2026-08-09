/**
 * Descargas de YouTube en SEGUNDO PLANO.
 *
 * Vive fuera de los componentes para que la descarga siga aunque cierres el
 * buscador y sigas mezclando. Si falla (p. ej. YouTube limita con un 429), la
 * descarga NO desaparece: queda con un botón de "Reintentar" la MISMA canción,
 * sin tener que buscarla de nuevo. Al terminar bien: recarga la biblioteca, te
 * lleva a "Sin clasificar" y marca la canción para que titile.
 */
import { useStore } from "../state/store";
import { ytdlDownload, ensureUnclassified } from "./tauri";
import { reloadLibrary } from "./library";

let counter = 0;
export const nextDownloadId = (seed?: string) => seed || `dl-${++counter}`;

async function runDownload(id: string, url: string, title: string): Promise<void> {
  const st = useStore.getState();
  if (!st.musicRoot) {
    st.showToast("Primero elige una carpeta de música");
    st.removeDownload(id);
    return;
  }
  try {
    const dest = await ensureUnclassified(st.musicRoot);
    const path = await ytdlDownload(url, dest, id);
    await reloadLibrary();
    const s = useStore.getState();
    s.setSelectedFolder(dest);
    s.setHighlightTrack(path);
    s.showToast(`✅ Lista: ${path.split("/").pop() ?? title}`);
    s.removeDownload(id);
  } catch (e) {
    // NO la quitamos: la dejamos con error + botón de reintentar.
    useStore.getState().updateDownload(id, {
      status: "error",
      stage: "error",
      errorMsg: String(e),
    });
  }
}

export async function startDownload(url: string, id: string, title: string): Promise<void> {
  const st = useStore.getState();
  if (!st.musicRoot) {
    st.showToast("Primero elige una carpeta de música");
    return;
  }
  const existing = st.downloads.find((d) => d.id === id);
  if (existing && existing.status === "downloading") {
    st.showToast("Esa canción ya se está descargando");
    return;
  }
  st.addDownload({ id, url, title, percent: 0, stage: "descargando", status: "downloading" });
  st.showToast(`⬇️ Descargando en segundo plano: ${title}`);
  await runDownload(id, url, title);
}

/** Reintenta una descarga que falló, con los MISMOS datos (sin volver a buscar). */
export function retryDownload(id: string): void {
  const d = useStore.getState().downloads.find((x) => x.id === id);
  if (!d) return;
  useStore.getState().updateDownload(id, {
    status: "downloading",
    stage: "descargando",
    percent: 0,
    errorMsg: undefined,
  });
  void runDownload(id, d.url, d.title);
}
