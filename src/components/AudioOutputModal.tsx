import { useCallback, useEffect, useState } from "react";
import { useStore } from "../state/store";
import {
  audioOutputs,
  btBuscar,
  btConectar,
  btDesconectar,
  btDispositivos,
  btEncender,
  btEstado,
  guardarInforme,
  audioOutputStatus,
  type AudioOutput,
  type DispositivoBt,
  type EstadoBt,
} from "../lib/tauri";
import { aplicarSalida } from "../lib/salidaAudio";
import { engine } from "../audio/AudioEngine";

/** Cuanto busca cabinas. Menos no da tiempo a que una cabina conteste. */
const SEGUNDOS_BUSQUEDA = 12;

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
 * La salida de sonido de una cabina Bluetooth lleva su direccion en el nombre
 * tecnico, con guiones bajos: 41:42:AE:0F:D5:CD -> bluez_output.41_42_AE_0F_D5_CD.1
 * Asi se sabe CUAL de las salidas es la cabina que se acaba de conectar, sin
 * adivinar por el nombre que le haya puesto el fabricante.
 */
function salidaDeCabina(salidas: AudioOutput[], mac: string): AudioOutput | undefined {
  const marca = mac.toUpperCase().replace(/:/g, "_");
  return salidas.find((s) => s.name.toUpperCase().includes(marca));
}

/**
 * Espera a que el sistema de de alta la salida de sonido de la cabina.
 *
 * POR QUE HAY QUE ESPERAR: el Bluetooth contesta "conectada" antes de que el
 * servidor de sonido haya creado su salida. Si se mirara en ese momento, no
 * estaria y pareceria que fallo.
 */
async function esperarSalidaDeCabina(mac: string): Promise<AudioOutput | undefined> {
  for (let i = 0; i < 12; i++) {
    try {
      const encontrada = salidaDeCabina(await audioOutputs(), mac);
      if (encontrada) return encontrada;
    } catch (err) {
      console.error("[AudioOutputModal] no se pudo listar las salidas", err);
    }
    await new Promise((listo) => window.setTimeout(listo, 700));
  }
  return undefined;
}

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
  const musicRoot = useStore((s) => s.musicRoot);
  const historialAvisos = useStore((s) => s.historialAvisos);
  const setAudioSink = useStore((s) => s.setAudioSink);
  const showToast = useStore((s) => s.showToast);

  const [salidas, setSalidas] = useState<AudioOutput[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // Bluetooth: estado del aparato del equipo y cabinas que conoce.
  const [bt, setBt] = useState<EstadoBt | null>(null);
  const [cabinas, setCabinas] = useState<DispositivoBt[]>([]);
  const [buscando, setBuscando] = useState(false);
  /** Direccion de la cabina que se esta conectando ahora (null si ninguna). */
  const [conectando, setConectando] = useState<string | null>(null);
  /** Segundos que le quedan a la busqueda (la cuenta atras se ve en pantalla). */
  const [restan, setRestan] = useState(0);
  /** Como fue la ultima busqueda. Sin esto, "no encontre nada" era silencio. */
  const [avisoBusqueda, setAvisoBusqueda] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setSalidas(await audioOutputs());
      setError(null);
    } catch (e) {
      setSalidas([]);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const cargarBt = useCallback(async () => {
    try {
      const estado = await btEstado();
      setBt(estado);
      if (!estado.hay || !estado.encendido) {
        setCabinas([]);
        return;
      }
      // Solo lo que sirve para sacar sonido: el teclado y el celular del
      // usuario no pintan nada en una lista de cabinas.
      setCabinas((await btDispositivos()).filter((d) => d.altavoz));
    } catch (err) {
      // Nunca en silencio: si el Bluetooth no se puede consultar hay que
      // decirlo, no dejar la lista vacia como si no hubiera cabinas.
      console.error("[AudioOutputModal] no se pudo consultar el Bluetooth", err);
      setBt({
        hay: false,
        encendido: false,
        motivo: `No se pudo consultar el Bluetooth: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
  }, []);

  useEffect(() => {
    void cargar();
    void cargarBt();
  }, [cargar, cargarBt]);

  /**
   * Cuenta atras mientras busca.
   *
   * No es un adorno: buscar cabinas tarda doce segundos, y sin NADA moviendose
   * en pantalla la app parece colgada. Que el numero baje cada segundo es la
   * prueba a la vista de que sigue viva y de cuanto falta.
   */
  useEffect(() => {
    if (!buscando) return;
    setRestan(SEGUNDOS_BUSQUEDA);
    const t = window.setInterval(
      () => setRestan((v) => (v > 0 ? v - 1 : 0)),
      1000
    );
    return () => window.clearInterval(t);
  }, [buscando]);

  const elegir = async (salida: AudioOutput) => {
    setOcupado(true);
    try {
      // La eleccion se guarda ANTES de aplicarla, y el orden importa: al
      // cambiar a Bluetooth se rehace la conexion de sonido, y todo lo que
      // vuelve a mandar el sonido a su sitio lee la salida guardada. Si se
      // guardara despues, leeria la salida VIEJA y el sonido se volveria a la
      // anterior en mitad del cambio.
      setAudioSink(salida.name);
      const movidos = await aplicarSalida(salida.name);
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
      // Este primer pitido NO es la prueba: esta para forzar que exista la
      // conexion de sonido, porque el navegador interno no la abre hasta que
      // algo suena, y sin ella no hay nada que mandar a ninguna parte.
      await engine.probarSalida();
      if (audioSink) await aplicarSalida(audioSink);
      // Y este si es la prueba. Va aparte porque con Bluetooth se rehace la
      // conexion de sonido, y eso corta en seco el pitido de arriba: si no se
      // repitiera, el usuario oiria un pitido a medias y creeria que falla.
      await engine.probarSalida();
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

  /**
   * Deja por escrito que esta pasando en ESTA PC y lo guarda en la carpeta de
   * musica, que viaja sola por Sync hasta el PC original.
   *
   * POR QUE: las PC del equipo estan en otras casas y en otros eventos. Cuando
   * algo no suena, lo unico que llega es "no suena" por WhatsApp, con la
   * persona en mitad de un evento. Con esto llega el detalle completo sin que
   * nadie tenga que mirar nada raro ni mandar nada.
   */
  const guardarInformeDeFallo = async () => {
    setOcupado(true);
    setError(null);
    try {
      let estadoSalida = "(no se pudo consultar)";
      try {
        const e = await audioOutputStatus();
        estadoSalida =
          `hay flujo de sonido: ${e.hay_flujo} | va por: ${e.salida ?? "?"}` +
          ` | en pausa: ${e.pausado} | estado de la salida: ${e.estado || "?"}`;
      } catch (err) {
        estadoSalida = `(fallo al consultar: ${err instanceof Error ? err.message : String(err)})`;
      }
      const estadoApp = [
        `version: ${__APP_VERSION__}`,
        `salida elegida: ${audioSink ?? "(ninguna)"}`,
        `salida de verdad: ${estadoSalida}`,
        "",
        engine.resumen(),
        "",
        "ultimos avisos que salieron en pantalla:",
        historialAvisos.length > 0 ? historialAvisos.join("\n") : "(ninguno)",
      ].join("\n");

      const ruta = await guardarInforme(musicRoot ?? "", estadoApp);
      showToast("Informe guardado. Llega solo al PC original por Sync.");
      setError(null);
      console.info("[informe] guardado en", ruta);
    } catch (e) {
      setError(
        `No se pudo guardar el informe: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      setOcupado(false);
    }
  };

  const encenderBt = async () => {
    setOcupado(true);
    setError(null);
    try {
      await btEncender();
      await cargarBt();
    } catch (e) {
      setError(
        `No se pudo encender el Bluetooth: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      setOcupado(false);
    }
  };

  const buscarCabinas = async () => {
    setBuscando(true);
    setError(null);
    setAvisoBusqueda(null);
    const conocidas = new Set(cabinas.map((c) => c.mac));
    try {
      const encontradas = (await btBuscar(SEGUNDOS_BUSQUEDA)).filter(
        (d) => d.altavoz
      );
      setCabinas(encontradas);
      // Decir SIEMPRE como fue. Que la busqueda termine sin novedades y la
      // pantalla se quede igual que antes no se distingue de que haya fallado.
      const nuevas = encontradas.filter((d) => !conocidas.has(d.mac)).length;
      if (encontradas.length === 0) {
        setAvisoBusqueda(
          "No apareció ninguna cabina. Comprueba que esté encendida, cerca, y en modo emparejar (normalmente dejando pulsado su botón de Bluetooth)."
        );
      } else if (nuevas === 0) {
        setAvisoBusqueda(
          `No apareció ninguna cabina nueva. Siguen las de siempre (${encontradas.length}).`
        );
      } else {
        setAvisoBusqueda(
          nuevas === 1
            ? "Apareció 1 cabina nueva."
            : `Aparecieron ${nuevas} cabinas nuevas.`
        );
      }
    } catch (e) {
      setError(
        `No se pudo buscar cabinas: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      setBuscando(false);
    }
  };

  /**
   * Conecta la cabina y, en cuanto el equipo la da de alta como salida, deja
   * el sonido saliendo por ella.
   *
   * Que lo haga TODO de un toque es el objetivo: antes habia que salir a la
   * configuracion de Bluetooth del sistema, emparejar ahi, volver a la app y
   * elegir la salida a mano. Tres sitios distintos para una sola cosa.
   */
  const conectarCabina = async (d: DispositivoBt) => {
    setConectando(d.mac);
    setError(null);
    try {
      await btConectar(d.mac);
      showToast(`Cabina conectada: ${d.nombre}`);
      const salida = await esperarSalidaDeCabina(d.mac);
      if (!salida) {
        // Conectada pero el sonido todavia no la ofrece: se dice tal cual, que
        // es distinto de "fallo" y el usuario solo tiene que esperar.
        setError(
          `«${d.nombre}» quedó conectada, pero el equipo todavía no la ofrece como salida de sonido. Dale a «Actualizar lista» en unos segundos.`
        );
      } else {
        // Mismo orden que al elegir a mano: guardar la eleccion y luego
        // aplicarla (ver el comentario de `elegir`).
        setAudioSink(salida.name);
        await aplicarSalida(salida.name);
        showToast(`Sonando por: ${salida.description}`);
      }
      await cargarBt();
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConectando(null);
    }
  };

  const desconectarCabina = async (d: DispositivoBt) => {
    setConectando(d.mac);
    setError(null);
    try {
      await btDesconectar(d.mac);
      showToast(`Cabina desconectada: ${d.nombre}`);
      await cargarBt();
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConectando(null);
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
          Elige por dónde suena la música. Las cabinas Bluetooth se conectan aquí
          mismo: enciende la cabina, dale a «Buscar cabinas» y conéctala — queda
          sonando por ella sola. Al pasar a Bluetooth el sonido se corta un
          instante: hay que rehacer la conexión para que la cabina suene de verdad.
        </p>

        <div className="out-bt">
          <div className="out-bt-head">
            <span className="out-bt-title">Cabinas Bluetooth</span>
            <button
              className="btn"
              disabled={ocupado || buscando || !bt?.encendido}
              onClick={() => void buscarCabinas()}
            >
              {buscando ? "Buscando..." : "Buscar cabinas"}
            </button>
          </div>

          {bt && !bt.hay && <div className="out-bt-nota">{bt.motivo}</div>}

          {bt?.hay && !bt.encendido && (
            <div className="out-bt-nota out-bt-fila">
              <span>{bt.motivo}</span>
              <button className="btn" disabled={ocupado} onClick={() => void encenderBt()}>
                Encender
              </button>
            </div>
          )}

          {buscando && (
            <div className="out-bt-nota out-bt-buscando">
              <span className="out-bt-girando" aria-hidden="true" />
              <span>
                Buscando cabinas encendidas cerca...{" "}
                {restan > 0 ? `faltan ${restan} s` : "terminando"}
              </span>
            </div>
          )}

          {!buscando && avisoBusqueda && (
            <div className="out-bt-nota">{avisoBusqueda}</div>
          )}

          {/* Solo si no hay ya un aviso de la ultima busqueda: dos mensajes
              diciendo casi lo mismo, uno debajo del otro, es ruido. */}
          {bt?.encendido && !buscando && cabinas.length === 0 && !avisoBusqueda && (
            <div className="out-bt-nota">
              Ninguna cabina conocida todavía. Enciende la cabina, ponla en modo
              emparejar (normalmente dejando pulsado su botón de Bluetooth) y dale
              a «Buscar cabinas».
            </div>
          )}

          {cabinas.map((d) => (
            <div key={d.mac} className={`out-row out-row-fija ${d.conectado ? "active" : ""}`}>
              <span className="out-name">{d.nombre}</span>
              {d.conectado ? (
                <>
                  <span className="out-flag">conectada</span>
                  <button
                    className="btn"
                    disabled={ocupado || conectando !== null}
                    onClick={() => void desconectarCabina(d)}
                  >
                    {conectando === d.mac ? "..." : "Desconectar"}
                  </button>
                </>
              ) : (
                <>
                  <span className="out-kind">
                    {d.emparejado ? "ya emparejada" : "nueva"}
                  </span>
                  <button
                    className="btn"
                    disabled={ocupado || conectando !== null}
                    onClick={() => void conectarCabina(d)}
                  >
                    {conectando === d.mac ? "Conectando..." : "Conectar"}
                  </button>
                </>
              )}
            </div>
          ))}
        </div>

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

        <div className="modal-actions out-actions">
          <button className="btn" disabled={ocupado} onClick={() => void cargar()}>
            Actualizar lista
          </button>
          <button
            className="btn"
            disabled={ocupado}
            title="Guarda lo que está pasando en esta PC y lo manda al PC original por Sync"
            onClick={() => void guardarInformeDeFallo()}
          >
            Guardar informe
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
