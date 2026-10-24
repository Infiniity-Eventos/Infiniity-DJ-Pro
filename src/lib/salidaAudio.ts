/**
 * Salida de audio: mantener el sonido de la app en la salida que eligio el
 * usuario (cabina, HDMI, Bluetooth...).
 *
 * POR QUE HAY QUE REAPLICARLO Y NO ALCANZA CON ELEGIRLO UNA VEZ:
 * el navegador interno abre y cierra su conexion con el sonido del sistema
 * cuando quiere (por ejemplo si el motor de audio se queda dormido un rato).
 * Cada conexion nueva arranca donde diga el sistema, no donde la pusimos
 * nosotros. Si no se reaplica, en mitad de un evento el sonido se vuelve solo
 * a los parlantes del portatil.
 */

import { audioSetOutput } from "./tauri";
import { useStore } from "../state/store";

/** La salida guardada ya esta aplicada al flujo de sonido que suena ahora. */
let aplicada = false;
/** El aviso de fallo se muestra una sola vez (si no, saldria en cada play). */
let avisado = false;

/**
 * Manda el sonido a `sink`. Devuelve cuantos flujos se movieron:
 * 0 = la app todavia no estaba sonando (no habia nada que mover).
 */
export async function aplicarSalida(sink: string): Promise<number> {
  const movidos = await audioSetOutput(sink);
  aplicada = movidos > 0;
  return movidos;
}

/**
 * Reaplica la salida guardada si hace falta. Se llama al arrancar el motor de
 * audio y en cada play: es barato y es el unico momento seguro para saber que
 * la conexion de sonido existe.
 */
export async function aplicarSalidaGuardada(): Promise<void> {
  const { audioSink, showToast } = useStore.getState();
  if (!audioSink || aplicada) return;
  try {
    await aplicarSalida(audioSink);
  } catch (err) {
    // Nunca en silencio: si el sonido se queda en el portatil, el usuario
    // tiene que saber por que y no pensar que la app esta rota.
    console.error("[salidaAudio] no se pudo aplicar la salida guardada", err);
    if (!avisado) {
      avisado = true;
      showToast(
        `El sonido no se pudo mandar a la salida elegida: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
}
