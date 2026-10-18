import { useState } from "react";
import { useStore } from "../state/store";
import { syncUnirse } from "../lib/tauri";

/**
 * Primera pantalla: pegar el código que manda el PC original. No hay forma de
 * elegir una carpeta del computador: la biblioteca SIEMPRE es la sincronizada
 * (pedido explícito: que nadie use carpetas locales). El PC original ya está
 * configurado; si hubiera que rehacerlo, es con `--sync-cli crear` (solo Camilo).
 */
export function Welcome() {
  const showToast = useStore((s) => s.showToast);
  const [codigo, setCodigo] = useState("");
  const [uniendo, setUniendo] = useState(false);
  const [error, setError] = useState("");

  const unirse = async () => {
    const c = codigo.trim();
    if (!c || uniendo) return;
    setUniendo(true);
    setError("");
    try {
      await syncUnirse(c);
      // useSync fija la carpeta en cuanto Rust diga que el rol es "equipo".
      showToast("Unida al grupo. Empezando a recibir la biblioteca...");
    } catch (e) {
      setError(String(e));
    } finally {
      setUniendo(false);
    }
  };

  return (
    <div className="welcome">
      <h1>Infiniity DJ</h1>
      <p>
        Pega aquí el <b>código</b> que te mandaron desde el PC original. La app crea su carpeta y
        empieza a recibir toda la música sola.
      </p>
      <textarea
        className="dl-input welcome-codigo"
        placeholder="IDJ1-..."
        value={codigo}
        onChange={(e) => setCodigo(e.target.value)}
        rows={3}
        spellCheck={false}
      />
      <button
        className="btn btn-accent"
        style={{ fontSize: 18, padding: "14px 28px" }}
        disabled={!codigo.trim() || uniendo}
        onClick={unirse}
      >
        {uniendo ? "Entrando (baja Syncthing, ~11 MB)..." : "🔁 Entrar al grupo con el código"}
      </button>
      {error && <div className="dl-warn welcome-error">{error}</div>}
      <p className="welcome-alt">
        El código te lo manda Camilo desde su app (botón <b>Sync</b>). Toda la música llega sola a esta
        PC; no hay que elegir ninguna carpeta.
      </p>
    </div>
  );
}
