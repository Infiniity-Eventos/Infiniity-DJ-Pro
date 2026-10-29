import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import {
  audioOutputs,
  btBuscar,
  btConectar,
  btDesconectar,
  btDispositivos,
  btEncender,
  btEstado,
  btAsegurarPreparacion,
  btPreparacionEstado,
  btPrepararEquipo,
  btQuitarPreparacion,
  guardarInforme,
  audioOutputStatus,
  type AudioOutput,
  type DispositivoBt,
  type EstadoBt,
  type EstadoPreparacion,
} from "../lib/tauri";
import { aplicarSalida, esBluetooth, olvidarSalidaAplicada, rehacerConexionDeSonido } from "../lib/salidaAudio";
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
  const askConfirm = useStore((s) => s.askConfirm);

  const [salidas, setSalidas] = useState<AudioOutput[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // Bluetooth: estado del aparato del equipo y cabinas que conoce.
  const [bt, setBt] = useState<EstadoBt | null>(null);
  const [cabinas, setCabinas] = useState<DispositivoBt[]>([]);
  const [buscando, setBuscando] = useState(false);
  /** Direccion de la cabina que se esta conectando ahora (null si ninguna). */
  const [conectando, setConectando] = useState<string | null>(null);
  /** Si el equipo esta preparado para cabinas Bluetooth sencillas. */
  const [preparacion, setPreparacion] = useState<EstadoPreparacion | null>(null);
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
      setPreparacion(await btPreparacionEstado());
    } catch (err) {
      console.error("[AudioOutputModal] no se pudo leer la preparación", err);
    }
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
   * Al abrir, si el Bluetooth del equipo ya esta encendido, se buscan cabinas
   * solas: el DJ abre «Audio» y las ve, sin un boton mas. Si esta apagado no
   * se enciende por su cuenta (un equipo que va por cable no tiene por que
   * encenderlo); para eso esta «Buscar cabinas».
   */
  const buscadoAlAbrir = useRef(false);
  useEffect(() => {
    if (buscadoAlAbrir.current || !bt?.encendido) return;
    buscadoAlAbrir.current = true;
    void buscarCabinas(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bt?.encendido]);

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
      if (esBluetooth(salida.name)) await prepararSiHaceFalta();
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
    // Tarda unos segundos a proposito: mide el sonido que sale del motor y
    // GRABA la salida elegida para ver si le llega. Sin avisar, parece colgada.
    showToast("Midiendo el sonido... tarda unos segundos");
    try {
      let estadoSalida = "(no se pudo consultar)";
      try {
        const e = await audioOutputStatus(audioSink);
        estadoSalida =
          `hay flujo de sonido: ${e.hay_flujo} | va por: ${e.salida ?? "?"}` +
          ` | en pausa: ${e.pausado} | estado de la salida: ${e.estado || "?"}` +
          ` | volumen del equipo: ${e.volumen}% | silenciada por el equipo: ${e.silenciada}` +
          ` | propiedad bluez transport vacío (NO fiable: sale igual cuando suena): ${e.fantasma}`;
      } catch (err) {
        estadoSalida = `(fallo al consultar: ${err instanceof Error ? err.message : String(err)})`;
      }
      const estadoApp = [
        `version: ${__APP_VERSION__}`,
        `salida elegida: ${audioSink ?? "(ninguna)"}`,
        `equipo preparado para cabinas sencillas: ${preparacion?.preparado ? "sí" : "no"}`,
        `salida de verdad: ${estadoSalida}`,
        "",
        await engine.resumen(),
        "",
        "ultimos avisos que salieron en pantalla:",
        historialAvisos.length > 0 ? historialAvisos.join("\n") : "(ninguno)",
      ].join("\n");

      const ruta = await guardarInforme(musicRoot ?? "", estadoApp, audioSink ?? "");
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

  /**
   * Preparar (o des-preparar) el equipo para cabinas Bluetooth sencillas.
   *
   * POR QUE PIDE CONFIRMACION: reinicia el gestor de sesion de sonido UNA vez y
   * eso corta el sonido del equipo un par de segundos. En un evento, con
   * musica, no se hace; y nunca se hace solo (regla 8).
   */
  const alternarPreparacion = () => {
    const sonando = useStore.getState().decks.A.isPlaying || useStore.getState().decks.B.isPlaying;
    if (sonando) {
      setError("Para preparar el equipo, primero pausa la música: el sonido se corta unos segundos.");
      return;
    }
    const quitar = preparacion?.preparado === true;
    askConfirm(
      quitar
        ? "Quitar la preparación devuelve el sonido del equipo a su configuración normal: útil si este portátil ya solo va por cable (con cable responde un poco más rápido). Las cabinas Bluetooth volverían a cortarse hasta que se prepare otra vez, cosa que pasa sola al tocar una cabina. El sonido se corta unos segundos. ¿Seguir?"
        : "Preparar el equipo le da al sonido de Infiniity DJ más margen (200 ms en vez de 40), que es lo que necesita una cabina Bluetooth para no cortarse. Solo afecta a esta app; con cable, el play y el crossfader responden un poco más tarde. Reinicia el servicio de sonido UNA vez (el sonido se corta unos segundos) y después hay que cerrar y abrir la app. Se puede quitar. ¿Seguir?",
      () => {
        void (async () => {
          setOcupado(true);
          setError(null);
          try {
            const msg = quitar ? await btQuitarPreparacion() : await btPrepararEquipo();
            // Se reinicio el sonido del equipo: la conexion de la app murio.
            // Una nueva nace con la configuracion de ahora (sin cerrar la app).
            olvidarSalidaAplicada();
            await rehacerConexionDeSonido();
            showToast(msg);
            await cargarBt();
            await cargar();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setOcupado(false);
          }
        })();
      }
    );
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

  /**
   * Enciende el Bluetooth del portatil si esta apagado, antes de buscar o
   * conectar. Antes habia que darle a un boton aparte y nadie lo veia: en un
   * evento se perdio un buen rato porque "la app no conecta", cuando lo que
   * pasaba es que el Bluetooth del equipo estaba apagado. Si hay que hacerlo
   * siempre, que lo haga la app y lo diga.
   */
  /**
   * La primera vez que un portatil usa una cabina Bluetooth, se prepara SOLO:
   * pone la regla del margen y reinicia el sonido una vez. Despues nunca mas.
   *
   * POR QUE AUTOMATICO (0.4.56): con muchos DJ, portatiles y cabinas, un paso
   * a mano ("Preparar equipo", luego cerrar y abrir la app) es un paso que
   * alguien se salta en un evento. Comprobado que tras preparar, una conexion
   * de sonido NUEVA nace con el margen sin cerrar la app: por eso aqui se
   * rehace la de la app y listo.
   */
  const prepararSiHaceFalta = async (): Promise<void> => {
    if (preparacion?.preparado) return;
    showToast("Preparando el equipo para Bluetooth (solo la primera vez)…");
    const preparo = await btAsegurarPreparacion();
    if (preparo) {
      // El sonido del equipo se reinicio: la conexion de la app murio. Una
      // nueva nace con el margen (si aun no habia motor, nacera asi al sonar).
      olvidarSalidaAplicada();
      await rehacerConexionDeSonido();
    }
    setPreparacion(await btPreparacionEstado());
  };

  const asegurarBtEncendido = async (): Promise<boolean> => {
    if (bt?.encendido) return true;
    try {
      await btEncender();
      showToast("El Bluetooth del equipo estaba apagado: se encendió.");
      await cargarBt();
      return true;
    } catch (e) {
      setError(
        `El Bluetooth del equipo está apagado y no se pudo encender: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
      return false;
    }
  };

  const buscarCabinas = async (automatica = false) => {
    setBuscando(true);
    setError(null);
    setAvisoBusqueda(null);
    if (!(await asegurarBtEncendido())) {
      setBuscando(false);
      return;
    }
    const conocidas = new Set(cabinas.map((c) => c.mac));
    try {
      const encontradas = (await btBuscar(SEGUNDOS_BUSQUEDA)).filter(
        (d) => d.altavoz
      );
      setCabinas(encontradas);
      // Decir SIEMPRE como fue. Que la busqueda termine sin novedades y la
      // pantalla se quede igual que antes no se distingue de que haya fallado.
      const nuevas = encontradas.filter((d) => !conocidas.has(d.mac)).length;
      // En la busqueda que se hace sola al abrir, no se comenta "no hay nada
      // nuevo" si ya hay cabinas en la lista: el DJ no pidio buscar y es ruido.
      // Si no hay NINGUNA, si se dice, porque es lo que tiene que saber.
      if (automatica && encontradas.length > 0 && nuevas === 0) {
        setAvisoBusqueda(null);
      } else if (encontradas.length === 0) {
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
      if (!(await asegurarBtEncendido())) return;
      await prepararSiHaceFalta();
      const aviso = await btConectar(d.mac);
      showToast(`Cabina conectada: ${d.nombre}`);
      // Si hubo que reavivarla (conectada a medias, sin canal de sonido), que
      // se sepa: es justo el fallo que dejo un evento entero sin sonido.
      if (aviso) showToast(aviso);
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
          Toca una cabina y suena por ella. La primera vez en cada portátil
          tarda unos segundos más: el equipo se prepara solo.
        </p>

        <div className="out-bt">
          <div className="out-bt-head">
            <span className="out-bt-title">Cabinas Bluetooth</span>
            <button
              className="btn"
              disabled={ocupado || buscando || (bt !== null && !bt.hay)}
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

          {bt?.hay && preparacion?.preparado && (
            <div className="out-bt-nota out-bt-fila">
              <span>✅ Este portátil ya está listo para cabinas Bluetooth.</span>
              <button className="btn" disabled={ocupado || buscando} onClick={alternarPreparacion}>
                Quitar
              </button>
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
