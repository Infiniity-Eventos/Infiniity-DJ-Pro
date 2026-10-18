#!/usr/bin/env python3
"""Aplica un PLAN a las canciones: convierte a MP3, escribe etiquetas, firma,
calcula ReplayGain y BPM si faltan, borra caratula, renombra y mueve a la
carpeta del genero.

Uso:  aplicar.py <plan.json> --biblioteca <raiz> [--simular]

plan.json = lista de objetos:
  { "archivo": ".../Sin clasificar/x.mp3",
    "titulo": "Los Infieles", "artistas": ["Aventura"],
    "genero": "Bachata",            # carpeta del catalogo, o "Otros"
    "genero_sugerido": "Bachata",   # solo si genero == "Otros": lo que se cree que es
    "fecha": "2006-12-19", "isrc": "US...", "bpm": 132.9, "youtube_id": "abc",
    "mix": false }
Para un mix:  "mix": true, "genero": "Merengue"  -> se nombra "Mix Infiniity Merengue NN".

Idempotente: una cancion ya firmada (TXXX:INFINIITY_ORGANIZADA) se salta salvo --forzar.

DOS FASES (para que las PC del equipo no vuelvan a bajar todo): la cancion
organizada se COPIA a su carpeta y la original queda en "Sin clasificar"
hasta que `--limpiar` la borre (cuando las PC ya tienen la copia nueva).
Syncthing arma la copia nueva a partir de la vieja si esta sigue ahi.
"""
import argparse
import json
import re
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from comun import (CATALOGO, COMODIN, FIRMA, UMBRAL_CARPETA_NUEVA, artista_canonico,  # noqa: E402
                   guardar_estado, leer_estado, nombre_archivo, titulo_bonito)

APPIMAGE = Path.home() / "Applications" / "Infiniity-DJ.AppImage"


def a_mp3(origen: Path, simular: bool) -> Path:
    """Todo a MP3 (D7). 320 kbps. Devuelve la ruta del MP3 (la misma si ya lo era)."""
    if origen.suffix.lower() == ".mp3":
        return origen
    destino = origen.with_suffix(".mp3")
    print(f"  convirtiendo a MP3: {origen.name}")
    if simular:
        return destino
    tmp = origen.with_name(".convirtiendo-" + destino.name)
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(origen), "-vn", "-codec:a", "libmp3lame", "-b:a", "320k", str(tmp)],
                       capture_output=True, text=True)
    if r.returncode != 0 or not tmp.is_file():
        raise RuntimeError(f"ffmpeg no pudo convertir {origen.name}: {r.stderr.strip()[:300]}")
    tmp.rename(destino)
    origen.unlink()
    return destino


def replaygain_db(ruta: Path) -> float | None:
    """Ganancia ReplayGain 2 (referencia -18 LUFS) medida con ffmpeg ebur128."""
    r = subprocess.run(["ffmpeg", "-v", "info", "-nostats", "-i", str(ruta), "-filter_complex", "ebur128=framelog=quiet", "-f", "null", "-"],
                       capture_output=True, text=True)
    m = re.search(r"I:\s+(-?\d+(?:\.\d+)?)\s+LUFS", r.stderr)
    if not m:
        return None
    integrada = float(m.group(1))
    return round(-18.0 - integrada, 2)


def bpm_local(ruta: Path) -> float | None:
    if not APPIMAGE.is_file():
        return None
    r = subprocess.run([str(APPIMAGE), "--bpm-cli", str(ruta)], capture_output=True, text=True, timeout=180)
    try:
        return float(json.loads(r.stdout.strip())["bpm"])
    except Exception:
        print(f"  AVISO: no se pudo calcular el BPM de {ruta.name}: {r.stderr.strip()[:120]}", file=sys.stderr)
        return None


def escribir_etiquetas(ruta: Path, c: dict, gain: float | None, bpm: float | None, estado: dict, simular: bool) -> None:
    from mutagen.id3 import (APIC, COMM, ID3, ID3NoHeaderError, TALB, TBPM, TCOM, TCON, TCOP, TDRC, TENC, TIT2,
                             TLEN, TPE1, TPE2, TPUB, TSRC, TXXX)
    from mutagen.mp3 import MP3
    artistas = [artista_canonico(a, estado) for a in c["artistas"]]
    titulo = titulo_bonito(c["titulo"])
    if simular:
        print(f"  etiquetas: {titulo} | {' x '.join(artistas)} | {c['genero']} | bpm={bpm} gain={gain}")
        return
    try:
        t = ID3(ruta)
    except ID3NoHeaderError:
        t = ID3()
    t.delete(ruta)  # borron y cuenta nueva: todas las canciones con la misma informacion (D13/D15)
    t = ID3()
    t.add(TIT2(encoding=3, text=titulo))
    t.add(TPE1(encoding=3, text=" x ".join(artistas)))
    t.add(TCON(encoding=3, text=c["genero"]))
    if bpm:
        t.add(TBPM(encoding=3, text=str(int(round(bpm)))))
    if c.get("fecha"):
        t.add(TDRC(encoding=3, text=str(c["fecha"])[:10]))
    try:
        ms = int(MP3(ruta).info.length * 1000)
        t.add(TLEN(encoding=3, text=str(ms)))
    except Exception:
        pass
    if c.get("isrc"):
        t.add(TSRC(encoding=3, text=c["isrc"]))
    origen = f"YouTube: {c['youtube_id']}" if c.get("youtube_id") else "origen desconocido"
    t.add(COMM(encoding=3, lang="spa", desc="", text=f"Organizada por Infiniity · {origen} · {date.today().isoformat()}"))
    if gain is not None:
        t.add(TXXX(encoding=3, desc="REPLAYGAIN_TRACK_GAIN", text=f"{gain:+.2f} dB"))
    t.add(TXXX(encoding=3, desc="INFINIITY_ORGANIZADA", text=date.today().isoformat()))
    if c.get("genero_sugerido") and c["genero"] == COMODIN:
        t.add(TXXX(encoding=3, desc="INFINIITY_GENERO_SUGERIDO", text=c["genero_sugerido"]))
    # Firma en todo campo que no se usa (D15).
    for F in (TALB, TPE2, TCOM, TPUB, TCOP, TENC):
        t.add(F(encoding=3, text=FIRMA))
    t.delall("APIC")  # sin caratula (D13)
    t.save(ruta, v2_version=3)  # v2.3: lo leen hasta los programas viejos


def esperar_pcs_conectadas(minutos: int) -> None:
    """Espera a que las PC del equipo que estan CONECTADAS tengan el 100% de la
    biblioteca (asi arman la copia nueva a partir de la vieja). Las apagadas NO
    cuentan: bajaran lo nuevo cuando vuelvan. Tope: `minutos`."""
    import time
    fin = time.time() + minutos * 60
    while True:
        try:
            r = subprocess.run([str(APPIMAGE), "--sync-cli", "estado"], capture_output=True, text=True, timeout=60)
            e = json.loads(r.stdout)
        except Exception as ex:
            print(f"  AVISO: no se pudo leer el estado de Sync ({ex}); se limpia igual")
            return
        conectadas = [p for p in e.get("pcs", []) if p.get("conectado")]
        atrasadas = [p for p in conectadas if p.get("completado", 0) < 99.9]
        if not atrasadas:
            print(f"  PC conectadas al dia: {len(conectadas)} (apagadas: {len(e.get('pcs', [])) - len(conectadas)}, bajaran al volver)")
            return
        if time.time() > fin:
            print(f"  Tope de {minutos} min: {len(atrasadas)} PC conectadas aun no al 100%; se limpia igual (bajaran lo que falte)")
            return
        print("  esperando a: " + ", ".join(f"{p['nombre']} {p['completado']:.0f}%" for p in atrasadas))
        time.sleep(30)


def nombre_mix(genero: str, estado: dict) -> str:
    n = estado.setdefault("mixes", {}).get(genero, 0) + 1
    estado["mixes"][genero] = n
    return f"Mix Infiniity {genero} {n:02d}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("plan")
    ap.add_argument("--biblioteca", required=True)
    ap.add_argument("--simular", action="store_true")
    ap.add_argument("--forzar", action="store_true", help="reorganizar aunque ya este firmada")
    ap.add_argument("--mover", action="store_true", help="mover en vez de copiar (sin fase de limpieza)")
    ap.add_argument("--limpiar", action="store_true", help="borrar los originales de las canciones ya copiadas (fase 2)")
    ap.add_argument("--esperar", type=int, default=0, help="con --limpiar: esperar hasta N minutos a que las PC CONECTADAS lleguen al 100%%")
    a = ap.parse_args()
    bib = Path(a.biblioteca)
    if a.limpiar:
        if a.esperar:
            esperar_pcs_conectadas(a.esperar)
        estado = leer_estado(bib)
        pendientes = estado.get("originales_por_borrar", [])
        borrados, quedan = 0, []
        for par in pendientes:
            orig, copia = Path(par["original"]), Path(par["copia"])
            if not orig.is_file():
                continue  # ya no esta
            if not copia.is_file():
                quedan.append(par)  # la copia no existe: no borrar nada
                print(f"  AVISO: falta la copia {copia.name}; se conserva la original")
                continue
            if a.simular:
                print(f"  borraria: {orig.name}")
                quedan.append(par)
                continue
            orig.unlink()
            borrados += 1
        if not a.simular:
            estado["originales_por_borrar"] = quedan
            guardar_estado(bib, estado)
        print(f"Originales borradas de Sin clasificar: {borrados} · pendientes: {len(quedan)}")
        return
    plan = json.loads(Path(a.plan).read_text(encoding="utf-8"))
    estado = leer_estado(bib)
    hechas, saltadas, errores = 0, 0, []
    for c in plan:
        origen = Path(c["archivo"])
        if not origen.is_file():
            errores.append(f"{origen.name}: ya no existe")
            continue
        genero = c["genero"]
        if genero not in CATALOGO and genero != COMODIN:
            errores.append(f"{origen.name}: genero '{genero}' no esta en el catalogo")
            continue
        try:
            from mutagen.id3 import ID3
            firmada = False
            if origen.suffix.lower() == ".mp3":
                try:
                    firmada = any(f.desc == "INFINIITY_ORGANIZADA" for f in ID3(origen).getall("TXXX"))
                except Exception:
                    firmada = False
            if firmada and not a.forzar:
                saltadas += 1
                continue
            print(f"- {origen.name}")
            mp3 = a_mp3(origen, a.simular)
            if c.get("mix"):
                titulo = nombre_mix(genero, estado)
                artistas = ["Infiniity Eventos"]
                c = {**c, "titulo": titulo, "artistas": artistas}
            gain = None if a.simular else replaygain_db(mp3)
            bpm = c.get("bpm") or (None if a.simular else bpm_local(mp3))
            nuevo = nombre_archivo(c["titulo"], c["artistas"])
            destino_dir = bib / genero
            destino = destino_dir / nuevo
            i = 2
            while destino.exists() and destino != mp3:
                destino = destino_dir / (Path(nuevo).stem + f" ({i}).mp3")
                i += 1
            print(f"  -> {genero}/{destino.name}" + ("" if a.mover else "  (copia; la original se borra con --limpiar)"))
            if a.simular:
                escribir_etiquetas(mp3, c, gain, bpm, estado, True)
            else:
                destino_dir.mkdir(exist_ok=True)
                if a.mover:
                    shutil.move(str(mp3), str(destino))
                else:
                    # Fase 1: la ORIGINAL queda intacta en Sin clasificar (Syncthing
                    # la usa de base en las otras PC); se etiqueta la COPIA.
                    tmp = destino_dir / (".copiando-" + destino.name)
                    shutil.copy2(str(mp3), str(tmp))
                    tmp.rename(destino)
                    estado.setdefault("originales_por_borrar", []).append({"original": str(mp3), "copia": str(destino)})
                escribir_etiquetas(destino, c, gain, bpm, estado, False)
            if genero == COMODIN and c.get("genero_sugerido"):
                espera = estado.setdefault("en_espera", {}).setdefault(c["genero_sugerido"], [])
                if str(destino) not in espera:
                    espera.append(str(destino))
            hechas += 1
        except Exception as e:
            errores.append(f"{origen.name}: {e}")
    if not a.simular:
        guardar_estado(bib, estado)
    # Generos en espera que ya juntan suficientes canciones (D4/D17).
    listos = {g: v for g, v in estado.get("en_espera", {}).items() if len(v) >= UMBRAL_CARPETA_NUEVA}
    print(f"\nHechas: {hechas} · ya organizadas (saltadas): {saltadas} · errores: {len(errores)}")
    for e in errores:
        print("  ERROR:", e)
    if listos:
        print("\nGeneros en espera que ya juntan", UMBRAL_CARPETA_NUEVA, "o mas (proponer crear carpeta y mover):")
        for g, v in listos.items():
            print(f"  {g}: {len(v)} canciones")
    sys.exit(1 if errores else 0)


if __name__ == "__main__":
    main()
