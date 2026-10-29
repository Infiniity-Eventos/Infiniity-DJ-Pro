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
 *
 * POR QUE CON BLUETOOTH NO BASTA CON ARRASTRAR EL FLUJO (0.4.33):
 * cambiar de salida se hacia ARRASTRANDO el flujo que ya estaba sonando
 * (`pactl move-sink-input`). Con un cable eso funciona. Con Bluetooth no: el
 * parlante trabaja a otra frecuencia (casi siempre 44100 contra los 48000 del
 * equipo) y con MUCHISIMO mas retardo, asi que al llegar el flujo hay que
 * renegociar el tamaño del bufer. Midiendo el sonido que de verdad sale por la
 * salida destino, ese arrastre deja MAS DE DOS SEGUNDOS de silencio total
 * mientras se renegocia — y eso en el caso facil, sin Bluetooth de por medio.
 * Con un parlante Bluetooth real el motor de audio de WebKitGTK no aguanta esa
 * pausa: se queda en «interrupted» (un estado propio suyo, fuera del estandar)
 * y la musica se para en seco. Era exactamente el fallo reportado: en un
 * portatil dejaba de sonar al cambiar, y en otro sonaba un momento y se cortaba.
 *
 * La solucion es no arrastrar nada: se REHACE la conexion de sonido para que
 * nazca ya pegada al parlante, y asi negocia su bufer con el aparato de verdad.
 * La cancion no se pierde (sigue en memoria) y se reanuda donde iba.
 */

import { audioSetOutput, audioOutputStatus, audioLlegaSonido } from "./tauri";
import { silencioPorMandos } from "./mandos";
import { useStore } from "../state/store";

/** La salida guardada ya esta aplicada al flujo de sonido que suena ahora. */
let aplicada = false;
/** El aviso de fallo se muestra una sola vez (si no, saldria en cada play). */
let avisado = false;

/**
 * Comprueba que a la cabina le LLEGUE el sonido, y si no, dice que hacer.
 *
 * POR QUE: medido en un evento, con la cabina Bluetooth puesta el motor sacaba
 * sonido (-14.4 dB) y a la cabina no llegaba nada (pico 0.00000), con el flujo
 * enganchado, la salida en marcha, sin silencio y al 110%. Todo "correcto" y
 * mudo. Esa situacion no se puede dejar sin explicar en pantalla: el DJ tiene
 * que saber que hacer, no quedarse mirando una app que dice que todo va bien.
 *
 * Tarda unos segundos (graba de la salida), asi que va por detras y sin
 * bloquear nada.
 */
/** Hay una comprobacion en marcha: no lanzar otra encima. */
let comprobando = false;
/** Cuando acabo sin exito la ultima comprobacion (para no repetirla en bucle). */
let ultimoFracaso = 0;

async function comprobarQueLlega(sink: string): Promise<void> {
  const { showToast } = useStore.getState();
  const hayMusica = () => {
    const { decks } = useStore.getState();
    return decks.A.isPlaying || decks.B.isPlaying;
  };
  if (!hayMusica()) return; // sin musica no hay nada que medir
  // Si los mandos no dejan salir la musica (crossfader del otro lado, volumen
  // en 0), la cabina no tiene la culpa: decir que mover y no rehacer nada.
  const porMandos = silencioPorMandos(useStore.getState());
  if (porMandos) {
    showToast(porMandos);
    return;
  }
  // Una sola a la vez: `aplicarSalida` se llama varias veces seguidas al
  // cambiar de salida (y la propia recuperacion la vuelve a llamar).
  if (comprobando) return;
  // Si hace poco ya se intento todo y no funciono, no repetirlo cada vez.
  if (Date.now() - ultimoFracaso < 60000) return;
  comprobando = true;
  try {
    let r = await audioLlegaSonido(sink);
    // RECUPERACION (0.4.51). Lo que fallaba de verdad, segun el registro de un
    // evento: el sistema intentaba conectar el audio de la app a la cabina,
    // fallaba («2 of 2 PipeWire links failed to activate») y NO lo volvia a
    // intentar («tried to link on last rescan, not retrying»). El audio se
    // quedaba "enganchado" a la cabina sobre el papel y sin llegar. Lo que el
    // sistema si hace es conectar desde cero una conexion NUEVA, como hace con
    // Firefox. Asi que, si no llega, se rehace la conexion de sonido de la
    // propia app (no toca nada del equipo) y se vuelve a medir. Dos veces como
    // mucho: si con eso no llega, no es esto.
    for (let intento = 1; intento <= 2 && !r.llega && hayMusica(); intento++) {
      console.warn(`[salidaAudio] no llega sonido a la cabina; rehaciendo la conexión (intento ${intento})`, r.detalle);
      showToast(
        intento === 1
          ? "La cabina no recibía el sonido; rehaciendo la conexión…"
          : "Todavía no llega; un intento más…"
      );
      await rehacerConexionDeSonido();
      // Darle al sistema un momento para conectar la conexion nueva.
      await new Promise((listo) => window.setTimeout(listo, 1500));
      r = await audioLlegaSonido(sink);
    }
    if (r.llega) {
      return;
    }
    if (!hayMusica()) return;
    ultimoFracaso = Date.now();
    console.error("[salidaAudio] no llega sonido a la cabina tras rehacer la conexión:", r.detalle);
    showToast(
      "La cabina no está recibiendo el sonido ni rehaciendo la conexión. Comprueba que esté encendida y con el volumen arriba; si lo está, dale a «Guardar informe»."
    );
  } catch (err) {
    // Que falle la comprobacion no es que falle el sonido: no se alarma, pero
    // queda en el registro.
    console.error("[salidaAudio] no se pudo comprobar si llega el sonido", err);
  } finally {
    comprobando = false;
  }
}

/** Avisos de arreglo recientes y cuando salieron: ninguno se repite enseguida. */
const avisosRecientes = new Map<string, number>();

/**
 * Cuenta en pantalla lo que hubo que corregir para que se oiga.
 *
 * Sin repetir: al cambiar de salida se aplica varias veces seguidas (al
 * elegirla, al rehacer la conexion, al volver a dar play) y los mismos avisos
 * salian tres y cuatro veces en fila, a veces alternados entre si. Se recuerda
 * CADA aviso con su hora, no solo el ultimo, para que alternar dos tampoco
 * los cuele. Repetido deja de leerse.
 */
function avisarDeArreglos(arreglos: string[]): void {
  if (arreglos.length === 0) return;
  const { showToast } = useStore.getState();
  const ahora = Date.now();
  arreglos.forEach((a) => {
    console.info("[salidaAudio] arreglado:", a);
    const antes = avisosRecientes.get(a);
    if (antes !== undefined && ahora - antes < 8000) return;
    avisosRecientes.set(a, ahora);
    showToast(a);
  });
  // Que el mapa no crezca sin limite en una sesion larga.
  avisosRecientes.forEach((cuando, texto) => {
    if (ahora - cuando > 60000) avisosRecientes.delete(texto);
  });
}

/**
 * Para el motor, al dar play: si la salida elegida es una cabina Bluetooth,
 * comprobar (con la medida fiable) que le llega el sonido y, si no, rehacer la
 * conexion. Va con un pequeño retraso para no medir el arranque.
 *
 * POR QUE AQUI Y NO SOLO AL ELEGIR LA SALIDA (0.4.52): al elegirla, lo normal
 * es que todavia no haya musica, o que haya una cancion cargando; el unico
 * momento seguro para medir y recuperar es cuando ya esta sonando.
 */
export function vigilarLlegada(): void {
  const { audioSink } = useStore.getState();
  if (!audioSink || !esBluetooth(audioSink)) return;
  window.setTimeout(() => void comprobarQueLlega(audioSink), 2000);
}

/**
 * Es un parlante o amplificador Bluetooth. Misma regla que `kind_of()` en
 * `src-tauri/src/salida_audio.rs`.
 */
export function esBluetooth(sink: string): boolean {
  const n = sink.toLowerCase();
  return n.startsWith("bluez") || n.includes("bluetooth");
}

/**
 * Como rehacer la conexion de sonido. Lo registra el motor de audio al
 * arrancar; se guarda aqui para no tener que importar el motor (que a su vez
 * importa este archivo, y seria una pescadilla que se muerde la cola).
 */
let rehacerConexion: (() => Promise<void>) | null = null;

export function registrarRehacerConexion(fn: () => Promise<void>): void {
  rehacerConexion = fn;
}

/**
 * Se esta rehaciendo la conexion ahora mismo. Rehacerla crea un motor nuevo,
 * que vuelve a pedir la salida guardada; sin esta marca se llamaria a si misma
 * sin parar.
 */
let rehaciendo = false;

/**
 * Rehace la conexion de sonido del motor (ver la cabecera). Pasar SIEMPRE por
 * aqui y no por el motor directamente: esta es la puerta que evita que se
 * llame a si misma sin parar.
 */
export async function rehacerConexionDeSonido(): Promise<void> {
  if (rehaciendo || !rehacerConexion) return;
  rehaciendo = true;
  try {
    await rehacerConexion();
  } finally {
    rehaciendo = false;
  }
}

/**
 * El motor rehizo su conexion: el flujo de sonido es OTRO y hay que volver a
 * mandarlo a la salida elegida.
 */
export function olvidarSalidaAplicada(): void {
  aplicada = false;
}

/**
 * Manda el sonido a `sink`. Devuelve cuantos flujos se movieron:
 * 0 = la app todavia no estaba sonando (no habia nada que mover).
 *
 * Si la salida es Bluetooth, ademas rehace la conexion de sonido (ver la
 * cabecera): mover el flujo solo sirve para que el sistema RECUERDE la salida,
 * y asi la conexion nueva nace ya en el parlante.
 *
 * Lanza error si al terminar el sonido no quedo donde se pidio. Antes esto se
 * daba por bueno con que `pactl` no se quejara, y por eso la app decia "sonido
 * enviado" mientras por la cabina no se oia nada.
 */
export async function aplicarSalida(sink: string): Promise<number> {
  const r = await audioSetOutput(sink);
  const movidos = r.movidos;
  aplicada = movidos > 0;
  // Lo que el sistema tuvo que corregir para que se oiga (cabina en modo manos
  // libres, salida muda...) se DICE. Si la app lo arregla a espaldas del
  // usuario y se lo calla, la proxima vez nadie sabra por que a veces suena.
  avisarDeArreglos(r.arreglos);

  // La app no esta sonando: no hay flujo que mover ni nada que comprobar. El
  // sistema ya quedo avisado y al dar play saldra por ahi.
  if (movidos === 0) return 0;

  if (esBluetooth(sink) && !rehaciendo) {
    try {
      await rehacerConexionDeSonido();
      // La conexion nueva deberia nacer ya en el parlante (el sistema recuerda
      // la salida por programa), pero no se da por supuesto: se manda igual.
      const r2 = await audioSetOutput(sink);
      avisarDeArreglos(r2.arreglos);
      aplicada = r2.movidos > 0;
    } catch (err) {
      // NO ABORTAR (0.4.52). Rehacer la conexion esta prohibido mientras una
      // cancion carga o hay una transicion, y la salida se aplica JUSTO al
      // cargar (el motor arranca ahi). Antes ese fallo abortaba todo lo de
      // abajo —incluida la comprobacion que recupera el sonido— y la salida
      // quedaba marcada como aplicada, asi que al dar play no se reintentaba.
      // Paso en la prueba de la 0.4.51: la recuperacion nunca llego a correr.
      // El flujo ya esta en la cabina; la comprobacion de `vigilarLlegada`
      // (al dar play) se encarga de rehacer la conexion cuando se pueda.
      console.warn("[salidaAudio] no se pudo rehacer la conexión ahora; se reintenta al sonar", err);
    }
  }

  // Comprobar donde quedo de verdad.
  //
  // Se espera a que el flujo aparezca donde debe en vez de mirar una sola vez:
  // al rehacer la conexion, el navegador interno tarda un instante en abrirla
  // otra vez, y comprobarlo al primer intento daria una falsa alarma.
  //
  // OJO: aqui NO se exige que la salida este ya "RUNNING". Recien cambiada
  // tarda un par de segundos en arrancar (medido con el sonido real del
  // equipo), asi que eso seria otra falsa alarma. De que suene de verdad se
  // encarga `comprobarSalida()`, que corre mientras hay musica puesta.
  let est = await audioOutputStatus(sink);
  for (let i = 0; i < 10; i++) {
    if (est.hay_flujo && (!est.salida || est.salida === sink)) break;
    await new Promise((listo) => window.setTimeout(listo, 200));
    est = await audioOutputStatus(sink);
  }
  if (!est.hay_flujo) {
    throw new Error(
      "La app se quedó sin conexión de sonido al cambiar de salida. Dale play otra vez."
    );
  }
  if (est.salida && est.salida !== sink) {
    throw new Error(
      `El sistema devolvió el sonido a «${est.salida}» en vez de dejarlo en la salida elegida.`
    );
  }
  if (est.pausado) {
    throw new Error(
      "El sistema dejó el sonido de la app en pausa. Revisa el volumen del equipo y vuelve a intentarlo."
    );
  }
  aplicada = true;
  // Con la cabina puesta, comprobar por detras que de verdad le llega.
  if (esBluetooth(sink)) void comprobarQueLlega(sink);
  return movidos;
}

/**
 * ¿Esta saliendo sonido de verdad por `sink`? Devuelve null si todo bien, o
 * una explicacion del problema para mostrarsela al usuario.
 *
 * Se usa mientras hay musica puesta: es la unica forma de enterarse de que el
 * sonido se corto por abajo (el aparato se durmio, el parlante Bluetooth se
 * desconecto, el sistema movio el flujo por su cuenta). Solo INFORMA: no toca
 * nada, porque una falsa alarma en mitad de un evento no puede provocar un
 * corte que no existia.
 */
export async function comprobarSalida(sink: string): Promise<string | null> {
  const est = await audioOutputStatus(sink);
  if (!est.hay_flujo) return "la app se quedó sin conexión con el sonido del equipo";
  if (est.pausado) return "el sistema tiene el sonido de la app en pausa";
  if (est.salida && est.salida !== sink) {
    return `el sonido se fue a «${est.salida}» en vez de la salida elegida`;
  }
  if (est.estado && est.estado !== "RUNNING") {
    return `la salida elegida no está reproduciendo (está «${est.estado}»)`;
  }
  return null;
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
