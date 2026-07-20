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

export function TopBar() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const musicRoot = useStore((s) => s.musicRoot);
  const setMusicRoot = useStore((s) => s.setMusicRoot);
  const midiConnected = useStore((s) => s.midiConnected);
  const midiPort = useStore((s) => s.midiPort);
  const setMidi = useStore((s) => s.setMidi);
  const showToast = useStore((s) => s.showToast);

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

      <button className="btn no-drag" onClick={changeFolder} title="Cambiar carpeta de musica">
        📁 Carpeta
      </button>
      {musicRoot && <span className="path-chip">{musicRoot}</span>}

      <span className="spacer" />

      <button className="btn no-drag" onClick={toggleMidi} title="Conectar la DDJ-200">
        <span className={`midi-dot ${midiConnected ? "on" : "off"}`} />
        {midiConnected ? midiPort ?? "DDJ-200" : "DDJ-200"}
      </button>

      <button
        className="btn no-drag"
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        title="Cambiar tema claro/oscuro"
      >
        {theme === "dark" ? "☀️" : "🌙"}
      </button>

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
