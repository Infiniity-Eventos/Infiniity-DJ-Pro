#!/usr/bin/env python3
"""Genera una pagina HTML para revisar dudosas y repetidas ESCUCHANDOLAS (D19):
cada cancion con su reproductor, lo que internet cree que es, y opciones.
Al final, boton "Copiar respuestas" para pegarlas en el chat.

Uso:  revision.py <candidatos.json> --salida <Revision.html> [--umbral 0.75]
"""
import argparse
import html
import json
from datetime import date
from pathlib import Path

CATALOGO_OPCIONES = ["Merengue", "Salsa", "Salsa Choque", "Bachata", "Vallenato", "Reggaeton", "Champeta",
                     "Boleros", "Viejoteca", "Cumbia", "Pop", "Rock", "Electronica", "Crossover", "Trap",
                     "Hora Loca", "Mexicana", "Carranga", "Otros", "Dejar en Sin clasificar", "Borrar"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("candidatos")
    ap.add_argument("--salida", required=True)
    ap.add_argument("--umbral", type=float, default=0.75)
    a = ap.parse_args()
    cands = json.loads(Path(a.candidatos).read_text(encoding="utf-8"))
    dudosas = [c for c in cands if not c["ya_organizada"] and (c["confianza"] < a.umbral or c["genero_propuesto"] == "?" or c["mix"] or not c.get("genero_seguro", True))]
    repetidas = [c for c in cands if c.get("repetida_de")]
    filas = []
    n = 0
    for c in dudosas + [r for r in repetidas if r not in dudosas]:
        n += 1
        dz = c.get("deezer") or {}
        src = "file://" + html.escape(c["archivo"])
        rep = c.get("repetida_de")
        info = ""
        if dz:
            info = f"Internet cree: <b>{html.escape(dz.get('titulo') or '')}</b> — {html.escape(' x '.join(dz.get('colaboradores') or []))} · {html.escape(dz.get('album') or '')} · {html.escape(str(dz.get('fecha') or ''))} · BPM {dz.get('bpm') or '?'} · confianza {c['confianza']}"
        else:
            info = "Internet no la reconoció."
        extra = ""
        if rep:
            extra = f'<div class="rep">Parece REPETIDA de: <code>{html.escape(rep)}</code><br><audio controls preload="none" src="file://{html.escape(rep)}"></audio></div>'
        if c["mix"]:
            extra += f'<div class="rep">Es un MIX ({int(c["segundos"]//60)} min). Se nombrará "Mix Infiniity &lt;Género&gt; NN".</div>'
        opciones = "".join(
            f'<label><input type="radio" name="q{n}" value="{html.escape(o)}" {"checked" if o == c["genero_propuesto"] else ""}> {html.escape(o)}</label>'
            for o in CATALOGO_OPCIONES
        )
        filas.append(f'''
<div class="card" id="c{n}">
  <div class="num">{n}</div>
  <div class="body">
    <div class="name">{html.escape(Path(c["archivo"]).name)}</div>
    <audio controls preload="none" src="{src}"></audio>
    <div class="info">{info} · propuesto: <b>{html.escape(c["genero_propuesto"])}</b> ({html.escape(c["motivo_genero"])})</div>
    {extra}
    <div class="ops">{opciones}</div>
    <input class="obs" data-n="{n}" placeholder="Observación (ej: es un remix, nombre real: ...)">
  </div>
</div>''')
    pagina = f'''<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Revisión Organizar_Canciones {date.today()}</title>
<style>
body{{font-family:system-ui,sans-serif;background:#1a1230;color:#eee;margin:0;padding:24px;max-width:980px;margin:auto}}
h1{{font-size:20px}} .card{{display:flex;gap:14px;background:#2a1d4d;border-radius:12px;padding:14px;margin:12px 0}}
.num{{font-size:22px;font-weight:700;color:#c084fc;min-width:34px}} .body{{flex:1}} .name{{font-weight:600;margin-bottom:6px;word-break:break-all}}
audio{{width:100%;margin:6px 0}} .info{{font-size:13px;color:#cbbdea}} .rep{{font-size:13px;background:#4a2a2a;padding:8px;border-radius:8px;margin:8px 0}}
.ops{{display:flex;flex-wrap:wrap;gap:6px 12px;margin:8px 0;font-size:13px}} .ops label{{white-space:nowrap}}
.obs{{width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #5b4ba0;background:#1a1230;color:#eee}}
button{{background:#7c3aed;color:#fff;border:0;padding:12px 20px;border-radius:10px;font-size:15px;cursor:pointer}}
.top{{position:sticky;top:0;background:#1a1230;padding:10px 0;z-index:2}}
</style></head><body>
<div class="top"><h1>Revisión de canciones · {date.today()} · {n} por decidir</h1>
<p>Escucha, marca la carpeta (o Borrar / Dejar) y pulsa <b>Copiar respuestas</b>; pégalas en el chat.</p>
<button onclick="copiar()">📋 Copiar respuestas</button> <span id="t"></span></div>
{''.join(filas)}
<script>
function copiar(){{
  const out=[];
  document.querySelectorAll('.card').forEach(c=>{{
    const n=c.querySelector('.num').textContent; const r=c.querySelector('input[type=radio]:checked');
    const o=c.querySelector('.obs').value.trim();
    out.push(n+': '+(r?r.value:'(sin decidir)')+(o?' · '+o:''));
  }});
  const txt='=== REVISION ORGANIZAR_CANCIONES {date.today()} ===\\n'+out.join('\\n')+'\\n=== FIN ===';
  const ok=()=>{{document.getElementById('t').textContent='✅ Copiado'}};
  if(navigator.clipboard&&navigator.clipboard.writeText){{navigator.clipboard.writeText(txt).then(ok).catch(()=>respaldo(txt,ok));}}else respaldo(txt,ok);
}}
function respaldo(txt,ok){{const ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();try{{document.execCommand('copy');ok();}}catch(e){{alert('No se pudo copiar; selecciona y copia a mano');}}document.body.removeChild(ta);}}
</script></body></html>'''
    Path(a.salida).write_text(pagina, encoding="utf-8")
    print(f"{n} canciones por revisar -> {a.salida}")


if __name__ == "__main__":
    main()
