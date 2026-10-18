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

/**
 * Cola: como maximo DOS descargas a la vez. Pidieron bajar varias canciones
 * seguidas en pleno evento; si todas arrancan juntas, cada una es un yt-dlp +
 * un ffmpeg convirtiendo, y en un portatil de 2 nucleos eso le quita CPU a la
 * mezcla que esta sonando. Las demas esperan "en cola" y arrancan solas.
 */
const MAX_A_LA_VEZ = 2;
let activas = 0;
const cola: Array<{ id: string; url: string; title: string }> = [];

function siguienteDeLaCola(): void {
  while (activas < MAX_A_LA_VEZ && cola.length > 0) {
    const d = cola.shift()!;
    // Pudo haberse quitado de la lista mientras esperaba (p. ej. reintento).
    if (!useStore.getState().downloads.some((x) => x.id === d.id)) continue;
    activas++;
    void runDownload(d.id, d.url, d.title).finally(() => {
      activas--;
      siguienteDeLaCola();
    });
  }
}

function encolar(id: string, url: string, title: string): void {
  useStore.getState().updateDownload(id, { stage: "en cola", percent: 0 });
  cola.push({ id, url, title });
  siguienteDeLaCola();
}

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
  st.addDownload({ id, url, title, percent: 0, stage: "en cola", status: "downloading" });
  st.showToast(`⬇️ En cola: ${title}`);
  encolar(id, url, title);
}

/** Reintenta una descarga que falló, con los MISMOS datos (sin volver a buscar). */
export function retryDownload(id: string): void {
  const d = useStore.getState().downloads.find((x) => x.id === id);
  if (!d) return;
  useStore.getState().updateDownload(id, {
    status: "downloading",
    stage: "en cola",
    percent: 0,
    errorMsg: undefined,
  });
  encolar(id, d.url, d.title);
}
