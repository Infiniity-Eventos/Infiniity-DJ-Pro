# Entorno de compilacion para Linux Mint / Ubuntu.
#
# POR QUE ESTO EXISTE: este equipo es Fedora 44 (glibc 2.43). Un binario
# compilado aqui exige GLIBC_2.39 y NO ARRANCA en Linux Mint 21 (glibc 2.35).
# Compilando dentro de Ubuntu 22.04 el piso baja a glibc 2.35, y el mismo
# AppImage sirve para Mint 21, Mint 22, Ubuntu 22.04 y mas nuevos.
#
# Regla: si algun dia hay que subir esta imagen base, subirla lo MENOS posible.
# Mientras mas vieja la base, en mas equipos corre el programa.
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Dependencias de Tauri v2 en Linux + herramientas para armar el AppImage.
#
# OJO CON LOS PAQUETES gstreamer1.0-*: NO son opcionales.
# WebKit decodifica el audio con GStreamer. El empaquetador solo mete dentro del
# AppImage los complementos que encuentre instalados AQUI; si faltan, el paquete
# sale con el nucleo de GStreamer pero sin un solo decodificador. El sintoma es
# enganoso: la cancion carga y dice "listo", pero queda con duracion 0:00 y al
# darle play no pasa nada, sin ningun error. Y no se puede arreglar quitando el
# GStreamer empaquetado, porque el del sistema exige una GLib mas nueva que la
# que viaja dentro.
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      curl \
      wget \
      file \
      git \
      ca-certificates \
      pkg-config \
      libssl-dev \
      libgtk-3-dev \
      libwebkit2gtk-4.1-dev \
      libayatana-appindicator3-dev \
      librsvg2-dev \
      libxdo-dev \
      libasound2-dev \
      patchelf \
      gstreamer1.0-plugins-base \
      gstreamer1.0-plugins-good \
      gstreamer1.0-libav \
      gstreamer1.0-pulseaudio \
      gstreamer1.0-alsa \
      fuse \
      desktop-file-utils \
      python3 \
    && rm -rf /var/lib/apt/lists/*

# Node 20 (el que usa el proyecto).
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Rust estable.
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --no-modify-path --default-toolchain stable

# appimagetool: hace falta para volver a empaquetar el AppImage despues de
# quitarle las librerias graficas (ver arreglar-appimage.sh).
RUN curl -fsSL -o /usr/local/bin/appimagetool \
      https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage \
    && chmod +x /usr/local/bin/appimagetool

WORKDIR /app
