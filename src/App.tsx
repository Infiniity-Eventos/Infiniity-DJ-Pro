import { useEffect } from "react";
import { useStore } from "./state/store";
import { reloadLibrary } from "./lib/library";
import { useMidi } from "./hooks/useMidi";
import { TopBar } from "./components/TopBar";
import { DeckPanel } from "./components/DeckPanel";
import { Mixer } from "./components/Mixer";
import { FolderTree } from "./components/FolderTree";
import { TrackList } from "./components/TrackList";
import { Welcome } from "./components/Welcome";

export default function App() {
  const theme = useStore((s) => s.theme);
  const musicRoot = useStore((s) => s.musicRoot);
  const toast = useStore((s) => s.toast);

  useMidi();

  // Aplicar el tema (claro/oscuro) al documento.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

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
    </div>
  );
}
