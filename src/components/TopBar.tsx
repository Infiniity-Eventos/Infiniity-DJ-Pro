import { useStore } from "../state/store";
import {
  midiConnect,
  pickAudioFiles,
  importTracks,
  ensureUnclassified,
  midiDisconnect,
  minimizeWindow,
  toggleFullscreen,
  quitApp,
} from "../lib/tauri";
import { EVENTO_BUSCAR_ACTUALIZACION } from "./UpdateModal";
import { reloadLibrary } from "../lib/library";
import { etiquetaSync } from "./SyncModal";

export function TopBar() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const lowPower = useStore((s) => s.lowPower);
  const setLowPower = useStore((s) => s.setLowPower);
  const lowPowerAuto = useStore((s) => s.lowPowerAuto);
  const musicRoot = useStore((s) => s.musicRoot);
  const midiConnected = useStore((s) => s.midiConnected);
  const midiPort = useStore((s) => s.midiPort);
  const setMidi = useStore((s) => s.setMidi);
  const showToast = useStore((s) => s.showToast);
  const setDownloaderOpen = useStore((s) => s.setDownloaderOpen);
  const sync = useStore((s) => s.sync);
  const setSyncOpen = useStore((s) => s.setSyncOpen);
  const etiqueta = etiquetaSync(sync);

  // Agregar canciones del computador: van a "Sin clasificar" y, con Sync, suben
  // al PC original y a las demas PC. Asi nadie toca el explorador de archivos.
  const agregarCanciones = async () => {
    if (!musicRoot) return;
    const rutas = await pickAudioFiles();
    if (rutas.length === 0) return;
    try {
      const dest = await ensureUnclassified(musicRoot);
      const [copiadas, saltadas] = await importTracks(rutas, dest);
      await reloadLibrary();
      useStore.getState().setSelectedFolder(dest);
      showToast(
        `${copiadas} canción(es) agregadas a Sin clasificar` +
          (saltadas > 0 ? ` · ${saltadas} saltadas (ya estaban o no son audio)` : "")
      );
    } catch (e) {
      showToast(`No se pudieron agregar: ${e}`);
    }
  };


  const toggleMidi = async () => {
    if (midiConnected) {
      await midiDisconnect();
      setMidi(false, null);
      showToast("Controladora desconectada");
      return;
    }
    try {
      const port = await midiConnect();
      setMidi(true, port);
      showToast(`Controladora conectada: ${port}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`${msg}. Conectala por USB: se conecta sola al detectarla.`);
    }
  };

  return (
    <div className="glass topbar">
      <span className="brand">Infiniity DJ</span>
      <span className="app-version" title="Versión instalada">v{__APP_VERSION__}</span>

      {/* Sin boton "Carpeta": la biblioteca es siempre la sincronizada (en el
          original, la carpeta madre). Pedido explicito: nada de carpetas locales. */}
      <button
        className={`btn no-drag ${etiqueta.clase}`}
        onClick={() => setSyncOpen(true)}
        title="Sincronización de la biblioteca entre las PC"
      >
        🔁 {etiqueta.texto}
      </button>
      <button
        className="btn no-drag"
        onClick={() => setDownloaderOpen(true)}
        title="Buscar y descargar canciones de YouTube"
      >
        ⬇️ YouTube
      </button>
      <button
        className="btn no-drag"
        onClick={agregarCanciones}
        disabled={!musicRoot}
        title="Copiar canciones de este computador a la biblioteca (van a Sin clasificar)"
      >
        ＋ Agregar canciones
      </button>
      {musicRoot && <span className="path-chip">{musicRoot}</span>}

      <span className="spacer" />

      <button
        className="btn no-drag"
        onClick={toggleMidi}
        title={
          midiConnected
            ? "Controladora conectada. Clic para desconectarla."
            : "Se conecta sola al enchufarla por USB. Clic para buscarla ahora."
        }
      >
        <span className={`midi-dot ${midiConnected ? "on" : "off"}`} />
        {midiConnected ? midiPort ?? "DDJ-200" : "DDJ-200"}
      </button>

      <button
        className={`btn no-drag ${lowPower ? "lowpower-on" : ""}`}
        onClick={() => setLowPower(!lowPower)}
        title={`Modo bajo consumo: ${lowPower ? "ACTIVADO" : "desactivado"}${lowPowerAuto ? " (automatico)" : ""}`}
      >
        ⚡
      </button>

      <button
        className="btn no-drag"
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        title={theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
      >
        {/* Texto, no simbolo: el sol de la fuente monocroma parecia un engranaje
            y el equipo creia que era "configuracion". */}
        {theme === "dark" ? "Claro" : "Oscuro"}
      </button>

      {/* Buscar actualizacion a mano. Existe porque si el aviso automatico no
          aparece, sin esto no hay forma de saber si es que no hay version
          nueva o es que la busqueda esta fallando. */}
      <button
        className="btn no-drag"
        onClick={() =>
          window.dispatchEvent(new CustomEvent(EVENTO_BUSCAR_ACTUALIZACION))
        }
        title="Buscar actualizacion"
      >
        ⬆️
      </button>

      {/* Boton de recarga: SOLO en desarrollo (no aparece en la app final). */}
      {import.meta.env.DEV && (
        <button
          className="btn no-drag"
          onClick={() => window.location.reload()}
          title="Recargar la app (solo desarrollo)"
        >
          🔄
        </button>
      )}

      <div className="win-controls no-drag">
        <button className="btn btn-icon" title="Minimizar" onClick={() => minimizeWindow()}>
          –
        </button>
        <button
          className="btn btn-icon"
          title="Pantalla completa"
          onClick={() => toggleFullscreen()}
        >
          ⛶
        </button>
        <button className="btn btn-icon" title="Salir" onClick={() => quitApp()}>
          ✕
        </button>
      </div>
    </div>
  );
}
