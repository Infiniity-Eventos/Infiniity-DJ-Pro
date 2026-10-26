#!/usr/bin/env python3
"""BPM REAL de una cancion, por analisis del audio (numpy + ffmpeg).

Uso:
  bpm_real.py <archivo.mp3> [--genero Merengue]     -> imprime JSON
  bpm_real.py --auditar <biblioteca> [--corregir]    -> revisa todas las carpetas

Por que existe: el detector rapido de la app (--bpm-cli) y Deezer se
equivocan de OCTAVA. En merengue la tambora repite su patron cada DOS
tiempos y el detector cuenta ese patron: "Abusadora" (Oro Solido) salia a
85 cuando el pulso real es 170. En reggaeton pasa al reves: 190 en vez de 95.

Como mide:
  1. Decodifica a mono 22 kHz y calcula la "fuerza de golpe" (flujo espectral:
     cuanto sube la energia de un instante al siguiente).
  2. Autocorrelacion: el retardo al que la cancion mas se parece a si misma es
     el periodo del ritmo. Se afina con interpolacion parabolica (decimas).
  3. Toma el pico mas fuerte entre 60 y 200 y lo lleva (x2 o /2) al rango
     normal del GENERO (RANGOS). Sin genero, se queda con el pico mas fuerte.
  4. Comprueba con tramos de 30 s: si los tramos no estan de acuerdo, lo dice
     ("estable": false) para que se revise a mano.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from comun import SIN_CLASIFICAR  # noqa: E402

SR = 22050
HOP = 64

# Rango del pulso "como se baila" en cada carpeta del catalogo. Lo que caiga
# fuera se dobla o se parte a la mitad hasta entrar. Rangos anchos = generos
# mezclados (ahi manda el pico mas fuerte si ya cae dentro).
RANGOS = {
    "Merengue": (115, 185),
    "Salsa": (150, 230),
    "Salsa Choque": (150, 230),
    "Bachata": (105, 150),
    "Reggaeton": (78, 135),  # Limbo / Si Antes Te Hubiera Conocido van a ~125-128 de verdad
    "Trap": (65, 150),
    "Champeta": (95, 140),
    "Cumbia": (78, 130),
    "Carranga": (95, 160),
    "Vallenato": (90, 185),
    "Viejoteca": (80, 170),
    "Electronica": (110, 150),
    "Boleros": (60, 130),
    "Popular": (70, 150),
    "Infantil": (90, 180),
    "Cristiana": (60, 150),
    "Mexicana": (70, 180),
}
RANGO_POR_DEFECTO = (70, 180)


# Solo se analizan los primeros 6 min (sobra para el tempo) y POR BLOQUES.
# OJO: la primera version hacia la STFT de la cancion entera de una vez
# (cientos de MB por cancion, GB con un mix de una hora) y al auditar la
# biblioteca se comio la RAM: el sistema mato programas (2026-10-19).
# Asi, la memoria queda en unas decenas de MB pase lo que pase.
MAX_SEG = 360
NFFT = 1024
BLOQUE = 1 << 16  # muestras por bloque (~3 s)


def flujo(ruta: Path) -> tuple[np.ndarray, float]:
    """Fuerza de golpe (flujo espectral) por cuadro, leyendo el audio por bloques."""
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-t", str(MAX_SEG), "-i", str(ruta), "-ac", "1", "-ar", str(SR),
                          "-f", "f32le", "-"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    ventana = np.hanning(NFFT).astype(np.float32)
    resto = np.zeros(0, dtype=np.float32)
    previo = None
    o = []
    while True:
        datos = p.stdout.read(BLOQUE * 4)
        if not datos:
            break
        x = np.concatenate([resto, np.frombuffer(datos, dtype=np.float32)])
        n = (len(x) - NFFT) // HOP + 1
        if n <= 0:
            resto = x
            continue
        cuadros = np.lib.stride_tricks.sliding_window_view(x, NFFT)[::HOP][:n] * ventana
        mag = np.log1p(100 * np.abs(np.fft.rfft(cuadros, axis=1))).astype(np.float32)
        if previo is not None:
            mag_ant = np.vstack([previo[None, :], mag[:-1]])
        else:
            mag_ant = np.vstack([mag[:1], mag[:-1]])
        d = mag - mag_ant
        d[d < 0] = 0
        o.append(d.sum(1))
        previo = mag[-1]
        resto = x[n * HOP:]
    err = p.stderr.read().decode(errors="replace")
    p.wait()
    if p.returncode != 0 or not o:
        raise RuntimeError(f"ffmpeg no pudo leer {ruta.name}: {err[:200]}")
    o = np.concatenate(o)
    o = o - np.convolve(o, np.ones(128) / 128, "same")
    o[o < 0] = 0
    return o - o.mean(), SR / HOP


def autocorr(o: np.ndarray) -> np.ndarray:
    n = 1 << (2 * len(o) - 1).bit_length()
    f = np.fft.rfft(o, n)
    ac = np.fft.irfft(f * np.conj(f), n)[: len(o)]
    return ac / ac[0] if ac[0] else ac


def pico_mas_fuerte(ac: np.ndarray, fps: float, lo=60.0, hi=200.0) -> tuple[float, float]:
    a, b = int(fps * 60 / hi), int(fps * 60 / lo) + 1
    i = a + int(np.argmax(ac[a:b]))
    if 0 < i < len(ac) - 1:
        y0, y1, y2 = ac[i - 1], ac[i], ac[i + 1]
        den = y0 - 2 * y1 + y2
        p = 0.5 * (y0 - y2) / den if den else 0.0
    else:
        p = 0.0
    return 60 * fps / (i + p), float(ac[i])


def a_rango(bpm: float, genero: str | None) -> float:
    lo, hi = RANGOS.get(genero or "", RANGO_POR_DEFECTO)
    for _ in range(4):
        if bpm < lo:
            bpm *= 2
        elif bpm > hi:
            bpm /= 2
    return bpm


def analizar(ruta: Path, genero: str | None = None) -> dict:
    o, fps = flujo(ruta)
    base, fuerza = pico_mas_fuerte(autocorr(o), fps)
    bpm = a_rango(base, genero)
    # Tramos de 30 s: cada uno, llevado al mismo rango, debe dar lo mismo.
    seg = int(30 * fps)
    tramos = []
    for k in range(0, len(o) - seg, seg):
        t, _ = pico_mas_fuerte(autocorr(o[k:k + seg] - o[k:k + seg].mean()), fps)
        tramos.append(round(a_rango(t, genero), 1))
    de_acuerdo = sum(1 for t in tramos if abs(t - bpm) / bpm < 0.03)
    estable = not tramos or de_acuerdo >= 0.6 * len(tramos)
    return {
        "bpm": redondear(bpm),
        "pico": round(base, 2),
        "fuerza": round(fuerza, 3),
        "tramos": tramos,
        "estable": estable,
    }


def redondear(bpm: float) -> float:
    """Entero si esta a menos de 0.15 (casi toda la musica grabada con
    metronomo), si no, una decimal."""
    r = round(bpm)
    return float(r) if abs(bpm - r) < 0.15 else round(bpm, 1)


def texto_bpm(bpm: float) -> str:
    return str(int(bpm)) if bpm == int(bpm) else f"{bpm:.1f}"


def tipo_diferencia(actual: float | None, nuevo: float) -> str:
    """"igual", "octava" (el doble o la mitad: error tipico del detector, se
    corrige solo) u "otro" (3/2, 4/3...: el analisis pudo agarrar otro patron;
    NO se toca, se revisa a mano)."""
    if not actual:
        return "octava"  # no habia BPM: se pone el analizado
    r = nuevo / actual
    if abs(r - 1) < 0.03:
        return "igual"
    if abs(r - 2) < 0.06 or abs(r - 0.5) < 0.015 or abs(r - 4) < 0.12 or abs(r - 0.25) < 0.008:
        return "octava"
    return "otro"


def auditar(bib: Path, corregir: bool) -> None:
    from mutagen.id3 import ID3, TBPM
    cambios = []
    # "Sin clasificar" no se audita: esas canciones aun no tienen etiquetas ni
    # genero, asi que no hay BPM que comparar ni rango con el que ajustarlo.
    for carpeta in sorted(p for p in bib.iterdir()
                          if p.is_dir() and not p.name.startswith(".") and p.name != SIN_CLASIFICAR):
        for f in sorted(carpeta.glob("*.mp3")):
            if f.name.lower().startswith("mix infiniity"):
                continue  # un mix no tiene UN tempo
            try:
                t = ID3(f)
                actual = float(str(t.get("TBPM"))) if t.get("TBPM") else None
            except Exception as ex:  # noqa: BLE001
                print(f"  AVISO: no se pudieron leer las etiquetas de {f.name}: {ex}", file=sys.stderr)
                actual = None
            try:
                r = analizar(f, carpeta.name)
            except Exception as ex:  # noqa: BLE001
                print(f"  ERROR analizando {f.name}: {ex}", file=sys.stderr)
                continue
            nuevo = r["bpm"]
            tipo = tipo_diferencia(actual, nuevo)
            if tipo == "igual":
                continue
            seguro = tipo == "octava" and r["estable"]
            marca = "" if seguro else ("  (INESTABLE: revisar a mano)" if not r["estable"] else "  (otro tempo, no es doble/mitad: revisar a mano)")
            print(f"{carpeta.name:14} {str(actual):>6} -> {texto_bpm(nuevo):>6}  {f.name}{marca}")
            cambios.append((f, nuevo, seguro))
            if corregir and seguro:
                t.setall("TBPM", [TBPM(encoding=3, text=[texto_bpm(nuevo)])])
                t.save()
    seguros = sum(1 for c in cambios if c[2])
    print(f"\nDistintas: {len(cambios)} · doble/mitad {'corregidas' if corregir else 'a corregir'}: {seguros} · para revisar a mano: {len(cambios) - seguros}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("archivo", nargs="?")
    ap.add_argument("--genero")
    ap.add_argument("--auditar", metavar="BIBLIOTECA")
    ap.add_argument("--corregir", action="store_true", help="con --auditar: escribe el BPM nuevo (solo los estables)")
    a = ap.parse_args()
    if a.auditar:
        auditar(Path(a.auditar), a.corregir)
    elif a.archivo:
        print(json.dumps(analizar(Path(a.archivo), a.genero), ensure_ascii=False))
    else:
        ap.error("falta el archivo o --auditar")


if __name__ == "__main__":
    main()
