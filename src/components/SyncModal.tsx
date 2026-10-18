import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import {
  syncCrearGrupo,
  syncCodigo,
  syncCambiarSecreto,
  syncAutorizar,
  syncInstalarServicio,
  syncSalir,
  syncLog,
} from "../lib/tauri";
import { CopyButton } from "./CopyButton";

/**
 * Panel de sincronización de la biblioteca. Tres caras según el rol:
 * - NINGUNO (PC con carpeta propia): botón para convertirla en el original del grupo.
 * - ORIGINAL: el código para las demás PC, la lista de PC conectadas, el servicio
 *   que mantiene todo encendido aunque la app esté cerrada.
 * - EQUIPO: qué falta por recibir, autorizar / pausar / continuar, por qué está
 *   frenado (música), y salir del grupo.
 */
export function SyncModal() {
  const open = useStore((s) => s.syncOpen);
  const aviso = useStore((s) => s.syncAviso);
  const setOpen = useStore((s) => s.setSyncOpen);
  const setAviso = useStore((s) => s.setSyncAviso);
  const sync = useStore((s) => s.sync);
  const musicRoot = useStore((s) => s.musicRoot);
  const showToast = useStore((s) => s.showToast);
  const askConfirm = useStore((s) => s.askConfirm);

  const [codigo, setCodigo] = useState("");
  const [ocupado, setOcupado] = useState("");
  const [error, setError] = useState("");
  const [log, setLog] = useState<string | null>(null);

  const visible = open || aviso;
  const cerrar = () => {
    setOpen(false);
    setAviso(false);
    setError("");
    setLog(null);
  };

  useEffect(() => {
    if (visible && sync?.rol === "original") {
      syncCodigo().then(setCodigo).catch((e) => setError(String(e)));
    }
  }, [visible, sync?.rol]);

  if (!visible) return null;

  const correr = async (que: string, fn: () => Promise<unknown>, ok?: string) => {
    setOcupado(que);
    setError("");
    try {
      await fn();
      if (ok) showToast(ok);
    } catch (e) {
      setError(String(e));
    } finally {
      setOcupado("");
    }
  };

  const crearGrupo = () => {
    if (!musicRoot) return;
    askConfirm(
      `Esta PC pasará a ser el ORIGINAL del grupo. Su carpeta "${musicRoot}" será la biblioteca de todas las PC. ¿Seguir?`,
      () => void correr("crear", async () => setCodigo(await syncCrearGrupo(musicRoot)), "Grupo creado")
    );
  };

  const salir = () => {
    askConfirm(
      "Esta PC saldrá del grupo. La música que ya tiene se queda; deja de recibir cambios. ¿Seguir?",
      () =>
        void correr("salir", async () => {
          await syncSalir();
          useStore.getState().setMusicRoot(null);
          cerrar();
        }, "Fuera del grupo")
    );
  };

  return (
    <div className="modal-overlay" onClick={ocupado ? undefined : cerrar}>
      <div className="modal-box sync-box" onClick={(e) => e.stopPropagation()}>
        <div className="dl-title">🔁 Sincronización de la biblioteca</div>

        {!sync && <div className="modal-msg">Leyendo estado...</div>}

        {sync && sync.rol === "ninguno" && (
          <div className="dl-section">
            <div className="modal-msg">
              Esta PC usa su propia carpeta. Si esta es la <b>carpeta madre</b> de la música, conviértela
              en el original del grupo: las demás PC recibirán todo desde aquí con un código.
              <br />
              <br />
              Si esta PC es de alguien del equipo, mejor sal de la carpeta y entra con el código desde la
              pantalla de inicio.
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={cerrar}>
                Cerrar
              </button>
              <button className="btn btn-accent" disabled={!musicRoot || !!ocupado} onClick={crearGrupo}>
                {ocupado === "crear" ? "Creando (baja Syncthing, ~11 MB)..." : "Convertir esta PC en el original"}
              </button>
            </div>
          </div>
        )}

        {sync && sync.rol === "original" && (
          <div className="dl-section">
            <div className="sync-row">
              <span className={`midi-dot ${sync.activo ? "on" : "off"}`} />
              {sync.activo ? "Sincronización encendida" : "Sincronización apagada (arrancando...)"}
            </div>

            <div className="sync-sub">Código para las demás PC (cópialo y mándalo por WhatsApp):</div>
            <div className="sync-codigo">{codigo || "..."}</div>
            <div className="modal-actions" style={{ justifyContent: "flex-start" }}>
              {codigo && <CopyButton texto={codigo} />}
              <button
                className="btn"
                disabled={!!ocupado}
                title="Los códigos ya mandados dejan de servir; las PC ya unidas siguen igual"
                onClick={() => void correr("secreto", async () => setCodigo(await syncCambiarSecreto()), "Código nuevo")}
              >
                Cambiar código
              </button>
            </div>

            <div className="sync-sub">PC del equipo:</div>
            {sync.pcs.length === 0 && <div className="modal-msg">Ninguna todavía. En cuanto una entre con el código, aparece aquí.</div>}
            <ul className="sync-pcs">
              {sync.pcs.map((p) => (
                <li key={p.nombre + p.ultimo_visto}>
                  <span className={`midi-dot ${p.conectado ? "on" : "off"}`} />
                  <b>{p.nombre}</b>
                  <span className="sync-dim">
                    {p.conectado ? ` · conectada · tiene el ${Math.round(p.completado)}% de la biblioteca` : " · desconectada"}
                  </span>
                </li>
              ))}
            </ul>

            <div className="sync-sub">Para que funcione aunque la app esté cerrada:</div>
            <div className="modal-actions" style={{ justifyContent: "flex-start" }}>
              <button
                className="btn"
                disabled={!!ocupado}
                onClick={() =>
                  void correr("servicio", syncInstalarServicio, "Listo: la sincronización arranca sola al iniciar sesión")
                }
              >
                {ocupado === "servicio" ? "Instalando..." : "Mantener siempre encendida"}
              </button>
              <button className="btn" onClick={() => void syncLog().then(setLog)}>
                Ver registro
              </button>
            </div>
          </div>
        )}

        {sync && sync.rol === "equipo" && (
          <div className="dl-section">
            {aviso && (
              <div className="dl-warn" style={{ marginBottom: 12 }}>
                Te falta sincronizar con la carpeta madre de la música: <b>{sync.pendientes}</b> canciones (
                {sync.pendientes_mb.toFixed(0)} MB). ¿Sincronizar ahora?
              </div>
            )}
            <div className="sync-row">
              <span className={`midi-dot ${sync.original_conectado ? "on" : "off"}`} />
              {sync.original_conectado ? "Conectada con el PC original" : "Sin conexión con el PC original (se reintenta sola)"}
            </div>
            <div className="sync-row">
              Biblioteca en esta PC: <b>{Math.round(sync.completado)}%</b>
              {sync.pendientes > 0 ? ` · faltan ${sync.pendientes} (${sync.pendientes_mb.toFixed(0)} MB)` : " · al día"}
            </div>
            <div className="sync-row sync-dim">
              {!sync.autorizado && "En espera de tu autorización."}
              {sync.autorizado && sync.musica && "⏸ En pausa mientras suena música (no es un fallo): sigue sola al parar."}
              {sync.autorizado && !sync.musica && sync.pausa_manual && "⏸ En pausa (la pausaste tú)."}
              {sync.autorizado && !sync.musica && !sync.pausa_manual && "▶ Sincronizando cuando hay algo pendiente."}
            </div>
            <div className="modal-actions" style={{ justifyContent: "flex-start" }}>
              {(!sync.autorizado || sync.pausa_manual) && (
                <button
                  className="btn btn-accent"
                  disabled={!!ocupado}
                  onClick={() => void correr("auth", () => syncAutorizar(true, false), "Sincronizando")}
                >
                  Sincronizar ahora
                </button>
              )}
              {sync.autorizado && !sync.pausa_manual && (
                <button className="btn" disabled={!!ocupado} onClick={() => void correr("pausa", () => syncAutorizar(true, true), "En pausa")}>
                  Pausar
                </button>
              )}
              {aviso && (
                <button className="btn" onClick={cerrar}>
                  Más tarde
                </button>
              )}
              <button className="btn" onClick={() => void syncLog().then(setLog)}>
                Ver registro
              </button>
              <span className="spacer" />
              <button className="btn sync-peligro" disabled={!!ocupado} onClick={salir}>
                Salir del grupo
              </button>
            </div>
            <div className="sync-dim" style={{ fontSize: 11, marginTop: 8 }}>
              Carpeta: {sync.raiz}. Lo que bajes de YouTube sube al PC original y a las demás PC. Las carpetas
              clasificadas no se pueden cambiar desde aquí.
            </div>
          </div>
        )}

        {error && (
          <div className="dl-error">
            <b>No se pudo</b>
            <div className="dl-error-msg">{error}</div>
            <div className="dl-error-acciones">
              <CopyButton texto={`Infiniity DJ ${__APP_VERSION__} · Sync\n${error}`} />
            </div>
          </div>
        )}

        {log !== null && (
          <pre className="sync-log">{log || "(registro vacío)"}</pre>
        )}

        {sync && sync.rol !== "ninguno" && !aviso && (
          <div className="modal-actions">
            <button className="btn" onClick={cerrar}>
              Cerrar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Texto corto para el botón de la barra: el estado en tres palabras. */
export function etiquetaSync(e: ReturnType<typeof useStore.getState>["sync"]): { texto: string; clase: string } {
  if (!e || e.rol === "ninguno") return { texto: "Sync", clase: "" };
  if (!e.activo) return { texto: "Sync: arrancando", clase: "sync-off" };
  if (e.rol === "original") {
    const n = e.pcs.filter((p) => p.conectado).length;
    return { texto: `Sync: ${n} PC`, clase: "sync-on" };
  }
  if (!e.original_conectado) return { texto: "Sync: sin conexión", clase: "sync-off" };
  if (e.pendientes === 0) return { texto: "Sync: al día", clase: "sync-on" };
  if (!e.autorizado) return { texto: `Sync: faltan ${e.pendientes}`, clase: "sync-warn" };
  if (e.musica) return { texto: "Sync: pausa (música)", clase: "sync-warn" };
  if (e.pausa_manual) return { texto: "Sync: en pausa", clase: "sync-warn" };
  return { texto: `Sync: bajando ${e.pendientes}`, clase: "sync-on" };
}
