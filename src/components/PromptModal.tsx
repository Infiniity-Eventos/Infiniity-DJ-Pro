import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";

/**
 * Cuadro para pedir un dato (BPM, nombre de carpeta...) SIN usar window.prompt.
 * Clave: window.prompt bloquea el proceso y PAUSA la música. Este es un modal
 * propio de React que no bloquea nada: el audio sigue sonando.
 */
export function PromptModal() {
  const box = useStore((s) => s.promptBox);
  const close = useStore((s) => s.closePrompt);
  const [val, setVal] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (box) {
      setVal(box.defaultValue);
      // enfocar y seleccionar para editar rápido
      setTimeout(() => inputRef.current?.select(), 30);
    }
  }, [box]);

  if (!box) return null;

  const submit = () => {
    box.onSubmit(val);
    close();
  };

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="glass glass-strong modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-msg">{box.message}</div>
        <input
          ref={inputRef}
          className="dl-input"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") close();
          }}
          style={{ marginBottom: 18 }}
          autoFocus
        />
        <div className="modal-actions">
          <button className="btn" onClick={close}>
            Cancelar
          </button>
          <button className="btn btn-accent" onClick={submit}>
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
