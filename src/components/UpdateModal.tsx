import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/**
 * Aviso de actualizacion.
 *
 * Al abrir el programa revisa si hay version nueva publicada en GitHub. Si la
 * hay, PREGUNTA antes de instalar: nunca se actualiza solo, para no dejar a
 * nadie esperando una descarga en pleno evento.
 *
 * Si no hay internet o GitHub no responde, se queda callado (no molesta con
 * errores: el programa funciona igual sin actualizarse).
 */
export function UpdateModal() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [installing, setInstalling] = useState(false);
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelado = false;
    // Esperamos 3s para no competir con la carga de la biblioteca al arrancar.
    const t = window.setTimeout(() => {
      check()
        .then((u) => {
          if (!cancelado && u?.available) setUpdate(u);
        })
        .catch(() => {
          /* sin internet o GitHub caido: seguimos normal */
        });
    }, 3000);
    return () => {
      cancelado = true;
      window.clearTimeout(t);
    };
  }, []);

  if (!update) return null;

  const instalar = async () => {
    setInstalling(true);
    setError("");
    try {
      let bajado = 0;
      let total = 0;
      await update.downloadAndInstall((ev) => {
        if (ev.event === "Started") {
          total = ev.data.contentLength ?? 0;
        } else if (ev.event === "Progress") {
          bajado += ev.data.chunkLength;
          if (total > 0) setPercent((bajado / total) * 100);
        } else if (ev.event === "Finished") {
          setPercent(100);
        }
      });
      await relaunch();
    } catch (e) {
      setError(String(e));
      setInstalling(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="glass glass-strong modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="dl-title">🎉 Hay una versión nueva</div>

        <div className="modal-msg">
          Infiniity DJ <b>{update.version}</b> ya está disponible.
          <br />
          <span style={{ fontSize: 13, opacity: 0.85 }}>Tú tienes la {update.currentVersion}.</span>
        </div>

        {update.body && (
          <div className="upd-notes">
            {update.body}
          </div>
        )}

        {installing && (
          <div className="dl-progress">
            <div className="progress" style={{ marginTop: 4 }}>
              <div className="fill" style={{ width: `${percent}%` }} />
            </div>
            <div className="dl-progress-msg">
              {percent >= 100
                ? "Instalando, el programa se va a reiniciar solo..."
                : `Descargando... ${Math.round(percent)}%`}
            </div>
          </div>
        )}

        {error && <div className="dl-warn">No se pudo actualizar: {error}</div>}

        {!installing && (
          <div className="modal-actions" style={{ marginTop: 16 }}>
            <button className="btn" onClick={() => setUpdate(null)}>
              Ahora no
            </button>
            <button className="btn btn-accent" onClick={instalar}>
              Actualizar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
