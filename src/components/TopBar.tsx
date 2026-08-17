import { useStore } from "../state/store";
import {
  pickFolder,
  midiConnect,
  midiDisconnect,
  minimizeWindow,
  toggleFullscreen,
  quitApp,
} from "../lib/tauri";
import { reloadLibrary } from "../lib/library";
import { EVENTO_BUSCAR_ACTUALIZACION } from "./UpdateModal";

export function TopBar() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const lowPower = useStore((s) => s.lowPower);
  const setLowPower = useStore((s) => s.setLowPower);
  const musicRoot = useStore((s) => s.musicRoot);
  const setMusicRoot = useStore((s) => s.setMusicRoot);
  const midiConnected = useStore((s) => s.midiConnected);
  const midiPort = useStore((s) => s.midiPort);
  const setMidi = useStore((s) => s.setMidi);
  const showToast = useStore((s) => s.showToast);
  const setDownloaderOpen = useStore((s) => s.setDownloaderOpen);

  const changeFolder = async () => {
    const folder = await pickFolder();
    if (folder) {
      setMusicRoot(folder);
      await reloadLibrary();
      showToast("Carpeta de musica actualizada");
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
      showToast(e instanceof Error ? e.message : "No se encontro la DDJ-200");
    }
  };

  return (
    <div className="glass topbar">
      <span className="brand">Infiniity DJ</span>
      <span className="app-version" title="Versión instalada">v{__APP_VERSION__}</span>

      <button className="btn no-drag" onClick={changeFolder} title="Cambiar carpeta de musica">
        📁 Carpeta
      </button>
      <button
        className="btn no-drag"
        onClick={() => setDownloaderOpen(true)}
        title="Buscar y descargar canciones de YouTube"
      >
        ⬇️ YouTube
      </button>
      {musicRoot && <span className="path-chip">{musicRoot}</span>}

      <span className="spacer" />

      <button className="btn no-drag" onClick={toggleMidi} title="Conectar la DDJ-200">
        <span className={`midi-dot ${midiConnected ? "on" : "off"}`} />
        {midiConnected ? midiPort ?? "DDJ-200" : "DDJ-200"}
      </button>

      <button
        className={`btn no-drag ${lowPower ? "lowpower-on" : ""}`}
        onClick={() => setLowPower(!lowPower)}
        title={lowPower ? "Modo bajo consumo: ACTIVADO" : "Modo bajo consumo: desactivado"}
      >
        ⚡
      </button>

      <button
        className="btn no-drag"
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        title="Cambiar tema claro/oscuro"
      >
        {theme === "dark" ? "☀️" : "🌙"}
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
