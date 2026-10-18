"""Utilidades compartidas por los scripts de /Organizar_Canciones.

Sin dependencias raras: Python 3 + mutagen (ya instalado en el PC original).
"""
import json
import os
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

# Catalogo "colombianizado" (decision D14 de la guia). Nombres EXACTOS de carpeta.
CATALOGO = [
    "Merengue", "Salsa", "Salsa Choque", "Bachata", "Vallenato", "Reggaeton",
    "Champeta", "Boleros", "Viejoteca", "Cumbia", "Pop", "Rock", "Electronica",
    "Crossover", "Trap", "Hora Loca", "Mexicana", "Carranga",
]
COMODIN = "Otros"           # carpeta comodin (D4): lo que no encaja todavia
SIN_CLASIFICAR = "Sin clasificar"
FIRMA = "Creado por Infiniity Eventos"   # D15: en todo campo que no se use
UMBRAL_CARPETA_NUEVA = 3    # D17
MIX_SEGUNDOS = 15 * 60      # a partir de aqui es un mix (S: suposicion)
AUDIO_EXT = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".flac", ".wma", ".webm"}

# Palabras de los titulos de YouTube que no son parte de la cancion.
BASURA = [
    r"\(video oficial\)", r"\(official video\)", r"\(official music video\)", r"\(video lyric\)",
    r"\(lyric video\)", r"\(official lyric video\)", r"\(letra\)", r"\(letra oficial\)", r"\(audio\)",
    r"\(official audio\)", r"\[official audio\]", r"\(visualizer\)", r"\(video letra\)", r"\(audio oficial\)",
    r"\(performance video\)", r"\(video clip\)", r"\(videoclip\)", r"\(hd\)", r"\(hq\)", r"\(remastered\)",
    r"\[.*?\]", r"｜.*$", r"\|.*$", r"\bft\.?\b", r"\bfeat\.?\b", r"\bfeaturing\b", r"©.*$", r"℗.*$",
    r"\(prod\..*?\)", r"\(prod .*?\)", r"\bofficial\b", r"\bvideo\b", r"\blyrics?\b", r"\bletra\b",
    r"\boficial\b", r"\baudio\b", r"\bvisualizer\b", r"\bremaster(ed)?\b", r"\b4k\b", r"\bhd\b",
]


def sin_acentos(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def limpiar_nombre(nombre: str) -> str:
    """Nombre de archivo de YouTube -> texto para buscar en internet."""
    s = Path(nombre).stem
    s = s.replace("＂", '"').replace("？", "?").replace("＂", "")
    s = s.replace("_", " ")
    for pat in BASURA:
        s = re.sub(pat, " ", s, flags=re.IGNORECASE)
    s = re.sub(r"[\"'“”‘’]", " ", s)
    s = re.sub(r"\s+", " ", s).strip(" -–—·,.")
    return s


def clave_normal(s: str) -> str:
    """Para comparar nombres sin que importen mayusculas, acentos ni simbolos (D22)."""
    s = sin_acentos(s).lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


PALABRAS_MINUSCULA = {"de", "del", "la", "las", "el", "los", "y", "e", "a", "en", "con", "por", "para",
                      "un", "una", "al", "the", "of", "and", "x"}


def titulo_bonito(s: str) -> str:
    """Cada Palabra Con Mayuscula Inicial, sin acentos ni simbolos raros (D16).
    Las particulas (de, la, y...) van en minuscula salvo al principio."""
    # "(feat. X)", "(with X)", "[ft. X]": los colaboradores ya van en el artista.
    s = re.sub(r"[\(\[]\s*(feat|ft|with|con)\.?\s[^\)\]]*[\)\]]", " ", s, flags=re.IGNORECASE)
    s = sin_acentos(s)
    s = re.sub(r"[^A-Za-z0-9 \-x'&.]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    palabras = []
    for i, w in enumerate(s.split(" ")):
        lw = w.lower()
        if lw == "x":
            palabras.append("x")
        elif i > 0 and lw in PALABRAS_MINUSCULA:
            palabras.append(lw)
        else:
            palabras.append(lw[:1].upper() + lw[1:])
    return " ".join(palabras)


def nombre_archivo(titulo: str, artistas: list[str]) -> str:
    """D6: 'Nombre De La Cancion - Artista x Colaborador 1 x Colaborador 2.mp3'."""
    t = titulo_bonito(titulo)
    a = " x ".join(titulo_bonito(x) for x in artistas if x.strip())
    base = f"{t} - {a}" if a else t
    base = base.replace("/", "-").replace("\\", "-").strip()
    return base[:180] + ".mp3"


def duracion_segundos(ruta: str) -> float:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", ruta],
            capture_output=True, text=True, timeout=60,
        )
        return float(out.stdout.strip() or 0)
    except Exception:
        return 0.0


def es_mix(nombre: str, segundos: float) -> bool:
    n = nombre.lower()
    return segundos >= MIX_SEGUNDOS or bool(re.search(r"\b(mix|megamix|mezcla|set|enganchad|hora loca)\b", n))


def leer_estado(biblioteca: Path) -> dict:
    p = biblioteca / ".organizar" / "estado.json"
    if p.is_file():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"AVISO: estado.json danado ({e}); se parte de cero", file=sys.stderr)
    return {"mixes": {}, "en_espera": {}, "alias_artistas": {}}


def guardar_estado(biblioteca: Path, estado: dict) -> None:
    d = biblioteca / ".organizar"
    d.mkdir(exist_ok=True)
    (d / "estado.json").write_text(json.dumps(estado, ensure_ascii=False, indent=2), encoding="utf-8")


def artista_canonico(nombre: str, estado: dict) -> str:
    """Un artista = una sola forma escrita (D22). La primera vez que se ve una
    forma, queda como canonica; las variantes (mayusculas, acentos, espacios)
    se reconocen por clave_normal."""
    alias = estado.setdefault("alias_artistas", {})
    k = clave_normal(nombre)
    if not k:
        return nombre.strip()
    if k in alias:
        return alias[k]
    canon = titulo_bonito(nombre)
    alias[k] = canon
    return canon


def artistas_existentes(biblioteca: Path) -> dict:
    """Artistas ya escritos en la biblioteca (TPE1), por clave normalizada."""
    from mutagen.id3 import ID3
    vistos = {}
    for p in biblioteca.rglob("*.mp3"):
        if any(part.startswith(".") for part in p.parts):
            continue
        try:
            t = ID3(p)
            tpe1 = t.get("TPE1")
            if tpe1:
                for a in str(tpe1.text[0]).split(" x "):
                    vistos.setdefault(clave_normal(a), a.strip())
        except Exception:
            pass
    return vistos
