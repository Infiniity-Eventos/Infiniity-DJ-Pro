import { useEffect, useState } from "react";
import { systemStats, diagReveal, isTauri, type SystemStats } from "../lib/tauri";
import { useStore } from "../state/store";

/**
 * Chip discreto (abajo a la izquierda) con el consumo REAL de la app (RAM y CPU).
 * Además registra cada muestra en un archivo de diagnóstico, para medir el
 * rendimiento en el equipo real. Clic en el chip = abre la carpeta del archivo.
 */
export function StatsMonitor() {
  const [stats, setStats] = useState<SystemStats | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    const tick = async () => {
      try {
        // Anotar qué está haciendo la app (para entender los picos de consumo).
        const s0 = useStore.getState();
        const decks = s0.decks;
        const playing = (decks.A.isPlaying ? 1 : 0) + (decks.B.isPlaying ? 1 : 0);
        const loaded = (decks.A.trackPath ? 1 : 0) + (decks.B.trackPath ? 1 : 0);
        const modo = s0.lowPower ? "BAJO-CONSUMO-ON" : "modo-normal";
        const ventana = document.visibilityState === "hidden" ? "OCULTA" : "visible";
        const note = `v${__APP_VERSION__} | ${playing} sonando, ${loaded} cargadas, ${modo}, ventana:${ventana}`;
        const s = await systemStats(note);
        if (alive) setStats(s);
      } catch {
        /* ignorar */
      }
    };
    void tick();
    const id = window.setInterval(tick, 2000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  if (!stats) return null;
  const ram = Math.round(stats.ram_mb);
  const cpu = Math.round(stats.cpu_pct);
  const cpuLevel = cpu > 70 ? "hi" : cpu > 35 ? "mid" : "lo";

  return (
    <div
      className="stats-monitor glass"
      title="Consumo real de la app. Clic para abrir la carpeta del diagnóstico (enviármelo)."
      onClick={() => diagReveal()}
      style={{ cursor: "pointer" }}
    >
      <span className="stat">
        <b>{ram}</b> MB
      </span>
      <span className="stat-sep" />
      <span className={`stat cpu-${cpuLevel}`}>
        <b>{cpu}</b>% CPU
      </span>
      <span className="stat-sep" />
      <span className="stat" style={{ opacity: 0.7 }}>
        📋
      </span>
    </div>
  );
}
