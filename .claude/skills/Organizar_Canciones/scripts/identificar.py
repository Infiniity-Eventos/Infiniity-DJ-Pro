#!/usr/bin/env python3
"""Identifica por internet cada cancion de una carpeta (normalmente "Sin clasificar").

Uso:  identificar.py <carpeta> [--salida candidatos.json] [--max N]

Por cada archivo de audio:
  - limpia el nombre de YouTube y busca en Deezer (titulo, artista, colaboradores,
    album, fecha, BPM, ISRC, genero del album) y en iTunes (genero);
  - mide la duracion (ffprobe) y decide si es un MIX;
  - lee las etiquetas que ya traiga (comentario con el id de YouTube, si lo bajo la app);
  - calcula una CONFIANZA (0-1) comparando el nombre limpio con "titulo artista";
  - propone un genero del catalogo con una tabla de equivalencias; lo que no
    cuadre queda "?" para que Claude decida con criterio.
  - marca REPETIDAS (mismo ISRC o mismo titulo+artista) dentro del lote y
    contra la biblioteca ya organizada.

Escribe un JSON con todo. No toca ningun archivo.
"""
import argparse
import difflib
import re
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from comun import (AUDIO_EXT, CATALOGO, clave_normal, duracion_segundos, es_mix,  # noqa: E402
                   limpiar_nombre)

UA = "InfiniityDJ-Organizar/1.0 (sinfiniity@gmail.com)"

# Genero de internet (Deezer/iTunes, en minusculas) -> carpeta del catalogo.
# Lo que no este aqui queda "?" y lo decide Claude (D14: muy por encima, colombianizado).
EQUIVALENCIAS = {
    "merengue": "Merengue", "merengue típico": "Merengue",
    "salsa": "Salsa", "salsa choke": "Salsa Choque", "salsa choque": "Salsa Choque",
    "bachata": "Bachata",
    "vallenato": "Vallenato",
    "reggaeton": "Reggaeton", "reggaetón": "Reggaeton", "urbano latino": "Reggaeton", "latin urban": "Reggaeton",
    "urban latino": "Reggaeton", "dembow": "Reggaeton", "perreo": "Reggaeton",
    "champeta": "Champeta",
    "bolero": "Boleros", "boleros": "Boleros",
    "cumbia": "Cumbia",
    "pop": "Pop", "pop latino": "Pop", "latin pop": "Pop", "pop en español": "Pop", "dance pop": "Pop",
    "rock": "Rock", "rock en español": "Rock", "rock latino": "Rock", "alternative": "Rock", "alternativa": "Rock",
    "metal": "Rock", "punk": "Rock", "indie": "Rock",
    "electrónica": "Electronica", "electronic": "Electronica", "electro": "Electronica", "dance": "Electronica",
    "house": "Electronica", "techno": "Electronica", "edm": "Electronica", "trance": "Electronica",
    "guaracha": "Electronica", "aleteo": "Electronica",
    "trap": "Trap", "trap latino": "Trap", "latin trap": "Trap", "hip hop": "Trap", "hip-hop": "Trap",
    "rap": "Trap", "hip-hop/rap": "Trap", "rap/hip hop": "Trap", "drill": "Trap",
}
# Pistas en el TITULO/ARTISTA que delatan el genero cuando internet no lo dice.
PISTAS_NOMBRE = {
    "Merengue": ["merengue", "wilfrido", "juan luis guerra", "sergio vargas", "eddy herrera", "olga tañón", "los hermanos rosario"],
    "Salsa": ["salsa", "grupo niche", "joe arroyo", "willie colon", "hector lavoe", "marc anthony", "gilberto santa rosa", "fruko", "oscar d'leon"],
    "Bachata": ["bachata", "romeo santos", "aventura", "prince royce", "frank reyes", "zacarias ferreira"],
    "Vallenato": ["vallenato", "diomedes", "binomio de oro", "silvestre dangond", "jorge celedon", "los diablitos", "peter manjarres", "kaleth morales"],
    "Champeta": ["champeta", "mr black", "twister", "kevin florez", "el afinaito"],
    "Reggaeton": ["reggaeton", "daddy yankee", "don omar", "wisin", "yandel", "nicky jam", "bad bunny", "j balvin", "maluma", "karol g", "feid", "ozuna", "anuel", "plan b", "tego calderon", "hector el father", "zion", "lennox", "arcangel", "de la ghetto", "rauw alejandro", "sech", "myke towers"],
    "Trap": ["duki", "trap", "bizarrap", "ysy a", "khea", "eladio carrion", "cazzu"],
    "Cumbia": ["cumbia", "la sonora dinamita", "los angeles azules", "lisandro meza", "andres landero"],
    "Boleros": ["bolero", "los panchos", "javier solis", "lucho gatica"],
    "Electronica": ["guaracha", "aleteo", "zapateo", "remix electr", "house", "techno"],
    "Hora Loca": ["hora loca", "gangnam", "macarena", "payaso de rodeo", "chicken dance", "el meneaito", "la bomba", "el baile del gorila", "caballo dorado", "waka waka"],
}


def http_json(url: str, intentos: int = 3):
    for i in range(intentos):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=25) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:
            if i == intentos - 1:
                print(f"AVISO: {url[:80]}... -> {e}", file=sys.stderr)
                return None
            time.sleep(1.5 * (i + 1))


def consulta_limpia(q: str) -> str:
    return re.sub(r"[?!¿¡\"'()\[\]]", " ", q).strip()


def deezer(query: str) -> dict | None:
    query = consulta_limpia(query)
    d = http_json("https://api.deezer.com/search?limit=5&q=" + urllib.parse.quote(query))
    if not d or not d.get("data"):
        return None
    mejor, mejor_sim = None, 0.0
    for c in d["data"][:5]:
        cadena = f"{c['title']} {c['artist']['name']}"
        sim = similitud(query, cadena)
        if sim > mejor_sim:
            mejor, mejor_sim = c, sim
    if not mejor:
        return None
    t = http_json(f"https://api.deezer.com/track/{mejor['id']}") or {}
    time.sleep(0.25)  # Deezer tolera ~50 llamadas/5 s; sin prisa
    album = http_json(f"https://api.deezer.com/album/{mejor['album']['id']}") or {}
    generos = [g["name"] for g in (album.get("genres") or {}).get("data", [])]
    contribs = [c["name"] for c in t.get("contributors", [])] or [mejor["artist"]["name"]]
    return {
        "fuente": "deezer",
        "titulo": t.get("title_short") or mejor["title"],
        "artista": mejor["artist"]["name"],
        "colaboradores": contribs,
        "album": mejor["album"]["title"],
        "fecha": t.get("release_date") or album.get("release_date"),
        "bpm": t.get("bpm") or None,
        "isrc": t.get("isrc"),
        "generos": generos,
        "duracion": t.get("duration"),
        "url": mejor.get("link"),
        "similitud": round(mejor_sim, 2),
    }


def itunes(query: str) -> dict | None:
    query = consulta_limpia(query)
    d = http_json("https://itunes.apple.com/search?entity=song&limit=3&term=" + urllib.parse.quote(query))
    if not d or not d.get("results"):
        return None
    mejor, mejor_sim = None, 0.0
    for c in d["results"][:3]:
        sim = similitud(query, f"{c.get('trackName','')} {c.get('artistName','')}")
        if sim > mejor_sim:
            mejor, mejor_sim = c, sim
    if not mejor:
        return None
    return {
        "fuente": "itunes",
        "titulo": mejor.get("trackName"),
        "artista": mejor.get("artistName"),
        "genero": mejor.get("primaryGenreName"),
        "fecha": (mejor.get("releaseDate") or "")[:10],
        "similitud": round(mejor_sim, 2),
    }


def similitud(a: str, b: str) -> float:
    ka, kb = clave_normal(a), clave_normal(b)
    if not ka or not kb:
        return 0.0
    r = difflib.SequenceMatcher(None, ka, kb).ratio()
    # Si todas las palabras de la respuesta estan en la consulta (o al reves), sube.
    pa, pb = set(ka.split()), set(kb.split())
    contenido = len(pa & pb) / max(1, min(len(pa), len(pb)))
    return max(r, contenido * 0.95)


def etiquetas_actuales(ruta: Path) -> dict:
    try:
        from mutagen.id3 import ID3
        t = ID3(ruta)
        get = lambda k: str(t[k].text[0]) if k in t and t[k].text else None  # noqa: E731
        com = [str(f.text[0]) for f in t.getall("COMM") if f.text]
        txxx = {f.desc: str(f.text[0]) for f in t.getall("TXXX") if f.text}
        return {"titulo": get("TIT2"), "artista": get("TPE1"), "genero": get("TCON"),
                "comentarios": com, "txxx": txxx, "firmada": txxx.get("INFINIITY_ORGANIZADA") is not None}
    except Exception:
        return {"titulo": None, "artista": None, "genero": None, "comentarios": [], "txxx": {}, "firmada": False}


# Generos de internet demasiado genericos: sirven de pista, no de prueba.
DEBILES = {"dance", "pop", "latin", "latino", "world", "electronic", "música latina", "latin music", "alternative", "indie"}


def proponer_genero(dz: dict | None, it: dict | None, nombre: str) -> tuple[str, str, bool]:
    """Devuelve (genero_propuesto o "?", motivo, seguro).
    'seguro' = False cuando hay que revisarlo: internet y el artista no coinciden,
    el genero de internet es generico, o solo hay una pista debil."""
    candidatos = []
    if dz:
        candidatos += [g.lower() for g in dz.get("generos", [])]
    if it and it.get("genero"):
        candidatos.append(it["genero"].lower())
    por_internet = next(((EQUIVALENCIAS[g], g) for g in candidatos if g in EQUIVALENCIAS), None)
    texto = clave_normal(nombre + " " + (dz["artista"] if dz else "") + " " + " ".join(dz["colaboradores"] if dz else []))
    por_artista = None
    for carpeta, pistas in PISTAS_NOMBRE.items():
        for p in pistas:
            if clave_normal(p) in texto:
                por_artista = (carpeta, p)
                break
        if por_artista:
            break
    if por_internet and por_artista:
        if por_internet[0] == por_artista[0]:
            return por_internet[0], f"internet dice '{por_internet[1]}' y el artista ('{por_artista[1]}') coincide", True
        # Chocan: el artista suele mandar (Deezer etiqueta albumes raro), pero se revisa.
        return por_artista[0], f"CHOCAN: internet dice '{por_internet[1]}' pero el artista '{por_artista[1]}' es de {por_artista[0]}", False
    if por_artista:
        return por_artista[0], f"artista/nombre: '{por_artista[1]}'", True
    if por_internet:
        debil = por_internet[1] in DEBILES
        return por_internet[0], f"internet dice '{por_internet[1]}'" + (" (generico: revisar)" if debil else ""), not debil
    return "?", ("internet dice " + ", ".join(candidatos)) if candidatos else "internet no dio genero", False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("carpeta")
    ap.add_argument("--salida", default=None)
    ap.add_argument("--max", type=int, default=0)
    ap.add_argument("--biblioteca", default=None, help="raiz de la biblioteca (para detectar repetidas ya organizadas)")
    a = ap.parse_args()
    carpeta = Path(a.carpeta)
    archivos = sorted(p for p in carpeta.iterdir() if p.is_file() and p.suffix.lower() in AUDIO_EXT and not p.name.startswith("."))
    if a.max:
        archivos = archivos[: a.max]

    # Indice de lo ya organizado (para repetidas): isrc y titulo+artista.
    ya = {}
    if a.biblioteca:
        from mutagen.id3 import ID3
        for p in Path(a.biblioteca).rglob("*.mp3"):
            if any(part.startswith(".") for part in p.parts) or p.parent == carpeta:
                continue
            try:
                t = ID3(p)
                isrc = str(t["TSRC"].text[0]) if "TSRC" in t else None
                tit = str(t["TIT2"].text[0]) if "TIT2" in t else ""
                art = str(t["TPE1"].text[0]) if "TPE1" in t else ""
                if isrc:
                    ya[f"isrc:{isrc}"] = str(p)
                if tit:
                    ya[f"ta:{clave_normal(tit)}|{clave_normal(art.split(' x ')[0])}"] = str(p)
            except Exception:
                pass

    resultados = []
    vistos_lote = {}
    for i, p in enumerate(archivos, 1):
        nombre = limpiar_nombre(p.name)
        seg = duracion_segundos(str(p))
        mix = es_mix(p.name, seg)
        print(f"[{i}/{len(archivos)}] {p.name[:70]}", file=sys.stderr)
        dz = it = None
        if not mix and nombre:
            dz = deezer(nombre)
            it = itunes(nombre)
        actuales = etiquetas_actuales(p)
        yt = next((c for c in actuales["comentarios"] if len(c) == 11 and " " not in c), None)
        genero, motivo, seguro = proponer_genero(dz, it, nombre) if not mix else ("?", "mix: genero por el nombre", False)
        if mix:
            for carpeta_g, pistas in PISTAS_NOMBRE.items():
                if any(clave_normal(x) in clave_normal(p.name) for x in pistas):
                    genero, motivo = carpeta_g, "mix: pista en el nombre"
                    break
        # Respaldo cuando internet no reconoce: el nombre de YouTube suele venir
        # "Artista - Titulo" (o "Artista, Otro - Titulo").
        desde_nombre = None
        if " - " in nombre:
            izq, der = nombre.split(" - ", 1)
            desde_nombre = {"artistas": [x.strip() for x in izq.replace(" y ", ",").split(",") if x.strip()], "titulo": der.strip()}
        confianza = 0.0
        if dz:
            confianza = dz["similitud"]
            if it and clave_normal(it["titulo"] or "") == clave_normal(dz["titulo"]):
                confianza = min(1.0, confianza + 0.1)
            if dz.get("duracion") and seg and abs(dz["duracion"] - seg) <= 8:
                confianza = min(1.0, confianza + 0.1)
            elif dz.get("duracion") and seg and abs(dz["duracion"] - seg) > 45:
                confianza = max(0.0, confianza - 0.3)
        repetida_de = None
        if dz:
            k1 = f"isrc:{dz['isrc']}" if dz.get("isrc") else None
            k2 = f"ta:{clave_normal(dz['titulo'])}|{clave_normal(dz['artista'])}"
            for k in (k1, k2):
                if k and k in ya:
                    repetida_de = ya[k]
                elif k and k in vistos_lote:
                    repetida_de = vistos_lote[k]
            for k in (k1, k2):
                if k:
                    vistos_lote.setdefault(k, str(p))
        resultados.append({
            "archivo": str(p),
            "nombre_limpio": nombre,
            "segundos": round(seg, 1),
            "mix": mix,
            "etiquetas_actuales": actuales,
            "youtube_id": yt,
            "deezer": dz,
            "itunes": it,
            "confianza": round(confianza, 2),
            "genero_propuesto": genero,
            "motivo_genero": motivo,
            "genero_seguro": seguro,
            "desde_nombre": desde_nombre,
            "repetida_de": repetida_de,
            "ya_organizada": actuales["firmada"],
        })
    salida = json.dumps(resultados, ensure_ascii=False, indent=1)
    if a.salida:
        Path(a.salida).write_text(salida, encoding="utf-8")
        print(f"{len(resultados)} canciones -> {a.salida}", file=sys.stderr)
    else:
        print(salida)


if __name__ == "__main__":
    main()
