import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import {
  syncCrearGrupo,
  syncCodigo,
  syncCambiarSecreto,
  syncAutorizar,
  syncInstalarServicio,
  syncQuitarPc,
  syncDescartarRechazada,
  syncRenombrarPc,
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
  const askPrompt = useStore((s) => s.askPrompt);

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
      <div className="glass glass-strong modal-box sync-box" onClick={(e) => e.stopPropagation()}>
        <div className="dl-title">🔁 Sincronización de la biblioteca</div>

        {!sync && <div className="modal-msg">Leyendo estado...</div>}

        {sync && sync.rol === "ninguno" && (
          <div className="dl-section">
            <div className="modal-msg">
              Esta PC no está en ningún grupo. Entra con el código que manda Camilo desde la pantalla de
              inicio.
              {musicRoot && (
                <>
                  <br />
                  <br />
                  Si esta es la <b>carpeta madre</b> de la música, conviértela en el original del grupo.
                </>
              )}
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

            {sync.pendientes > 0 && (
              <div className="sync-row">
                ⬇ Recibiendo <b>{sync.pendientes}</b> canciones ({sync.pendientes_mb.toFixed(0)} MB) que agregó el equipo...
              </div>
            )}
            {sync.rechazadas.length > 0 && (
              <div className="dl-warn sync-rechazadas">
                <div>
                  ⚠ {sync.rechazadas.length === 1 ? "Una PC intentó entrar" : `${sync.rechazadas.length} PC intentaron entrar`} con un
                  código que ya no sirve. Si sigue en uso, mándale el código de abajo. Si ya entró con otro nombre o
                  ya no existe, descarta el aviso (si vuelve a intentar, aparece otra vez).
                </div>
                {sync.rechazadas.map((r) => (
                  <div key={r.id} className="sync-rechazada">
                    <span>
                      <b>{r.nombre || "sin nombre"}</b>
                      <span className="sync-dim"> · {(r.desde ? cuandoSeVio(r.desde, "último intento") : "sin fecha")}</span>
                    </span>
                    <button
                      className="btn dl-mini"
                      disabled={!!ocupado}
                      onClick={() =>
                        void correr("descartar", () => syncDescartarRechazada(r.id), "Aviso descartado")
                      }
                    >
                      Descartar
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="sync-sub">Código para las demás PC (cópialo y mándalo por WhatsApp):</div>
            <div className="sync-codigo">{codigo || "..."}</div>
            <div className="sync-acciones">
              {codigo && <CopyButton texto={codigo} className="btn btn-accent" etiqueta="Copiar código" />}
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
              {sync.pcs.map((p) => {
                const pct = Math.round(p.completado);
                return (
                  <li key={p.id} className={p.conectado ? "" : "sync-pc-off"}>
                    <span className={`midi-dot ${p.conectado ? "on" : "off"}`} />
                    <div className="sync-pc-info">
                      <b className="sync-pc-nombre" title={p.nombre}>
                        {p.nombre}
                      </b>
                      <span className="sync-dim">
                        {p.conectado ? "Conectada ahora" : cuandoSeVio(p.ultimo_visto)}
                      </span>
                    </div>
                    <div
                      className="sync-pc-pct"
                      title={
                        p.conectado
                          ? `Tiene el ${pct}% de la biblioteca`
                          : `La última vez que se conectó quedó con el ${pct}% de la biblioteca de hoy`
                      }
                    >
                      <span className="sync-pc-num">
                        {!p.conectado && !p.ultimo_visto ? (
                          <span className="sync-dim">—</span>
                        ) : (
                          <>
                            {pct}%{!p.conectado && <span className="sync-dim"> al irse</span>}
                          </>
                        )}
                      </span>
                      <span className="sync-pc-barra">
                        <span className={pct >= 100 ? "llena" : ""} style={{ width: `${Math.min(100, pct)}%` }} />
                      </span>
                    </div>
                    <button
                      className="btn dl-mini"
                      disabled={!!ocupado}
                      title="Ponerle un nombre para saber qué PC es"
                      onClick={() =>
                        askPrompt("Nombre para esta PC (ej: Portátil Sharon)", p.nombre, (n) => {
                          if (n.trim()) void correr("renombrar", () => syncRenombrarPc(p.id, n), "Nombre guardado");
                        })
                      }
                    >
                      Renombrar
                    </button>
                    <button
                      className="btn dl-mini sync-peligro"
                      disabled={!!ocupado}
                      title="Sacarla del grupo: deja de recibir y de subir, y no puede volver a entrar con el código actual"
                      onClick={() =>
                        askConfirm(
                          `¿Quitar a "${p.nombre}" del grupo? Deja de recibir y de subir música, y no podrá volver a entrar con el código actual (solo con uno nuevo).`,
                          () => void correr("quitar", () => syncQuitarPc(p.id), `${p.nombre} quitada del grupo`)
                        )
                      }
                    >
                      Quitar
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="sync-sub">Aunque la app esté cerrada:</div>
            <div className="sync-acciones">
              {sync.servicio_activo ? (
                <span className="sync-row" style={{ margin: 0 }}>
                  <span className="midi-dot on" />
                  Siempre encendida: arranca sola al iniciar sesión en este PC.
                </span>
              ) : (
                <button
                  className="btn"
                  disabled={!!ocupado}
                  onClick={() =>
                    void correr("servicio", syncInstalarServicio, "Listo: la sincronización arranca sola al iniciar sesión")
                  }
                >
                  {ocupado === "servicio" ? "Instalando..." : "Mantener siempre encendida"}
                </button>
              )}
              <button className="btn" onClick={() => void syncLog().then(setLog)}>
                Ver registro
              </button>
            </div>
          </div>
        )}

        {sync && sync.rol === "equipo" && (
          <div className="dl-section">
            {sync.codigo_rechazado && (
              <div className="dl-warn" style={{ marginBottom: 12 }}>
                ⚠ El PC original no ha aceptado este código. Puede ser que el código ya no sirva (si en el PC
                original le dieron a «Cambiar código») o que el PC original esté apagado o sin internet. Pídele a
                Camilo el código de ahora y vuelve a entrar con él.
              </div>
            )}
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
            {sync.por_subir > 0 && (
              <div className="sync-row">
                ⬆ Subiendo <b>{sync.por_subir}</b> canciones ({sync.por_subir_mb.toFixed(0)} MB) al PC original...
              </div>
            )}
            <div className="sync-row">
              Biblioteca en esta PC: <b>{Math.round(sync.completado)}%</b>
              {sync.pendientes > 0 ? ` · faltan ${sync.pendientes} (${sync.pendientes_mb.toFixed(0)} MB)` : " · al día"}
            </div>
            <div className="sync-row sync-dim">
              {!sync.autorizado && "En espera de tu autorización."}
              {sync.autorizado && sync.pausa_manual && "⏸ En pausa (la pausaste tú)."}
              {sync.autorizado && !sync.pausa_manual && "▶ Sincronizando en segundo plano, también con música sonando."}
            </div>
            <div className="sync-acciones">
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
          <div className="modal-actions sync-cerrar">
            <button className="btn" onClick={cerrar}>
              Cerrar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "Última vez: hoy 21:30" / "ayer 18:05" / "lun 27 oct, 14:10". */
function cuandoSeVio(iso: string, que = "Última vez"): string {
  if (!iso) return "Nunca se ha conectado";
  const f = new Date(iso);
  if (isNaN(f.getTime())) return `${que}: ${iso}`;
  const hora = f.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const dia = new Date(f);
  dia.setHours(0, 0, 0, 0);
  const dias = Math.round((hoy.getTime() - dia.getTime()) / 86400000);
  if (dias <= 0) return `${que}: hoy ${hora}`;
  if (dias === 1) return `${que}: ayer ${hora}`;
  const anio = f.getFullYear() !== hoy.getFullYear() ? ` ${f.getFullYear()}` : "";
  return `${que}: ${DIAS[f.getDay()]} ${f.getDate()} ${MESES[f.getMonth()]}${anio}, ${hora}`;
}

/** Texto corto para el botón de la barra: el estado en tres palabras. */
export function etiquetaSync(e: ReturnType<typeof useStore.getState>["sync"]): { texto: string; clase: string } {
  if (!e || e.rol === "ninguno") return { texto: "Sync", clase: "" };
  if (!e.activo) return { texto: "Sync: arrancando", clase: "sync-off" };
  if (e.rol === "original") {
    const n = e.pcs.filter((p) => p.conectado).length;
    // Lo de "sin entrar" manda sobre el resto: es lo unico que pide algo de
    // quien mira (pasar el codigo nuevo), y antes no se veia en ningun lado.
    if (e.rechazadas.length > 0) {
      return { texto: `Sync: ${n} PC · ${e.rechazadas.length} sin entrar`, clase: "sync-warn" };
    }
    if (e.pendientes > 0) return { texto: `Sync: recibiendo ${e.pendientes}`, clase: "sync-on" };
    return { texto: `Sync: ${n} PC`, clase: "sync-on" };
  }
  // Antes esto salia como "sin conexion" y parecia un problema de internet,
  // asi que nadie iba a pedir un codigo nuevo.
  if (e.codigo_rechazado) return { texto: "Sync: código no aceptado", clase: "sync-warn" };
  if (!e.original_conectado) return { texto: "Sync: sin conexión", clase: "sync-off" };
  if (e.por_subir > 0 && !e.pausa_manual) return { texto: `Sync: subiendo ${e.por_subir}`, clase: "sync-on" };
  if (e.pendientes === 0) return { texto: "Sync: al día", clase: "sync-on" };
  if (!e.autorizado) return { texto: `Sync: faltan ${e.pendientes}`, clase: "sync-warn" };
  if (e.pausa_manual) return { texto: "Sync: en pausa", clase: "sync-warn" };
  return { texto: `Sync: bajando ${e.pendientes}`, clase: "sync-on" };
}
