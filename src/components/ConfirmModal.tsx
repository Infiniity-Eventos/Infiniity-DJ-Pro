import { useStore } from "../state/store";

/**
 * Aviso de confirmacion propio de la app (no usa window.confirm, que en
 * WebKitGTK es poco fiable y ademas bloquea el audio). No bloquea nada.
 * Admite un tercer boton (`alt`), p. ej. "Limpiar y poner" / "Añadir al final".
 */
export function ConfirmModal() {
  const box = useStore((s) => s.confirmBox);
  const close = useStore((s) => s.closeConfirm);
  if (!box) return null;

  return (
    <div className="modal-overlay modal-encima" onClick={close}>
      <div className="glass glass-strong modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-msg">{box.message}</div>
        <div className="modal-actions">
          <button className="btn" onClick={close}>
            Cancelar
          </button>
          {box.alt && (
            <button
              className="btn"
              onClick={() => {
                box.alt!.onClick();
                close();
              }}
            >
              {box.alt.label}
            </button>
          )}
          <button
            className="btn btn-accent"
            onClick={() => {
              box.onYes();
              close();
            }}
          >
            {box.yesLabel ?? "Sí, reemplazar"}
          </button>
        </div>
      </div>
    </div>
  );
}
