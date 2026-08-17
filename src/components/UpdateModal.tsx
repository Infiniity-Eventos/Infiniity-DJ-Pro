import { useCallback, useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { CopyButton } from "./CopyButton";

/**
 * Arma un mensaje completo para pegar por WhatsApp. Se incluye la version y
 * el paso que fallo porque el error suelto, sin contexto, no alcanza para
 * diagnosticar nada del otro lado.
 */
function textoParaEnviar(paso: string, version: string, error: string): string {
  return `Infiniity DJ ${version || "(versión desconocida)"}\nFalló al ${paso}:\n${error}`;
}

/**
 * Actualizaciones.
 *
 * Dos formas de disparar la busqueda:
 *   - AUTOMATICA al abrir: si hay version nueva pregunta; si algo falla se
 *     queda callado (no vale molestar con errores de red a quien solo quiere
 *     poner musica).
 *   - MANUAL con el boton de la barra: aqui SI se muestra todo, incluidos los
 *     errores y el "ya estas al dia". Si no, cuando el aviso no aparece no hay
 *     forma de saber si es que no hay version nueva o es que algo se rompio.
 *
 * Nunca instala sin preguntar: en pleno evento una descarga sorpresa es lo
 * ultimo que se necesita.
 */
export const EVENTO_BUSCAR_ACTUALIZACION = "infiniity:buscar-actualizacion";

export function UpdateModal() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [installing, setInstalling] = useState(false);
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [alDia, setAlDia] = useState(false);
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(""));
  }, []);

  const buscar = useCallback(async (manual: boolean) => {
    if (manual) {
      setBuscando(true);
      setError("");
      setAlDia(false);
    }
    try {
      const u = await check();
      if (u?.available) {
        setUpdate(u);
      } else if (manual) {
        setAlDia(true);
      }
    } catch (e) {
      // En la busqueda automatica callamos; en la manual el usuario pidio
      // saber, asi que se le dice exactamente que fallo.
      if (manual) setError(String(e));
      else console.error("[actualizador] fallo la busqueda automatica:", e);
    } finally {
      if (manual) setBuscando(false);
    }
  }, []);

  // Automatica: 3s despues de abrir, para no competir con la carga de la
  // biblioteca de musica.
  useEffect(() => {
    const t = window.setTimeout(() => void buscar(false), 3000);
    return () => window.clearTimeout(t);
  }, [buscar]);

  // Manual: la dispara el boton de la barra de arriba.
  useEffect(() => {
    const h = () => void buscar(true);
    window.addEventListener(EVENTO_BUSCAR_ACTUALIZACION, h);
    return () => window.removeEventListener(EVENTO_BUSCAR_ACTUALIZACION, h);
  }, [buscar]);

  const cerrar = () => {
    setUpdate(null);
    setError("");
    setAlDia(false);
  };

  const instalar = async () => {
    if (!update) return;
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

  // Nada que mostrar: ni buscando, ni actualizacion, ni error, ni "al dia".
  if (!buscando && !update && !error && !alDia) return null;

  return (
    <div className="modal-overlay" onClick={installing || buscando ? undefined : cerrar}>
      <div className="glass glass-strong modal-box" onClick={(e) => e.stopPropagation()}>
        {buscando && (
          <>
            <div className="dl-title">Buscando actualizaciones...</div>
            <div className="modal-msg">Un momento.</div>
          </>
        )}

        {alDia && (
          <>
            <div className="dl-title">✅ Ya estás al día</div>
            <div className="modal-msg">
              Tienes la versión <b>{version}</b>, que es la más reciente.
            </div>
            <div className="modal-actions">
              <button className="btn btn-accent" onClick={cerrar}>
                Cerrar
              </button>
            </div>
          </>
        )}

        {update && (
          <>
            {/* SIN EMOJIS DE COLOR AQUI. El de fiesta que habia antes ESTRELLABA la
                app entera al mostrar este aviso, en Fedora 44:
                  colrv1_configure_skpaint(...) Assertion '__n < this->size()'
                Es un fallo del motor de dibujo empaquetado (WebKit de Ubuntu
                22.04, mas viejo que la fuente Noto-COLRv1 del sistema) al
                pintar glifos de color con degradados. La ventana quedaba en
                blanco y no habia forma de actualizar.
                Los simbolos simples (⬆ ✅ ⚠) si funcionan; los emojis
                elaborados no. Ante la duda, texto. */}
            <div className="dl-title">Hay una versión nueva</div>
            <div className="modal-msg">
              Infiniity DJ <b>{update.version}</b> ya está disponible.
              <br />
              <span style={{ fontSize: 13, opacity: 0.85 }}>
                Tú tienes la {update.currentVersion}.
              </span>
            </div>
            {update.body && <div className="upd-notes">{update.body}</div>}
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
            {!installing && (
              <div className="modal-actions" style={{ marginTop: 16 }}>
                <button className="btn" onClick={cerrar}>
                  Ahora no
                </button>
                <button className="btn btn-accent" onClick={instalar}>
                  Actualizar
                </button>
              </div>
            )}
          </>
        )}

        {error && !update && (
          <>
            <div className="dl-title">No se pudo buscar la actualización</div>
            <div className="dl-error">
              <div className="dl-error-msg">{error}</div>
              <div className="dl-error-acciones">
                <CopyButton texto={textoParaEnviar("buscar actualización", version, error)} />
              </div>
            </div>
            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button className="btn" onClick={cerrar}>
                Cerrar
              </button>
              <button className="btn btn-accent" onClick={() => void buscar(true)}>
                Reintentar
              </button>
            </div>
          </>
        )}

        {error && update && (
          <div className="dl-error">
            <div className="dl-error-msg">{error}</div>
            <div className="dl-error-acciones">
              <CopyButton texto={textoParaEnviar("instalar actualización", version, error)} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
