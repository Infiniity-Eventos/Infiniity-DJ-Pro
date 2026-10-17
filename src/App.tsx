import { useEffect } from "react";
import { useStore, weakMachineDefault } from "./state/store";
import { reloadLibrary } from "./lib/library";
import { useMidi } from "./hooks/useMidi";
import { TopBar } from "./components/TopBar";
import { DeckPanel } from "./components/DeckPanel";
import { Mixer } from "./components/Mixer";
import { FolderTree } from "./components/FolderTree";
import { TrackList } from "./components/TrackList";
import { Welcome } from "./components/Welcome";
import { ConfirmModal } from "./components/ConfirmModal";
import { PromptModal } from "./components/PromptModal";
import { StatsMonitor } from "./components/StatsMonitor";
import { DownloadModal } from "./components/DownloadModal";
import { DownloadIndicator } from "./components/DownloadIndicator";
import { UpdateModal } from "./components/UpdateModal";
import { onYtdlProgress, modoDibujo, interfazLista, isTauri } from "./lib/tauri";

export default function App() {
  const theme = useStore((s) => s.theme);
  const lowPower = useStore((s) => s.lowPower);
  const musicRoot = useStore((s) => s.musicRoot);
  const toast = useStore((s) => s.toast);
  const downloaderOpen = useStore((s) => s.downloaderOpen);
  const setDownloaderOpen = useStore((s) => s.setDownloaderOpen);

  useMidi();

  // Aplicar el tema (claro/oscuro) y el modo bajo consumo al documento.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
  useEffect(() => {
    document.documentElement.setAttribute("data-lowpower", lowPower ? "1" : "0");
  }, [lowPower]);

  // Arranque: preguntar a Rust como se esta dibujando (ver arranque.rs).
  // - Por software -> bajo consumo automatico (salvo que el usuario lo eligiera).
  // - Avisar que la interfaz ya se pinto, para que el arranque con GPU quede
  //   como "salio bien". Se espera un poco: el fallo de GPU puede llegar en los
  //   primeros cuadros, no en el primero.
  useEffect(() => {
    if (!isTauri()) return;
    const st = useStore.getState();
    modoDibujo()
      .then((m) => {
        st.setModoDibujo(m);
        st.setLowPowerAuto(m.software || weakMachineDefault());
      })
      .catch((err) => {
        console.error("[App] no se pudo saber el modo de dibujo", err);
        st.showToast(`No se pudo saber el modo de dibujo (${err}); se asume bajo consumo.`);
        st.setLowPowerAuto(true);
      });
    const t = window.setTimeout(() => {
      interfazLista().catch((err) => console.error("[App] interfaz_lista fallo", err));
    }, 2500);
    return () => window.clearTimeout(t);
  }, []);

  // Progreso de descargas en segundo plano -> estado global (para el indicador).
  useEffect(() => {
    let un: (() => void) | undefined;
    onYtdlProgress((p) => {
      if (p.id === "__install__") return;
      useStore.getState().updateDownload(p.id, { percent: p.percent, stage: p.stage });
    }).then((u) => (un = u));
    return () => un?.();
  }, []);

  // Cargar la biblioteca al abrir, si ya hay carpeta guardada.
  useEffect(() => {
    if (musicRoot) void reloadLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!musicRoot) {
    return (
      <>
        <Welcome />
        {toast && <div className="glass glass-strong toast">{toast}</div>}
      </>
    );
  }

  return (
    <div className="app">
      <TopBar />
      <div className="decks-row">
        <DeckPanel deckId="A" />
        <Mixer />
        <DeckPanel deckId="B" />
      </div>
      <div className="library-area">
        <FolderTree />
        <TrackList />
      </div>
      {toast && <div className="glass glass-strong toast">{toast}</div>}
      <ConfirmModal />
      <PromptModal />
      <UpdateModal />
      <StatsMonitor />
      <DownloadIndicator />
      {downloaderOpen && <DownloadModal onClose={() => setDownloaderOpen(false)} />}
    </div>
  );
}
