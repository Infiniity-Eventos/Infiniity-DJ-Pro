import { useEffect } from "react";
import { useMantenerDespierto } from "./lib/despierto";
import { useStore } from "./state/store";
import { reloadLibrary } from "./lib/library";
import { useMidi } from "./hooks/useMidi";
import { useSync } from "./hooks/useSync";
import { SyncModal } from "./components/SyncModal";
import { TopBar } from "./components/TopBar";
import { DeckPanel } from "./components/DeckPanel";
import { Mixer } from "./components/Mixer";
import { FolderTree } from "./components/FolderTree";
import { TrackList } from "./components/TrackList";
import { AutomixBar } from "./components/AutomixBar";
import { engine } from "./audio/AudioEngine";
import { automix } from "./audio/Automix";

// Solo en desarrollo: para inspeccionar el estado desde la consola del navegador.
if (import.meta.env.DEV) {
  (window as unknown as { __dj: unknown }).__dj = { useStore, engine, automix };
}
import { Welcome } from "./components/Welcome";
import { ConfirmModal } from "./components/ConfirmModal";
import { PromptModal } from "./components/PromptModal";
import { StatsMonitor } from "./components/StatsMonitor";
import { DownloadModal } from "./components/DownloadModal";
import { DownloadIndicator } from "./components/DownloadIndicator";
import { UpdateModal } from "./components/UpdateModal";
import { AudioOutputModal } from "./components/AudioOutputModal";
import { onYtdlProgress, modoDibujo, interfazLista, isTauri, ytdlUpdate } from "./lib/tauri";

export default function App() {
  const musicRoot = useStore((s) => s.musicRoot);
  const sync = useStore((s) => s.sync);
  const toast = useStore((s) => s.toast);
  const avisoCentral = useStore((s) => s.avisoCentral);
  const downloaderOpen = useStore((s) => s.downloaderOpen);
  const automixPlegada = useStore((s) => s.automix.plegada);
  const setDownloaderOpen = useStore((s) => s.setDownloaderOpen);
  const audioModalOpen = useStore((s) => s.audioModalOpen);
  const setAudioModalOpen = useStore((s) => s.setAudioModalOpen);

  useMidi();
  useSync();
  useMantenerDespierto();

  // Arranque: preguntar a Rust como se esta dibujando (ver arranque.rs).
  // (La app ya es siempre de bajo consumo; el modo se guarda para el CSV de
  // diagnostico.)
  // - Avisar que la interfaz ya se pinto, para que el arranque con GPU quede
  //   como "salio bien". Se espera un poco: el fallo de GPU puede llegar en los
  //   primeros cuadros, no en el primero.
  useEffect(() => {
    if (!isTauri()) return;
    const st = useStore.getState();
    modoDibujo()
      .then((m) => {
        st.setModoDibujo(m);
      })
      .catch((err) => {
        console.error("[App] no se pudo saber el modo de dibujo", err);
        st.showToast(`No se pudo saber el modo de dibujo (${err}).`);
      });
    const t = window.setTimeout(() => {
      interfazLista().catch((err) => console.error("[App] interfaz_lista fallo", err));
    }, 2500);
    return () => window.clearTimeout(t);
  }, []);

  // Mantener yt-dlp al dia (una vez al dia, 20 s despues de abrir, en segundo
  // plano). YouTube cambia cada pocas semanas y un yt-dlp viejo deja de bajar.
  useEffect(() => {
    if (!isTauri()) return;
    const CLAVE = "ytdlp-ultima-revision";
    const UN_DIA = 24 * 3600 * 1000;
    let ultima = 0;
    try {
      ultima = Number(localStorage.getItem(CLAVE) ?? 0);
    } catch (err) {
      console.error("[yt-dlp] no se pudo leer la fecha de la ultima revision", err);
    }
    if (Date.now() - ultima < UN_DIA) return;
    const t = window.setTimeout(() => {
      ytdlUpdate()
        .then((msg) => {
          try {
            localStorage.setItem(CLAVE, String(Date.now()));
          } catch (err) {
            console.error("[yt-dlp] no se pudo guardar la fecha de la revision", err);
          }
          console.log("[yt-dlp]", msg);
          if (msg.includes("Updated")) useStore.getState().showToast("Descargador de YouTube actualizado");
        })
        // Sin yt-dlp instalado o sin internet no es un fallo: se intenta otro dia.
        .catch((err) => console.warn("[yt-dlp] no se pudo revisar la actualizacion:", err));
    }, 20000);
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

  // Sin biblioteca sincronizada no hay app: solo la pantalla del código. Una
  // carpeta local elegida en versiones viejas se ignora (pedido: nada de
  // carpetas locales). Mientras Rust no ha dicho el rol, no se muestra nada
  // para no parpadear entre pantallas.
  if (isTauri() && sync === null) {
    return <div className="welcome">Cargando...</div>;
  }
  if (!musicRoot || (sync && sync.rol === "ninguno")) {
    return (
      <>
        <Welcome />
        <SyncModal />
        <ConfirmModal />
        <PromptModal />
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
      <div className={`library-area ${automixPlegada ? "automix-plegada-area" : ""}`}>
        <FolderTree />
        <TrackList />
        <AutomixBar />
      </div>
      {toast && <div className="glass glass-strong toast">{toast}</div>}
      {avisoCentral && (
        <div key={avisoCentral} className="glass glass-strong aviso-central">
          {avisoCentral}
        </div>
      )}
      <ConfirmModal />
      <PromptModal />
      <UpdateModal />
      <SyncModal />
      <StatsMonitor />
      <DownloadIndicator />
      {downloaderOpen && <DownloadModal onClose={() => setDownloaderOpen(false)} />}
      {audioModalOpen && <AudioOutputModal onClose={() => setAudioModalOpen(false)} />}
    </div>
  );
}
