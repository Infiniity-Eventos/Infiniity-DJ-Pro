import { useState } from "react";
import { useStore } from "../state/store";
import { pickFolder, isTauri, syncUnirse } from "../lib/tauri";
import { reloadLibrary } from "../lib/library";

/**
 * Primera pantalla. Dos caminos:
 * - PC del EQUIPO: pega el código que manda el PC original y listo (la carpeta
 *   la crea la app; no se elige). Es el camino normal.
 * - PC ORIGINAL (o sin grupo): elegir la carpeta de música de este computador.
 */
export function Welcome() {
  const setMusicRoot = useStore((s) => s.setMusicRoot);
  const showToast = useStore((s) => s.showToast);
  const [codigo, setCodigo] = useState("");
  const [uniendo, setUniendo] = useState(false);
  const [error, setError] = useState("");

  const choose = async () => {
    if (!isTauri()) {
      showToast("Esta pantalla funciona dentro de la app instalada");
      return;
    }
    const folder = await pickFolder();
    if (folder) {
      setMusicRoot(folder);
      await reloadLibrary();
    }
  };

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
        ¿Este es el PC <b>original</b> (la carpeta madre de la música) o quieres usar una carpeta
        propia?
      </p>
      <button className="btn" onClick={choose}>
        📁 Elegir carpeta de música de este computador
      </button>
    </div>
  );
}
