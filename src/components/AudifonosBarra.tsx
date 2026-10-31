import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { apagarTodo, cambiarSalidaAudifonos, volumenAudifonos } from "../lib/audifonos";
import { isTauri, preescuchaOpciones, type OpcionesPreescucha } from "../lib/tauri";
import { IconAudifonos } from "./Icons";

/**
 * Barrita de los AUDÍFONOS DE LOS DECKS (lib/audifonos.ts): qué decks se oyen,
 * su volumen (aparte del VOL general), por dónde salen y, si fallan, por qué.
 * Solo aparece con algún deck en audífonos o con un error que contar.
 */
export function AudifonosBarra() {
  const a = useStore((s) => s.audifonos);
  const patch = useStore((s) => s.patchAudifonos);
  const [opciones, setOpciones] = useState<OpcionesPreescucha | null>(null);
  const activa = a.A || a.B;

  useEffect(() => {
    if (!activa || !isTauri()) return;
    preescuchaOpciones()
      .then(setOpciones)
      .catch((e) => console.error("[audifonos] no se pudieron leer las salidas", e));
  }, [activa]);

  if (!activa && !a.error) return null;

  return (
    <div className="glass glass-strong audifonos-barra" role="region" aria-label="Audífonos de los decks">
      <div className="pre-fila">
        <span className="pre-icono">
          <IconAudifonos size={16} />
        </span>
        <div className="pre-titulo">
          <span className="pre-etiqueta">Solo en tus audífonos</span>
          <b>
            {activa
              ? a.A && a.B
                ? "Deck A + Deck B"
                : a.A
                ? "Deck A"
                : "Deck B"
              : "Apagados"}
          </b>
        </div>
        {activa ? (
          <button className="btn dl-mini" onClick={() => apagarTodo()} title="Quitar los dos decks de los audífonos">
            Apagar
          </button>
        ) : (
          <button className="btn dl-mini" onClick={() => patch({ error: "" })} title="Cerrar este aviso">
            Cerrar
          </button>
        )}
      </div>
      {activa && (
        <div className="pre-fila pre-dim">
          Vol
          <input
            className="vol-slider pre-vol"
            type="range"
            min={0}
            max={1.5}
            step={0.01}
            value={a.volumen}
            title="Volumen de los audífonos (aparte del VOL general)"
            onChange={(e) => volumenAudifonos(parseFloat(e.target.value))}
          />
          <span className="pre-tiempo">{Math.round(a.volumen * 100)}%</span>
        </div>
      )}
      {activa && opciones && opciones.salidas.length > 1 && (
        <div className="pre-fila pre-dim">
          En:
          <select value={a.sink ?? ""} disabled={a.abriendo} onChange={(e) => void cambiarSalidaAudifonos(e.target.value)}>
            {opciones.salidas.map((s) => (
              <option key={s.name} value={s.name}>
                {s.description}
                {s.bluetooth ? " (Bluetooth)" : ""}
              </option>
            ))}
          </select>
        </div>
      )}
      {a.abriendo && <div className="pre-fila pre-dim">Abriendo los audífonos...</div>}
      {a.error && <div className="dl-error-msg pre-aviso">{a.error}</div>}
    </div>
  );
}
