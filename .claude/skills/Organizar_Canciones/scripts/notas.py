#!/usr/bin/env python3
"""Notas del equipo sobre canciones («no va en esta carpeta», «el artista esta mal»...).

Las escribe la app con clic derecho sobre una cancion, en cualquier PC, y viajan
por Sync a `<BIB>/Sin clasificar/.notas/` (un JSON por nota; ver
src-tauri/src/notas.rs). Este script:

  notas.py "$BIB"                       -> lista las pendientes (JSON por stdout)
  notas.py "$BIB" --atender ARCHIVO --respuesta "Movida a Merengue"
                                        -> la retira: la guarda en
                                           .organizar/notas-atendidas/ con la
                                           respuesta, y al desaparecer de
                                           «Sin clasificar» Sync la borra en todas
                                           las PC (la marca ✎ de la app se va sola)

Por cada nota dice si la cancion sigue donde estaba (`existe`) y, si no, donde
esta ahora (`ruta_actual`, buscando el mismo nombre de archivo en la biblioteca):
la skill puede haberla movido o renombrado despues de escribirse la nota.
"""
import argparse
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path

SIN_CLASIFICAR = "Sin clasificar"


def carpeta_notas(bib: Path) -> Path:
    return bib / SIN_CLASIFICAR / ".notas"


def listar(bib: Path) -> list:
    dir_notas = carpeta_notas(bib)
    if not dir_notas.is_dir():
        return []
    por_nombre = None  # indice nombre de archivo -> rutas, solo si hace falta
    notas = []
    for f in sorted(dir_notas.glob("*.json")):
        try:
            n = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            # A medio llegar por Sync: se dice y se sigue con las demas.
            print(f"AVISO: {f.name} no se pudo leer ({e})", file=sys.stderr)
            continue
        n["archivo"] = f.name
        ruta = bib / n.get("cancion", "")
        n["existe"] = ruta.is_file()
        n["ruta_actual"] = str(ruta) if n["existe"] else None
        if not n["existe"]:
            if por_nombre is None:
                por_nombre = {}
                for p in bib.rglob("*"):
                    if p.is_file() and not any(parte.startswith(".") for parte in p.relative_to(bib).parts):
                        por_nombre.setdefault(p.name, []).append(p)
            iguales = por_nombre.get(Path(n.get("cancion", "")).name, [])
            if len(iguales) == 1:
                n["ruta_actual"] = str(iguales[0])
        notas.append(n)
    notas.sort(key=lambda n: n.get("fecha", ""))
    return notas


def atender(bib: Path, archivo: str, respuesta: str) -> Path:
    if "/" in archivo or ".." in archivo or not archivo.endswith(".json"):
        sys.exit(f"Nombre de nota no valido: {archivo}")
    origen = carpeta_notas(bib) / archivo
    if not origen.is_file():
        sys.exit(f"No existe la nota {archivo} (¿ya se atendio?)")
    n = json.loads(origen.read_text(encoding="utf-8"))
    n["respuesta"] = respuesta
    n["atendida"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    destino_dir = bib / ".organizar" / "notas-atendidas"
    destino_dir.mkdir(parents=True, exist_ok=True)
    destino = destino_dir / archivo
    destino.write_text(json.dumps(n, ensure_ascii=False, indent=2), encoding="utf-8")
    origen.unlink()
    return destino


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("biblioteca")
    ap.add_argument("--atender", metavar="ARCHIVO")
    ap.add_argument("--respuesta", default="")
    a = ap.parse_args()
    bib = Path(a.biblioteca)
    if a.atender:
        if not a.respuesta.strip():
            sys.exit("--respuesta es obligatoria: que se hizo con la nota (queda guardado)")
        print(f"Atendida: {atender(bib, a.atender, a.respuesta.strip())}")
        return
    notas = listar(bib)
    json.dump(notas, sys.stdout, ensure_ascii=False, indent=2)
    print()
    print(f"Notas pendientes: {len(notas)}", file=sys.stderr)


if __name__ == "__main__":
    main()
