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
import { startDownload, nextDownloadId } from "../lib/downloads";
import { fmtTime } from "../lib/format";

const isUrl = (s: string) => /youtu\.?be|youtube\.com|^https?:\/\//i.test(s);

/**
 * Buscador de YouTube. Al descargar, la descarga corre en SEGUNDO PLANO y la
 * ventana se cierra para seguir mezclando. No usa la API de YouTube.
 */
export function DownloadModal({ onClose }: { onClose: () => void }) {
  const showToast = useStore((s) => s.showToast);

  const [tools, setTools] = useState<YtdlTools | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<YtSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState<YtdlProgress | null>(null);
  // El error se queda FIJO en pantalla (no en un aviso que se desvanece):
  // si la instalación falla hay que poder leerlo con calma o fotografiarlo.
  const [installError, setInstallError] = useState("");

  useEffect(() => {
    ytdlTools().then(setTools).catch(() => setTools(null));
  }, []);
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

  // Iniciar descarga en segundo plano y cerrar para seguir mezclando.
  const download = (url: string, id: string, title: string) => {
    void startDownload(url, id, title);
    onClose();
  };

  const runSearch = async () => {
    const q = query.trim();
    if (!q || searching) return;
    if (isUrl(q)) {
      download(q, nextDownloadId(), "canción de YouTube");
      return;
    }
    setSearching(true);
    setResults([]);
    try {
      const r = await ytdlSearch(q);
      setResults(r);
      if (r.length === 0) showToast("Sin resultados");
    } catch (e) {
      showToast(`Error al buscar: ${e}`);
    } finally {
      setSearching(false);
    }
  };

  const ffmpegMissing = tools && !tools.ffmpeg;
  const needsInstall = tools && (!tools.ytdlp || !tools.deno);

  return (
    <div className="modal-overlay" onClick={installing ? undefined : onClose}>
      <div className="glass glass-strong modal-box dl-box" onClick={(e) => e.stopPropagation()}>
        <div className="dl-title">⬇️ Buscar y descargar de YouTube</div>

        {tools === null && <div className="modal-msg">Comprobando herramientas...</div>}

        {tools && needsInstall && (
          <div className="dl-section">
            <div className="modal-msg" style={{ marginBottom: 12 }}>
              Para buscar y descargar falta instalar el motor (una sola vez, ~110 MB). La app
              lo hace sola.
            </div>
            <ul className="dl-tools">
              <li>{tools.ytdlp ? "✅" : "⬜"} yt-dlp (buscador/descargador)</li>
              <li>{tools.deno ? "✅" : "⬜"} Deno (motor JS)</li>
              <li>{tools.ffmpeg ? "✅" : "❌"} ffmpeg (conversor a MP3)</li>
            </ul>
            {ffmpegMissing && (
              <div className="dl-warn">
                ⚠️ Falta <b>ffmpeg</b>, que convierte a MP3. Instálalo según tu sistema:
                <br />
                Linux Mint / Ubuntu: <code>sudo apt install ffmpeg</code>
                <br />
                Fedora: <code>sudo dnf install ffmpeg-free</code>
              </div>
            )}
            {installing && installProgress && (
              <ProgressBarDL percent={installProgress.percent} message={installProgress.message} />
            )}
            {installError && (
              <div className="dl-error">
                <b>No se pudo instalar</b>
                <div className="dl-error-msg">{installError}</div>
              </div>
            )}
            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button className="btn" onClick={onClose} disabled={installing}>
                Cerrar
              </button>
              <button className="btn btn-accent" onClick={install} disabled={installing}>
                {installing ? "Instalando..." : installError ? "Reintentar" : "Instalar"}
              </button>
            </div>
          </div>
        )}

        {tools && !needsInstall && (
          <div className="dl-section">
            {ffmpegMissing && (
              <div className="dl-warn">
                ⚠️ Falta <b>ffmpeg</b>, que convierte a MP3. Instálalo según tu sistema:
                <br />
                Linux Mint / Ubuntu: <code>sudo apt install ffmpeg</code>
                <br />
                Fedora: <code>sudo dnf install ffmpeg-free</code>
              </div>
            )}
            <div className="dl-search-row">
              <input
                className="dl-input"
                placeholder="Nombre de la canción (o pega un enlace)..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch()}
                disabled={searching}
                autoFocus
              />
              <button
                className="btn btn-accent"
                onClick={runSearch}
                disabled={searching || !query.trim()}
              >
                {searching ? "Buscando..." : "Buscar"}
              </button>
            </div>

            <div className="dl-results">
              {searching && <div className="dl-empty">Buscando en YouTube...</div>}
              {!searching && results.length === 0 && (
                <div className="dl-empty">Escribe una canción y dale a Buscar.</div>
              )}
              {results.map((r) => {
                const url = `https://www.youtube.com/watch?v=${r.id}`;
                return (
                  <div key={r.id} className="dl-result">
                    <img
                      className="dl-thumb"
                      src={`https://i.ytimg.com/vi/${r.id}/mqdefault.jpg`}
                      alt=""
                      loading="lazy"
                    />
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
                      className="btn load-btn dl-get"
                      title="Descargar (sigue en segundo plano)"
                      onClick={() => download(url, r.id, r.title)}
                      disabled={!!ffmpegMissing}
                    >
                      ⬇
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="modal-actions" style={{ marginTop: 14 }}>
              <button className="btn" onClick={onClose}>
                Cerrar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ProgressBarDL({ percent, message }: { percent: number; message: string }) {
  return (
    <div className="dl-progress">
      <div className="progress" style={{ marginTop: 4 }}>
        <div className="fill" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>
      <div className="dl-progress-msg">{message}</div>
    </div>
  );
}
