import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { syncUnirse, modoDibujo, isTauri } from "../lib/tauri";

/**
 * Primera pantalla: pegar el código que manda el PC original. No hay forma de
 * elegir una carpeta del computador: la biblioteca SIEMPRE es la sincronizada
 * (pedido explícito: que nadie use carpetas locales). El PC original ya está
 * configurado; si hubiera que rehacerlo, es con `--sync-cli crear` (solo Camilo).
 */
export function Welcome() {
  const showToast = useStore((s) => s.showToast);
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [uniendo, setUniendo] = useState(false);
  const [error, setError] = useState("");
  // Version y modo de dibujo a la vista: con una foto de esta pantalla se sabe
  // si la PC esta en la ultima version y si cayo en modo seguro tras un fallo.
  const [dibujo, setDibujo] = useState("");
  useEffect(() => {
    if (!isTauri()) return;
    modoDibujo()
      .then((m) => setDibujo(m.software ? `software (${m.motivo})` : "GPU"))
      .catch((e) => setDibujo(`desconocido (${e})`));
  }, []);

  // Pegar desde el portapapeles sin tener que escribir ni usar Ctrl+V.
  const pegar = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (!t.trim()) {
        setError("El portapapeles está vacío: copia el código del WhatsApp primero.");
        return;
      }
      setCodigo(t.trim());
      setError("");
    } catch (e) {
      setError(`No se pudo leer el portapapeles (${e}). Haz clic en el cuadro y usa Ctrl+V.`);
    }
  };

  const unirse = async () => {
    const c = codigo.trim();
    if (!c || uniendo) return;
    setUniendo(true);
    setError("");
    try {
      await syncUnirse(c, nombre);
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
      <img className="jimbo jimbo-welcome" src="/jimbo.webp" alt="" width={150} height={147} decoding="async" draggable={false} />
      <h1>Infiniity DJ</h1>
      <div className="welcome-version">
        versión {__APP_VERSION__}
        {dibujo && ` · dibujo: ${dibujo}`}
      </div>
      <p>
        Pega aquí el <b>código</b> que te mandaron desde el PC original. La app crea su carpeta y
        empieza a recibir toda la música sola.
      </p>
      <input
        className="dl-input welcome-nombre"
        placeholder="Nombre de esta PC (ej: Portátil Sharon)"
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        onMouseDown={(e) => (e.currentTarget as HTMLInputElement).focus()}
        maxLength={40}
        autoFocus
      />
      <div className="welcome-fila">
        <textarea
          className="dl-input welcome-codigo"
          placeholder="IDJ1-..."
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          onMouseDown={(e) => (e.currentTarget as HTMLTextAreaElement).focus()}
          rows={3}
          spellCheck={false}
        />
        <button className="btn" onClick={pegar} title="Pegar el código copiado del WhatsApp">
          📋 Pegar código
        </button>
      </div>
      <button
        className="btn btn-accent"
        style={{ fontSize: 18, padding: "14px 28px" }}
        disabled={!codigo.trim() || !nombre.trim() || uniendo}
        onClick={unirse}
      >
        {uniendo ? "Entrando (baja Syncthing, ~11 MB)..." : "🔁 Entrar al grupo con el código"}
      </button>
      {error && <div className="dl-warn welcome-error">{error}</div>}
      <p className="welcome-alt">
        El código te lo manda Camilo desde su app (<b>Configuración → Sync</b>). Toda la música llega sola a esta
        PC; no hay que elegir ninguna carpeta.
      </p>
    </div>
  );
}
