import { useStore } from "../state/store";
import { retryDownload } from "../lib/downloads";

/**
 * Chip flotante (abajo a la derecha) con las descargas en curso o fallidas.
 * Si una falla (p. ej. 429 de YouTube), NO se pierde: queda con Reintentar.
 */
export function DownloadIndicator() {
  const downloads = useStore((s) => s.downloads);
  const removeDownload = useStore((s) => s.removeDownload);
  if (downloads.length === 0) return null;

  return (
    <div className="dl-indicator">
      {downloads.map((d) => {
        const failed = d.status === "error";
        return (
          <div key={d.id} className={`glass dl-indicator-item ${failed ? "dl-failed" : ""}`}>
            <div className="dl-indicator-top">
              <span className="dl-indicator-icon">{failed ? "⚠️" : "⬇️"}</span>
              <span className="dl-indicator-title" title={d.title}>
                {d.title}
              </span>
              {!failed && (
                <span className="dl-indicator-pct">
                  {d.stage === "convirtiendo" ? "MP3…" : `${Math.round(d.percent)}%`}
                </span>
              )}
            </div>

            {failed ? (
              <>
                <div className="dl-fail-msg">{d.errorMsg || "No se pudo descargar"}</div>
                <div className="dl-fail-actions">
                  <button className="btn dl-mini" onClick={() => removeDownload(d.id)}>
                    Descartar
                  </button>
                  <button className="btn btn-accent dl-mini" onClick={() => retryDownload(d.id)}>
                    🔄 Reintentar
                  </button>
                </div>
              </>
            ) : (
              <div className="progress" style={{ height: 6 }}>
                <div
                  className="fill"
                  style={{
                    width: d.stage === "convirtiendo" ? "100%" : `${Math.min(100, d.percent)}%`,
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
