import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { notaGuardar, notaQuitar } from "../lib/tauri";
import { recargarNotas } from "../lib/notas";

/** Lo que mas se repite, para escribir la nota de un toque. */
const RAPIDAS = [
  "No va en esta carpeta",
  "El artista está mal",
  "El nombre está mal escrito",
  "Suena mal o está cortada",
  "Está repetida",
];

/**
 * Notas sobre una cancion (clic derecho en la lista). Viajan por Sync al PC
 * original y la skill /Organizar_Canciones las lee y las atiende; ver notas.rs.
 * Es un cuadro propio (no window.prompt): la musica sigue sonando.
 */
export function NotaModal() {
  const t = useStore((s) => s.notaDe);
  const musicRoot = useStore((s) => s.musicRoot);
  const todas = useStore((s) => s.notas);
  const cerrar = () => useStore.getState().abrirNota(null);
  const [texto, setTexto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (t) {
      setTexto("");
      setTimeout(() => ref.current?.focus(), 30);
    }
  }, [t]);

  if (!t || !musicRoot) return null;
  const relativa = t.path.startsWith(musicRoot + "/") ? t.path.slice(musicRoot.length + 1) : t.path;
  const deEsta = todas.filter((n) => n.cancion === relativa);
  const { showToast } = useStore.getState();

  const guardar = async () => {
    if (!texto.trim() || guardando) return;
    setGuardando(true);
    try {
      await notaGuardar(musicRoot, t.path, t.title && t.artist ? `${t.title} · ${t.artist}` : t.name, texto);
      showToast("Nota guardada: le llegará al PC principal para que la revisen");
      await recargarNotas();
      cerrar();
    } catch (err) {
      console.error("[NotaModal] no se pudo guardar", err);
      showToast(`No se pudo guardar la nota: ${err}`);
    } finally {
      setGuardando(false);
    }
  };

  const quitar = async (archivo: string) => {
    try {
      await notaQuitar(musicRoot, archivo);
      await recargarNotas();
      showToast("Nota quitada");
    } catch (err) {
      console.error("[NotaModal] no se pudo quitar", err);
      showToast(`No se pudo quitar la nota: ${err}`);
    }
  };

  return (
    <div className="modal-overlay modal-encima" onClick={cerrar}>
      <div className="glass glass-strong modal-box nota-box" onClick={(e) => e.stopPropagation()}>
        <div className="dl-title">Nota sobre esta canción</div>
        <div className="nota-cancion">
          <b>{t.title ?? t.name}</b>
          {t.artist && <span> · {t.artist}</span>}
          <div className="nota-carpeta">Carpeta: {relativa.includes("/") ? relativa.slice(0, relativa.lastIndexOf("/")) : "(principal)"}</div>
        </div>

        {deEsta.length > 0 && (
          <ul className="nota-lista">
            {deEsta.map((n) => (
              <li key={n.archivo}>
                <span className="nota-texto">✎ {n.texto}</span>
                <span className="nota-quien">
                  {n.equipo} · {n.fecha.slice(0, 16).replace("T", " ")}
                </span>
                <button className="btn nota-quitar" onClick={() => void quitar(n.archivo)}>
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="nota-rapidas">
          {RAPIDAS.map((r) => (
            <button key={r} className="btn" onClick={() => setTexto((v) => (v.trim() ? `${v.trim()}. ${r}` : r))}>
              {r}
            </button>
          ))}
        </div>
        <textarea
          ref={ref}
          className="dl-input nota-input"
          rows={3}
          placeholder="Ej.: es merengue, no salsa"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void guardar();
            }
            if (e.key === "Escape") cerrar();
          }}
        />
        <div className="nota-ayuda">La nota viaja sola al PC principal; cuando la revisen, desaparece.</div>
        <div className="modal-actions">
          <button className="btn" onClick={cerrar}>
            Cerrar
          </button>
          <button className="btn btn-accent" disabled={!texto.trim() || guardando} onClick={() => void guardar()}>
            {guardando ? "Guardando..." : "Guardar nota"}
          </button>
        </div>
      </div>
    </div>
  );
}
