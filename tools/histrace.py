"""Degradacion real de carreras pasadas, para calibrar la degradacion del modelo (herramienta de mantenimiento).

    python tools/histrace.py              baja el Analysis de la Carrera de TODOS los GP de esta temporada y la anterior (HISTORICO/<año>/<GP>/Analysis.pdf)
                                          y calcula, por carrera, la degradacion media del campo (s/vuelta por vuelta), la temperatura de pista y el neumatico trasero
    Escribe API/degradacion.json y enseña la tabla. Solo carreras en seco y con el formato de PDF actual (2025 en adelante).
"""
import json, re, statistics as st, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pipeline, descargar

def slope(xs, ys):
    mx, my = st.mean(xs), st.mean(ys); sxx = sum((x - mx) ** 2 for x in xs)
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx if sxx else 0.0

def race_deg(path):
    secs = [s for s in pipeline.sections(path) if s['kind'] == 'analysis']
    if not secs: return None
    raw = pipeline.parse_analysis(secs[0]); per = {}; tyres = []
    for n, v in raw.items():
        L = sorted(v['laps'], key=lambda l: l['n'])
        if len(L) < 12: continue
        ok = [l for l in L if l['n'] >= 2 and not l.get('x') and not l.get('p')]
        if len(ok) < 10: continue
        med = st.median(l['t'] for l in ok); ok = [l for l in ok if l['t'] <= 1.07 * med]
        per[n] = {'deg': slope([l['n'] for l in ok], [l['t'] for l in ok]), 'med': st.median(l['t'] for l in ok), 'n': len(ok)}
        r = next((l.get('r') for l in L if l.get('r')), None)
        if r: tyres.append(r)
    if len(per) < 8: return None
    return {'riders': len(per), 'deg': st.median(p['deg'] for p in per.values()), 'degMean': st.mean(p['deg'] for p in per.values()),
            'degSd': st.pstdev([p['deg'] for p in per.values()]), 'pace': st.median(p['med'] for p in per.values()), 'rear': max(set(tyres), key=tyres.count) if tyres else None}

def main(years=None):
    years = years or [time.localtime().tm_year, time.localtime().tm_year - 1]
    old = {(r['year'], r['code']): r for r in (descargar.jload(pipeline.API_DIR / 'degradacion.json', []) or [])}
    out = []
    seasons = {s['year']: s for s in descargar.api('results/seasons')}
    for y in years:
        for ev in sorted(descargar.api(f'results/events?seasonUuid={seasons[y]["id"]}'), key=lambda e: e['date_start']):
            if ev.get('test') or ev['date_start'] > time.strftime('%Y-%m-%d'): continue
            code = ev['short_name']
            if (y, code) in old: out.append(old[(y, code)]); continue
            cat = descargar.motogp_cat(ev['id'])
            ses = next((s for s in descargar.api(f'results/sessions?eventUuid={ev["id"]}&categoryUuid={cat["id"]}') if s['type'] == 'RAC' and s['status'] == 'FINISHED'), None) if cat else None
            if not ses: continue
            cond = descargar.session_cond(ses)
            if cond['track'] != 'Dry' or cond['ground'] is None: print(y, code, 'mojado o sin temperatura: se omite'); continue
            url = ((ses.get('session_files') or {}).get('analysis') or {}).get('url')
            f = pipeline.ROOT / 'HISTORICO' / str(y) / code / 'Analysis.pdf'
            if not url: continue
            if not f.exists() and descargar.fetch(url, f).startswith(('error', 'no disp')): print(y, code, 'sin Analysis'); continue
            try: m = race_deg(f)
            except Exception as e: print(y, code, 'no se pudo leer:', e); continue
            if not m: print(y, code, 'formato no reconocido'); continue
            m.update(year=y, code=code, ground=cond['ground'], air=cond['air'], hum=cond['hum']); out.append(m)
            print(f"{y} {code} pista {cond['ground']:>2}° aire {cond['air']}° | rear {m['rear']} | deg campo {m['deg']:+.3f} (media {m['degMean']:+.3f} ±{m['degSd']:.3f}) | {m['riders']} pilotos", flush=True)
    descargar.jsave(pipeline.API_DIR / 'degradacion.json', out)
    print(f'{len(out)} carreras guardadas en API/degradacion.json')
    return 0

if __name__ == '__main__':
    sys.exit(main())
