import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import {
  isTauri,
  preescuchaEstado,
  preescuchaOpciones,
  preescuchaParar,
  preescuchaTocar,
  preescuchaVolumen,
  type EstadoPreescucha,
  type OpcionesPreescucha,
} from "../lib/tauri";
import { fmtTime } from "../lib/format";
import { IconAudifonos, IconPause, IconPlay } from "./Icons";

const CLAVE_SALIDA = "infiniity-dj-audifonos";

function salidaRecordada(): string | null {
  try {
    return localStorage.getItem(CLAVE_SALIDA);
  } catch (e) {
    console.warn("[preescucha] no se pudo leer la salida recordada", e);
    return null;
  }
}
function recordarSalida(sink: string) {
  try {
    localStorage.setItem(CLAVE_SALIDA, sink);
  } catch (e) {
    console.warn("[preescucha] no se pudo recordar la salida", e);
  }
}

/** La de audífonos si se ve enchufada; si no, la recordada; si no, la primera. */
function elegirSalida(o: OpcionesPreescucha): string | null {
  if (o.salidas.length === 0) return null;
  const rec = salidaRecordada();
  if (rec && o.salidas.some((s) => s.name === rec)) return rec;
  return (o.salidas.find((s) => s.audifonos === true) ?? o.salidas[0]).name;
}

/**
 * Barra de PRE-ESCUCHA: suena SOLO en los audífonos, de cable o Bluetooth si
 * la cabina va por cable (ver
 * src-tauri/src/preescucha.rs). Aparece al tocar el botón de audífonos de una
 * canción o de un deck. No toca nada del sonido de la cabina.
 */
export function Preescucha() {
  const pedida = useStore((s) => s.preescuchaPedida);
  const cerrarPedida = useStore((s) => s.cerrarPreescucha);
  const [opciones, setOpciones] = useState<OpcionesPreescucha | null>(null);
  const [sink, setSink] = useState<string | null>(null);
  const [estado, setEstado] = useState<EstadoPreescucha | null>(null);
  const [ocupado, setOcupado] = useState("");
  const [error, setError] = useState("");
  const sinkRef = useRef<string | null>(null);
  sinkRef.current = sink;

  const tocar = async (ruta: string, desde: number, destino: string) => {
    setOcupado("Preparando la pre-escucha...");
    setError("");
    try {
      setEstado(await preescuchaTocar(ruta, desde, destino));
    } catch (e) {
      setError(String(e));
    } finally {
      setOcupado("");
    }
  };

  // Cada pedido nuevo: buscar dónde están los audífonos y empezar a sonar.
  useEffect(() => {
    if (!pedida) return;
    if (!isTauri()) {
      setError("La pre-escucha solo funciona en la app instalada.");
      return;
    }
    let vivo = true;
    setOcupado("Buscando los audífonos...");
    setError("");
    preescuchaOpciones()
      .then((o) => {
        if (!vivo) return;
        setOpciones(o);
        const s = sinkRef.current && o.salidas.some((x) => x.name === sinkRef.current) ? sinkRef.current : elegirSalida(o);
        setSink(s);
        setOcupado("");
        if (s) void tocar(pedida.ruta, pedida.desde, s);
      })
      .catch((e) => {
        if (!vivo) return;
        setOcupado("");
        setError(String(e));
      });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedida?.n]);

  // Posición en pantalla: se pregunta dos veces por segundo mientras está abierta.
  useEffect(() => {
    if (!pedida || !isTauri()) return;
    const t = window.setInterval(() => {
      preescuchaEstado()
        .then(setEstado)
        .catch((e) => console.error("[preescucha] no se pudo leer el estado", e));
    }, 500);
    return () => window.clearInterval(t);
  }, [pedida]);

  if (!pedida) return null;

  const cerrar = () => {
    if (isTauri()) {
      preescuchaParar().catch((e) => console.error("[preescucha] no se pudo parar", e));
    }
    setEstado(null);
    setError("");
    cerrarPedida();
  };

  const sonando = !!estado?.sonando;
  const pos = estado?.posicion ?? pedida.desde;
  const dur = estado?.duracion ?? 0;
  const salidaActual = opciones?.salidas.find((s) => s.name === sink);

  const pausar = async () => {
    try {
      setEstado(await preescuchaParar());
    } catch (e) {
      setError(String(e));
    }
  };
  const saltar = (a: number) => {
    if (!sink) return;
    void tocar(pedida.ruta, Math.max(0, dur > 0 ? Math.min(a, dur - 1) : a), sink);
  };

  return (
    <div className="glass glass-strong preescucha" role="region" aria-label="Pre-escucha en audífonos">
      <div className="pre-fila">
        <span className="pre-icono">
          <IconAudifonos size={18} />
        </span>
        <div className="pre-titulo">
          <span className="pre-etiqueta">Pre-escucha · solo en audífonos</span>
          <b title={pedida.nombre}>{pedida.nombre}</b>
        </div>
        <button className="btn dl-mini" disabled={!sink || !!ocupado} onClick={() => saltar(pos - 10)} title="Atrás 10 s">
          −10 s
        </button>
        <button
          className="btn btn-icon btn-accent"
          disabled={!sink || !!ocupado}
          title={sonando ? "Pausar la pre-escucha" : "Seguir oyendo"}
          onClick={() => (sonando ? void pausar() : saltar(pos))}
        >
          {sonando ? <IconPause size={18} /> : <IconPlay size={18} />}
        </button>
        <button className="btn dl-mini" disabled={!sink || !!ocupado} onClick={() => saltar(pos + 10)} title="Adelante 10 s">
          +10 s
        </button>
        <button className="btn dl-mini" onClick={cerrar} title="Cerrar la pre-escucha">
          Cerrar
        </button>
      </div>

      <div className="pre-fila">
        <span className="pre-tiempo">{fmtTime(pos)}</span>
        <div
          className="pre-barra"
          title="Clic para ir a esa parte"
          onClick={(e) => {
            if (!dur) return;
            const r = e.currentTarget.getBoundingClientRect();
            saltar(((e.clientX - r.left) / r.width) * dur);
          }}
        >
          <span style={{ width: dur ? `${Math.min(100, (pos / dur) * 100)}%` : "0%" }} />
        </div>
        <span className="pre-tiempo">{dur ? fmtTime(dur) : "--:--"}</span>
        <input
          className="vol-slider pre-vol"
          type="range"
          min={0}
          max={100}
          step={1}
          value={estado?.volumen ?? 80}
          title="Volumen de los audífonos"
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            setEstado((s) => (s ? { ...s, volumen: v } : s));
            preescuchaVolumen(v).catch((err) => setError(String(err)));
          }}
        />
      </div>

      {opciones && opciones.salidas.length > 1 && (
        <div className="pre-fila pre-dim">
          Audífonos en:
          <select
            value={sink ?? ""}
            onChange={(e) => {
              setSink(e.target.value);
              recordarSalida(e.target.value);
              void tocar(pedida.ruta, pos, e.target.value);
            }}
          >
            {opciones.salidas.map((s) => (
              <option key={s.name} value={s.name}>
                {s.description}
                {s.bluetooth ? " (Bluetooth)" : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {ocupado && <div className="pre-fila pre-dim">{ocupado}</div>}
      {opciones && opciones.salidas.length === 0 && (
        <div className="dl-warn pre-aviso">
          No hay dónde pre-escuchar: la música sale por «{opciones.principal}», y por esa misma salida la oiría todo
          el mundo. Hace falta una de dos: la cabina por Bluetooth y los audífonos de cable, o la cabina por cable y
          los audífonos Bluetooth (en «Configuración → Audio», toca «Como audífonos»).
        </div>
      )}
      {salidaActual?.audifonos === false && (
        <div className="dl-warn pre-aviso">
          ⚠ No detecto audífonos enchufados: está sonando por los parlantes del portátil. Conecta los audífonos de
          cable.
        </div>
      )}
      {(error || estado?.error) && <div className="dl-error-msg pre-aviso">{error || estado?.error}</div>}
    </div>
  );
}
