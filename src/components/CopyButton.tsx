import { useState } from "react";
import { copiarTexto } from "../lib/clipboard";

/**
 * Boton para copiar un mensaje de error de un clic.
 *
 * Existe para que, cuando algo falle en la PC de otra persona, pueda mandarnos
 * el error exacto por WhatsApp sin transcribirlo a mano ni mandar una foto
 * borrosa. Confirma en pantalla si copio o no: un boton que falla en silencio
 * es peor que no tenerlo.
 */
export function CopyButton({ texto, className }: { texto: string; className?: string }) {
  const [estado, setEstado] = useState<"" | "ok" | "fallo">("");

  const copiar = async () => {
    const ok = await copiarTexto(texto);
    setEstado(ok ? "ok" : "fallo");
    window.setTimeout(() => setEstado(""), 2500);
  };

  return (
    <button
      className={className ?? "btn dl-mini"}
      onClick={copiar}
      title="Copiar el error para poder enviarlo"
    >
      {estado === "ok" && "✅ Copiado"}
      {estado === "fallo" && "❌ No se pudo copiar"}
      {estado === "" && "📋 Copiar error"}
    </button>
  );
}
