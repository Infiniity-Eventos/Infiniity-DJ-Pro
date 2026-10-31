import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import {
  ytdlTools,
  ytdlInstall,
  ytdlSearch,
  onYtdlProgress,
  type YtdlTools,
  type YtdlProgress,
  type YtSearchResult,
} from "../lib/tauri";
import { startDownload } from "../lib/downloads";
import { fmtTime } from "../lib/format";
import { CopyButton } from "./CopyButton";
import { ListaDescargas } from "./DownloadIndicator";

/**
 * Panel de YouTube: columna fija a la derecha, igual que el Automix, y
 * plegable como él (pedido del 31-oct: antes era una ventana que tapaba los
 * decks). Las descargas corren en segundo plano; mientras el panel está
 * abierto se ven aquí abajo, y con el panel plegado, en el aviso flotante.
 * No usa la API de YouTube.
 */
export function YoutubePanel() {
  const plegado = useStore((s) => s.youtubePlegado);
  const setPlegado = useStore((s) => s.setYoutubePlegado);
  const showToast = useStore((s) => s.showToast);
  const downloads = useStore((s) => s.downloads);

  const [tools, setTools] = useState<YtdlTools | null>(null);
  const [toolsError, setToolsError] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<YtSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [buscado, setBuscado] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState<YtdlProgress | null>(null);
  // El error se queda FIJO en pantalla (no en un aviso que se desvanece):
  // si la instalación falla hay que poder leerlo con calma o fotografiarlo.
  const [installError, setInstallError] = useState("");

  const comprobarHerramientas = () => {
    setToolsError("");
    ytdlTools()
      .then(setTools)
      .catch((e) => {
        console.error("[youtube] no se pudo comprobar el descargador", e);
        setTools(null);
        setToolsError(String(e));
      });
  };
  // Se comprueba al abrir el panel (y no al arrancar con él plegado).
  useEffect(() => {
    if (!plegado && tools === null) comprobarHerramientas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plegado]);

  // Progreso SOLO de la instalación (las descargas van en segundo plano).
  useEffect(() => {
    let un: (() => void) | undefined;
    onYtdlProgress((p) => {
      if (p.id === "__install__") setInstallProgress(p);
    }).then((u) => (un = u));
    return () => un?.();
  }, []);

  const install = async () => {
    setInstalling(true);
    setInstallProgress(null);
    setInstallError("");
    try {
      const t = await ytdlInstall();
      setTools(t);
      showToast(t.ready ? "Descargador listo ✅" : "Instalado (revisa ffmpeg)");
    } catch (e) {
      setInstallError(String(e));
    } finally {
      setInstalling(false);
      setInstallProgress(null);
    }
  };

  // Se pueden pedir varias canciones seguidas de la misma búsqueda. El estado
  // de cada una se ve en su botón (en cola / bajando / lista / error).
  const pedidas = useStore((s) => s.pedidas);
  const marcarPedida = useStore((s) => s.marcarPedida);
  const download = (url: string, id: string, title: string) => {
    marcarPedida(id);
    void startDownload(url, id, title);
  };
  const estadoDe = (id: string): { icono: string; titulo: string; ocupado: boolean } => {
    const d = downloads.find((x) => x.id === id);
    if (d && d.status === "error") return { icono: "⚠", titulo: `Falló: ${d.errorMsg ?? ""}. Clic para reintentar`, ocupado: false };
    if (d && d.stage === "en cola") return { icono: "…", titulo: "En cola", ocupado: true };
    if (d) return { icono: `${Math.round(d.percent)}%`, titulo: d.stage, ocupado: true };
    if (pedidas.has(id)) return { icono: "✅", titulo: "Ya descargada (está en Sin clasificar)", ocupado: true };
    return { icono: "⬇", titulo: "Descargar (sigue en segundo plano)", ocupado: false };
  };

  const runSearch = async () => {
    const q = query.trim();
    if (!q || searching) return;
    // Un enlace también pasa por la búsqueda: yt-dlp devuelve el video con su
    // título (o la lista completa si es una playlist) y se pide con ⬇ como
    // cualquier resultado.
    setSearching(true);
    setResults([]);
    try {
      const r = await ytdlSearch(q);
      setResults(r);
      setBuscado(true);
    } catch (e) {
      showToast(`Error al buscar: ${e}`);
    } finally {
      setSearching(false);
    }
  };

  const activas = downloads.filter((d) => d.status !== "error").length;
  const fallidas = downloads.filter((d) => d.status === "error").length;

  if (plegado) {
    return (
      <div className="glass automix automix-plegada" onClick={() => setPlegado(false)} title="Abrir el panel de YouTube">
        <div className={`automix-led ${activas ? "on" : ""} ${fallidas ? "mal" : ""}`} />
        <div className="automix-vertical">
          YOUTUBE{activas ? ` · ${activas}` : ""}
          {fallidas ? ` · ⚠ ${fallidas}` : ""}
        </div>
      </div>
    );
  }

  const ffmpegMissing = tools && !tools.ffmpeg;
  // ffmpeg también lo instala la app (versión estática en su carpeta): nada de
  // pedirle "sudo apt install" a alguien en pleno evento.
  const needsInstall = tools && (!tools.ytdlp || !tools.deno || !tools.ffmpeg);

  return (
    <div className="glass automix yt-panel">
      <div className="automix-head">
        <div className="automix-titulo">
          <b>YouTube</b>
          <span className="automix-sub">buscar y descargar canciones</span>
        </div>
        <button className="btn btn-icon automix-plegar" onClick={() => setPlegado(true)} title="Plegar">
          ▸
        </button>
      </div>

      {tools === null && !toolsError && <div className="yt-nota">Comprobando el descargador...</div>}
      {toolsError && (
        <div className="dl-error">
          <b>No se pudo comprobar el descargador</b>
          <div className="dl-error-msg">{toolsError}</div>
          <div className="dl-error-acciones">
            <button className="btn dl-mini" onClick={comprobarHerramientas}>
              Reintentar
            </button>
          </div>
        </div>
      )}

      {tools && needsInstall && (
        <div className="yt-instalar">
          <div className="yt-nota">
            Para buscar y descargar falta instalar el motor (una sola vez, ~150 MB). La app lo hace sola, sin
            contraseña.
          </div>
          <ul className="dl-tools">
            <li>{tools.ytdlp ? "✅" : "⬜"} yt-dlp (buscador/descargador)</li>
            <li>{tools.deno ? "✅" : "⬜"} Deno (motor JS)</li>
            <li>{tools.ffmpeg ? "✅" : "⬜"} ffmpeg (conversor a MP3)</li>
          </ul>
          {installing && installProgress && (
            <div className="dl-progress">
              <div className="progress" style={{ marginTop: 4 }}>
                <div className="fill" style={{ width: `${Math.min(100, Math.max(0, installProgress.percent))}%` }} />
              </div>
              <div className="dl-progress-msg">{installProgress.message}</div>
            </div>
          )}
          {installing && !installProgress && <div className="yt-nota">Empezando la instalación...</div>}
          {installError && (
            <div className="dl-error">
              <b>No se pudo instalar</b>
              <div className="dl-error-msg">{installError}</div>
              <div className="dl-error-acciones">
                <CopyButton texto={`Infiniity DJ - falló la instalación del descargador:\n${installError}`} />
              </div>
            </div>
          )}
          <button className="btn btn-accent" onClick={install} disabled={installing}>
            {installing ? "Instalando..." : installError ? "Reintentar" : "Instalar"}
          </button>
        </div>
      )}

      {tools && !needsInstall && (
        <>
          <div className="yt-buscar">
            <input
              className="dl-input"
              placeholder="Canción o enlace de YouTube..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
              disabled={searching}
            />
            <button className="btn btn-accent" onClick={runSearch} disabled={searching || !query.trim()}>
              {searching ? "..." : "Buscar"}
            </button>
          </div>

          <div className="yt-resultados">
            {searching && <div className="yt-nota">Buscando en YouTube...</div>}
            {!searching && results.length === 0 && (
              <div className="yt-nota">
                {buscado ? "No salió nada con esa búsqueda. Prueba con otras palabras." : "Escribe una canción y dale a Buscar. Lo descargado cae en «Sin clasificar»."}
              </div>
            )}
            {results.map((r) => {
              const url = `https://www.youtube.com/watch?v=${r.id}`;
              const e = estadoDe(r.id);
              return (
                <div key={r.id} className="dl-result yt-result">
                  <img className="dl-thumb" src={`https://i.ytimg.com/vi/${r.id}/mqdefault.jpg`} alt="" loading="lazy" />
                  <div className="dl-result-info">
                    <div className="dl-result-title" title={r.title}>
                      {r.title}
                    </div>
                    <div className="dl-result-sub">
                      {r.channel}
                      {r.duration ? ` · ${fmtTime(r.duration)}` : ""}
                    </div>
                  </div>
                  <button
                    className={`btn load-btn dl-get ${e.ocupado ? "dl-get-ocupado" : ""}`}
                    title={e.titulo}
                    onClick={() => download(url, r.id, r.title)}
                    disabled={!!ffmpegMissing || e.ocupado}
                  >
                    {e.icono}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {downloads.length > 0 && (
        <div className="yt-descargas">
          <div className="yt-descargas-titulo">Descargando</div>
          <ListaDescargas />
        </div>
      )}
    </div>
  );
}
