# DDJ-200 virtual (para probar sin la controladora)

Crea un puerto MIDI llamado "DDJ-200" y manda por el lo que se escriba en la
terminal, en hex. Sirve para comprobar toda la cadena de la app (busqueda del
puerto por nombre, conexion, evento a React, accion en el deck) sin hardware.

    cd herramientas/ddj-virtual && cargo run --release

Con la app abierta: pulsar el boton "DDJ-200", cargar una cancion, y escribir:

    90 0B 7F      <- play del Deck A presionado (0x91 para el Deck B)
    80 0B 40      <- soltado
    B0 13 40      <- fader de volumen del canal A a la mitad
    B6 1F 00      <- crossfader todo a la izquierda

Comprobado 2026-10-17 en la 0.3.7: play/pausa por MIDI mueve el deck.
Los numeros de nota/CC son los del mapeo en src-tauri/src/ddj200.rs; lo que
NO esta comprobado es que la DDJ-200 fisica mande exactamente esos numeros.
