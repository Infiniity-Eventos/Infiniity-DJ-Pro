import { useCallback, useEffect, useState } from "react";
import { useStore } from "../state/store";
import { audioOutputs, type AudioOutput } from "../lib/tauri";
import { aplicarSalida } from "../lib/salidaAudio";
import { engine } from "../audio/AudioEngine";

/** Etiqueta corta del tipo de salida, para reconocerla de un vistazo. */
const ETIQUETA: Record<string, string> = {
  bluetooth: "Bluetooth",
  hdmi: "HDMI",
  usb: "USB",
  analogica: "Cable / analógica",
  digital: "Digital",
  otra: "Otra",
};

/**
 * Elegir por donde suena la app: cabina, HDMI, parlante Bluetooth...
 *
 * Para que existe: al conectar el portatil a una cabina, el sonido seguia
 * saliendo por los parlantes del portatil aunque otros programas si sonaran
 * por la cabina. El sistema recuerda la salida por programa y este estaba
 * marcado con los parlantes internos.
 */
export function AudioOutputModal({ onClose }: { onClose: () => void }) {
  const audioSink = useStore((s) => s.audioSink);
  const setAudioSink = useStore((s) => s.setAudioSink);
  const showToast = useStore((s) => s.showToast);

  const [salidas, setSalidas] = useState<AudioOutput[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setSalidas(await audioOutputs());
      setError(null);
    } catch (e) {
      setSalidas([]);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const elegir = async (salida: AudioOutput) => {
    setOcupado(true);
    try {
      const movidos = await aplicarSalida(salida.name);
      setAudioSink(salida.name);
      setError(null);
      showToast(
        movidos > 0
          ? `Sonido enviado a: ${salida.description}`
          : `Guardado: ${salida.description}. Dale play (o prueba el pitido) y saldrá por ahí.`
      );
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  };

  const probar = async () => {
    setOcupado(true);
    try {
      await engine.probarSalida();
      // El pitido obliga a que exista la conexion de sonido: recien ahora se
      // puede mover de verdad y confirmar por donde esta saliendo.
      if (audioSink) await aplicarSalida(audioSink);
      setError(null);
      showToast("Debe oírse un pitido por la salida elegida");
      await cargar();
    } catch (e) {
      setError(
        `No se pudo probar el sonido: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="glass glass-strong modal-box dl-box"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dl-title">Salida de audio</div>

        <p className="out-hint">
          Elige por dónde suena la música. Si vas a usar un parlante Bluetooth,
          conéctalo primero desde el sistema y aparecerá en esta lista.
        </p>

        {error && <div className="out-error">⚠ {error}</div>}

        {salidas === null && <div className="dl-empty">Buscando salidas...</div>}

        {salidas !== null && salidas.length === 0 && !error && (
          <div className="dl-empty">No se encontró ninguna salida de audio.</div>
        )}

        <div className="out-list">
          {(salidas ?? []).map((s) => (
            <button
              key={s.name}
              className={`out-row ${s.active ? "active" : ""}`}
              disabled={ocupado}
              onClick={() => void elegir(s)}
              title={s.name}
            >
              <span className="out-name">{s.description}</span>
              <span className="out-kind">{ETIQUETA[s.kind] ?? s.kind}</span>
              {s.active && <span className="out-flag">suena aquí</span>}
              {!s.active && s.name === audioSink && (
                <span className="out-flag out-flag-wait">elegida</span>
              )}
            </button>
          ))}
        </div>

        <div className="modal-actions">
          <button className="btn" disabled={ocupado} onClick={() => void cargar()}>
            Actualizar lista
          </button>
          <button className="btn" disabled={ocupado} onClick={() => void probar()}>
            Probar sonido
          </button>
          <button className="btn btn-accent" onClick={onClose}>
            Listo
          </button>
        </div>
      </div>
    </div>
  );
}
