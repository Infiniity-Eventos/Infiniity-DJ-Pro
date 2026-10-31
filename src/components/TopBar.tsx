import { useState } from "react";
import { useStore } from "../state/store";
import {
  midiConnect,
  pickAudioFiles,
  importTracks,
  importFolder,
  pickFolder,
  ensureUnclassified,
  midiDisconnect,
  minimizeWindow,
  toggleFullscreen,
  quitApp,
} from "../lib/tauri";
import { EVENTO_BUSCAR_ACTUALIZACION } from "./UpdateModal";
import { reloadLibrary } from "../lib/library";
import { etiquetaSync } from "./SyncModal";
import { IconEngranaje, IconInfinito } from "./Icons";

export function TopBar() {
  const musicRoot = useStore((s) => s.musicRoot);
  const midiConnected = useStore((s) => s.midiConnected);
  const midiPort = useStore((s) => s.midiPort);
  const setMidi = useStore((s) => s.setMidi);
  const showToast = useStore((s) => s.showToast);
  const sync = useStore((s) => s.sync);
  const setSyncOpen = useStore((s) => s.setSyncOpen);
  const etiqueta = etiquetaSync(sync);
  const setAudioModalOpen = useStore((s) => s.setAudioModalOpen);

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

  // Agregar una carpeta entera: se escanea con todas sus subcarpetas y TODAS
  // las canciones caen sueltas en "Sin clasificar" (pedido: nada de subcarpetas
  // ahi; el orden lo pone despues el PC original).
  const agregarCarpeta = async () => {
    if (!musicRoot) return;
    const carpeta = await pickFolder();
    if (!carpeta) return;
    try {
      const dest = await ensureUnclassified(musicRoot);
      showToast("Buscando canciones en la carpeta... (puede tardar si es grande)");
      const [copiadas, saltadas] = await importFolder(carpeta, dest, false);
      await reloadLibrary();
      useStore.getState().setSelectedFolder(dest);
      showToast(
        `${copiadas} canción(es) agregadas a Sin clasificar` +
          (saltadas > 0 ? ` · ${saltadas} saltadas (ya estaban o no son audio)` : "")
      );
    } catch (e) {
      showToast(`No se pudo agregar la carpeta: ${e}`);
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

  const [menu, setMenu] = useState(false);
  // Lo que pide atención se ve SIN abrir el menú (regla 4: si algo falla, que
  // se vea): un código de Sync no aceptado, PC sin entrar...
  const avisoSync = etiqueta.clase === "sync-warn";
  // Cada opción cierra el menú y luego hace lo suyo.
  const opcion = (accion: () => void) => () => {
    setMenu(false);
    accion();
  };

  return (
    <div className="glass topbar">
      <span className="brand-wrap">
        <IconInfinito />
        <span className="brand">Infiniity DJ</span>
      </span>
      <span className="app-version" title="Versión instalada">v{__APP_VERSION__}</span>

      <span className="spacer" />

      {/* Barra casi libre (pedido del 31-oct): todo lo que se puede hacer va
          dentro de «Configuración». YouTube es ahora un panel de la derecha. */}
      <span className="config-wrap no-drag">
        <button
          className={`btn config-btn ${menu ? "abierto" : ""}`}
          onClick={() => setMenu((v) => !v)}
          title="Sync, salida de audio, controladora, agregar canciones, actualizaciones"
        >
          <IconEngranaje />
          Configuración
          {avisoSync && <span className="config-aviso" title={etiqueta.texto}>⚠</span>}
        </button>
        {menu && (
          <>
            {/* Clic fuera del menú = cerrarlo. */}
            <div className="config-fondo" onClick={() => setMenu(false)} />
            <div className="glass glass-strong config-menu">
              <button className={`btn ${etiqueta.clase}`} onClick={opcion(() => setSyncOpen(true))}>
                🔁 {etiqueta.texto}
                <span className="sync-dim">sincronización entre las PC</span>
              </button>
              {/* Salida de audio: sin esto, al conectar la cabina el sonido se
                  queda en los parlantes del portatil. */}
              <button className="btn" onClick={opcion(() => setAudioModalOpen(true))}>
                Audio
                <span className="sync-dim">por dónde suena: cabina, Bluetooth, audífonos</span>
              </button>
              <button className="btn" onClick={opcion(() => void toggleMidi())}>
                <span>
                  <span className={`midi-dot ${midiConnected ? "on" : "off"}`} />
                  {midiConnected ? `Controladora: ${midiPort ?? "DDJ-200"}` : "Controladora DDJ-200"}
                </span>
                <span className="sync-dim">
                  {midiConnected ? "conectada · clic para desconectarla" : "se conecta sola por USB · clic para buscarla"}
                </span>
              </button>

              <div className="config-sep" />
              <button className="btn" disabled={!musicRoot} onClick={opcion(() => void agregarCanciones())}>
                🎵 Agregar canciones sueltas…
                <span className="sync-dim">van a Sin clasificar</span>
              </button>
              <button className="btn" disabled={!musicRoot} onClick={opcion(() => void agregarCarpeta())}>
                📁 Agregar carpeta completa…
                <span className="sync-dim">se escanea entera, todo a Sin clasificar</span>
              </button>

              <div className="config-sep" />
              {/* Buscar actualizacion a mano: si el aviso automatico no
                  aparece, sin esto no se sabe si no hay version nueva o si la
                  busqueda esta fallando. */}
              <button
                className="btn"
                onClick={opcion(() => window.dispatchEvent(new CustomEvent(EVENTO_BUSCAR_ACTUALIZACION)))}
              >
                ⬆ Buscar actualización
                <span className="sync-dim">tienes la v{__APP_VERSION__}</span>
              </button>
              {/* Recarga: SOLO en desarrollo (no aparece en la app final). */}
              {import.meta.env.DEV && (
                <button className="btn" onClick={opcion(() => window.location.reload())}>
                  Recargar la app <span className="sync-dim">solo desarrollo</span>
                </button>
              )}
              {musicRoot && (
                <div className="config-info" title={musicRoot}>
                  Biblioteca: {musicRoot}
                </div>
              )}
            </div>
          </>
        )}
      </span>

      <div className="win-controls no-drag">
        <button className="btn btn-icon" title="Minimizar" onClick={() => minimizeWindow()}>
          –
        </button>
        <button className="btn btn-icon" title="Pantalla completa" onClick={() => toggleFullscreen()}>
          ⛶
        </button>
        <button className="btn btn-icon" title="Salir" onClick={() => quitApp()}>
          ✕
        </button>
      </div>
    </div>
  );
}
