import { useStore } from "../state/store";

/**
 * Aviso de confirmacion propio de la app (no usa window.confirm, que en
 * WebKitGTK es poco fiable y ademas bloquea el audio). No bloquea nada.
 */
export function ConfirmModal() {
  const box = useStore((s) => s.confirmBox);
  const close = useStore((s) => s.closeConfirm);
  if (!box) return null;

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="glass glass-strong modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-msg">{box.message}</div>
        <div className="modal-actions">
          <button className="btn" onClick={close}>
            Cancelar
          </button>
          <button
            className="btn btn-accent"
            onClick={() => {
              box.onYes();
              close();
            }}
          >
            Sí, reemplazar
          </button>
        </div>
      </div>
    </div>
  );
}
