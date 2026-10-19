import { useState } from "react";
import { automix } from "../audio/Automix";
import { useStore } from "../state/store";
import { fmtTime } from "../lib/format";

/**
 * Barra lateral del Automix: la cola de canciones que se mezclan solas.
 * Tercera columna de la biblioteca (Carpetas · Lista · Automix), plegable.
 *
 * - Se arrastran canciones desde la lista (o se reordenan dentro).
 * - Boton de encendido/apagado, Saltar y Limpiar.
 * - Cada fila: posicion, nombre, BPM, duracion; marcas "Sonando", "Siguiente"
 *   (o "cargando..."), "ya sonó" y "no se pudo cargar".
 */

/** Tipo de dato de arrastre de una fila de la cola (distinto del de la lista, que es text/plain). */
const TIPO_ITEM = "application/x-infiniity-cola";

export function AutomixBar() {
  const am = useStore((s) => s.automix);
  const patchAutomix = useStore((s) => s.patchAutomix);
  const library = useStore((s) => s.library);
  const decks = useStore((s) => s.decks);
  const askConfirm = useStore((s) => s.askConfirm);
  const [sobre, setSobre] = useState<number | null>(null); // indice donde caeria lo arrastrado

  const indiceDeEvento = (e: React.DragEvent, indiceFila?: number): number => {
    if (indiceFila === undefined) return am.cola.length;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mitad = rect.top + rect.height / 2;
    return e.clientY < mitad ? indiceFila : indiceFila + 1;
  };

  const soltar = (e: React.DragEvent, indiceFila?: number) => {
    e.preventDefault();
    e.stopPropagation();
    const destino = indiceDeEvento(e, indiceFila);
    setSobre(null);
    const idItem = e.dataTransfer.getData(TIPO_ITEM);
    if (idItem) {
      automix.mover(idItem, destino);
      return;
    }
    const path = e.dataTransfer.getData("text/plain");
    if (!path || !library) return;
    const pista = library.tracks.find((t) => t.path === path);
    if (!pista) return;
    automix.insertar(pista, destino);
  };

  const encima = (e: React.DragEvent, indiceFila?: number) => {
    e.preventDefault();
    e.stopPropagation();
    setSobre(indiceDeEvento(e, indiceFila));
  };

  const limpiar = () => {
    if (am.cola.length === 0) return;
    askConfirm(`¿Vaciar la cola del automix (${am.cola.length} canciones)? La que suena sigue sonando.`, () => automix.limpiar(), {
      yesLabel: "Sí, vaciar",
    });
  };

  const alternar = () => {
    if (am.encendido) automix.apagar();
    else automix.encender();
  };

  // Que suena ahora: el item de la cola, o lo que haya en el deck (si vino de fuera de la cola).
  const sonando = am.cola.find((c) => c.id === am.sonandoId);
  const deckSonando = decks.A.isPlaying ? decks.A : decks.B.isPlaying ? decks.B : null;
  const textoSonando = sonando?.nombre ?? deckSonando?.trackName ?? null;

  if (am.plegada) {
    return (
      <div className="glass automix automix-plegada" onClick={() => patchAutomix({ plegada: false })} title="Abrir la cola del automix">
        <div className={`automix-led ${am.encendido ? "on" : ""}`} />
        <div className="automix-vertical">AUTOMIX{am.cola.length ? ` · ${am.cola.length}` : ""}</div>
      </div>
    );
  }

  return (
    <div
      className={`glass automix ${am.encendido ? "encendido" : ""}`}
      onDragOver={(e) => encima(e)}
      onDragLeave={() => setSobre(null)}
      onDrop={(e) => soltar(e)}
    >
      <div className="automix-head">
        <button
          className={`automix-power ${am.encendido ? "on" : ""}`}
          onClick={alternar}
          title={am.encendido ? "Apagar el automix" : "Encender el automix"}
        >
          <span className="automix-power-dot" />
          <span>{am.encendido ? "ENCENDIDO" : "APAGADO"}</span>
        </button>
        <div className="automix-titulo">
          <b>Automix</b>
          <span className="automix-sub">{am.etiqueta ?? (am.cola.length ? "cola armada a mano" : "arrastra canciones aquí")}</span>
        </div>
        <button className="btn btn-icon automix-plegar" onClick={() => patchAutomix({ plegada: true })} title="Plegar">
          ▸
        </button>
      </div>

      <div className="automix-estado">
        {am.encendido ? (
          <>
            <div className="automix-linea">
              <span className="automix-etq">Sonando</span>
              <span className="automix-txt" title={textoSonando ?? ""}>{textoSonando ?? "nada"}</span>
            </div>
            <div className="automix-linea">
              <span className="automix-etq">Siguiente</span>
              <span className="automix-txt">
                {am.mensaje === "mezclando..."
                  ? "mezclando..."
                  : am.siguienteId
                  ? `${am.cola.find((c) => c.id === am.siguienteId)?.nombre ?? ""}${am.siguienteLista ? "" : " (cargando...)"}`
                  : am.mensaje ?? "—"}
              </span>
            </div>
            <div className="automix-linea">
              <span className="automix-etq">Mezcla en</span>
              <span className="automix-txt automix-num">{am.faltan !== null && textoSonando ? fmtTime(am.faltan) : "—"}</span>
            </div>
          </>
        ) : (
          <div className="automix-apagado">
            {am.cola.length
              ? "Enciéndelo y empieza a mezclar solo cuando la canción actual vaya a terminar."
              : "Arrastra canciones desde la lista, o usa «Poner automix» en una carpeta."}
          </div>
        )}
      </div>

      <div className="automix-acciones">
        <button className="btn" onClick={() => automix.saltar()} disabled={!am.encendido} title="Pasar ya a la siguiente, con transición suave">
          ⏭ Saltar
        </button>
        <button className="btn" onClick={limpiar} disabled={am.cola.length === 0} title="Vaciar la cola">
          Limpiar
        </button>
      </div>

      <div className="automix-cola">
        {am.cola.length === 0 && (
          <div className={`automix-vacia ${sobre !== null ? "drop" : ""}`}>
            <img className="jimbo" src="/jimbo.webp" alt="" width={110} height={100} decoding="async" draggable={false} />
            <div>
              Suelta aquí las canciones
              <small>o arrástralas desde la biblioteca</small>
            </div>
          </div>
        )}
        {am.cola.map((c, i) => {
          const esSonando = c.id === am.sonandoId;
          const esSiguiente = c.id === am.siguienteId;
          return (
            <div
              key={c.id}
              className={`automix-fila ${esSonando ? "sonando" : ""} ${esSiguiente ? "siguiente" : ""} ${c.sono && !esSonando ? "sono" : ""} ${c.fallo ? "fallo" : ""} ${
                sobre === i ? "sobre-arriba" : sobre === i + 1 && i === am.cola.length - 1 ? "sobre-abajo" : ""
              }`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(TIPO_ITEM, c.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => encima(e, i)}
              onDrop={(e) => soltar(e, i)}
              title={c.fallo ? `No se pudo cargar: ${c.fallo}` : c.nombre}
            >
              <span className="automix-pos">{esSonando ? "▶" : i + 1}</span>
              <span className="automix-nombre">
                {c.nombre}
                {esSiguiente && <small className="automix-marca">{am.siguienteLista ? "siguiente" : "cargando..."}</small>}
                {c.fallo && <small className="automix-marca mal">no se pudo cargar</small>}
              </span>
              <span className="automix-bpm">{c.bpm !== null ? c.bpm.toFixed(0) : "?"}</span>
              <span className="automix-dur">{c.duracion ? fmtTime(c.duracion) : ""}</span>
              <button className="automix-quitar" onClick={() => automix.quitar(c.id)} title="Quitar de la cola">
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
