"""Descarga los PDF oficiales de cronometro de motogp.com (API publica) a <CIRCUITO>/<SESION>/ en vez de copiarlos a mano.

    python tools/descargar.py                    el evento en curso (de ayer a mañana de su fin de semana)
    python tools/descargar.py --circuito qatar   un circuito concreto (id de CIRCUITS en pipeline.py)
    python tools/descargar.py --todos            todos los circuitos configurados
    python tools/descargar.py --año 2025 --circuito malasya   otra temporada: va a HISTORICO/2025/MALASYA/ (nunca mezcla con la actual)
    python tools/descargar.py --simular          solo muestra que bajaria, sin escribir nada
    python tools/descargar.py --bundle           incluye tambien el Session.pdf completo (redundante, pesa mas)

Que hace:
  * busca el evento del circuito (campo 'api' de CIRCUITS, p. ej. MAL) y, de la categoria MotoGP, las sesiones terminadas;
  * baja cada informe que la API enlaza (Analysis, Classification, Grid, Lap Chart, Best Partial Time...) a su carpeta
    (FP1, PR, FP2, Q1, Q2, SPRINT, RACE) con el mismo nombre que usa la web;
  * baja tambien los informes del evento (Circuit Information, Entry, Rider Statistics, Event Maximum Speed) a <CIRCUITO>/EVENTO/;
  * si un PDF ya existe con el mismo tamaño lo salta; si cambio de tamaño (resultado provisional -> definitivo, Event Max Speed
    que crece con cada sesion...) lo sustituye. Un fichero equivalente con otro nombre (analysisbylap.pdf = AnalysisByLap.pdf) cuenta como existente;
  * guarda <CIRCUITO>/evento.json con el calendario (horas de cada sesion, entre ellas la de la Carrera).

Los PDF son propiedad de MotoGP / Dorna: uso privado y sin sobrecargar el servicio (una peticion a la vez, con pausa).
"""
import json, re, sys, time, urllib.error, urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pipeline

API = 'https://api.pulselive.motogp.com/motogp/v1'
FILES = 'https://resources.motogp.com/files/results'
UA = {'User-Agent': 'Mozilla/5.0 (motogp-ana pdf fetch)'}
PAUSE = 0.2
SID_DIR = {('FP', 1): 'FP1', ('PR', None): 'PR', ('FP', 2): 'FP2', ('Q', 1): 'Q1', ('Q', 2): 'Q2', ('SPR', None): 'SPRINT', ('RAC', None): 'RACE'}
SID_KEY = {'FP1': 'FP1', 'PR': 'PR', 'FP2': 'FP2', 'Q1': 'Q1', 'Q2': 'Q2', 'SPRINT': 'SPR', 'RACE': 'RAC'}
SKIP = {'session', 'world_standing'}                      # bundle completo y clasificacion del Mundial: no aportan nada que no este en los sueltos
EVENT_DOCS = ['Entry.pdf', 'EntryBiographical.pdf', 'EventMaximumSpeed.pdf']        # en <año>/<EVT>/MotoGP/ (no los enlaza la API de sesiones)

def say(*a): print(*a, file=sys.stderr, flush=True)

def req(url, method='GET'):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA, method=method), timeout=60)

def api(path):
    for k in range(3):
        try:
            with req(f'{API}/{path}') as r: return json.loads(r.read())
        except Exception as e:
            if k == 2: raise
            time.sleep(1.5)

def norm(name): return re.sub(r'[^a-z0-9]', '', name.lower().rsplit('.', 1)[0])

def remote_size(url):
    """Size in bytes; 0 when the server does not say; -1 when the file is not there (404/403); None on a network error."""
    try:
        with req(url, 'HEAD') as r: return int(r.headers.get('Content-Length') or 0)
    except urllib.error.HTTPError as e: return -1 if e.code in (403, 404) else None
    except Exception: return None

def find_local(folder, fname, recursive=False):
    if not folder.exists(): return None
    it = folder.rglob('*.pdf') if recursive else folder.glob('*.pdf')
    return next((p for p in it if norm(p.name) == norm(fname)), None)

def fetch(url, dest, simulate=False):
    """-> 'nuevo' | 'actualizado' | 'igual' | 'conservado' | 'no disponible' | 'error: ...'. `dest` is the file to create or replace."""
    size = remote_size(url); time.sleep(PAUSE)
    if size == -1: return 'conservado' if dest.exists() else 'no disponible'        # the web no longer serves it (or never did): keep what we have
    if dest.exists():
        if size is None or size == 0 or dest.stat().st_size == size: return 'igual'
        action = 'actualizado'
    else: action = 'nuevo'
    if simulate: return action
    try:
        with req(url) as r: data = r.read()
        if not data.startswith(b'%PDF'): return 'error: la respuesta no es un PDF'
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix('.part'); tmp.write_bytes(data); tmp.replace(dest)
        time.sleep(PAUSE); return action
    except Exception as e:
        return f'error: {e}'

def season_id(year):
    ss = api('results/seasons')
    s = next((x for x in ss if (x['year'] == year if year else x.get('current'))), None)
    return (s['id'], s['year']) if s else (None, None)

def run(circuits=None, year=None, active_only=True, simulate=False, bundle=False, log=say):
    """Download for the given circuit ids (None = all configured). Returns {'nuevos': [...], 'actualizados': [...], 'iguales': n, 'errores': [...], 'eventos': [...]}."""
    out = {'nuevos': [], 'actualizados': [], 'iguales': 0, 'avisos': [], 'errores': [], 'eventos': []}
    sid_, yr = season_id(year)
    if not sid_: out['errores'].append(f'temporada {year} no encontrada'); return out
    events = {e['short_name']: e for e in api(f'results/events?seasonUuid={sid_}') if not e.get('test')}
    today = date.today()
    for circ in pipeline.CIRCUITS:
        if circuits and circ['id'] not in circuits: continue
        code = circ.get('api')
        ev = events.get(code)
        if not ev: log(f'· {circ["folder"]}: sin evento {code} en {yr}'); continue
        d0, d1 = date.fromisoformat(ev['date_start']), date.fromisoformat(ev['date_end'])
        if active_only and not (d0 - timedelta(days=1) <= today <= d1 + timedelta(days=1)):
            log(f'· {circ["folder"]}: {ev["name"]} ({d0} a {d1}) no esta en curso; usa --circuito {circ["id"]} para forzarlo'); continue
        cur_year = next((x['year'] for x in api('results/seasons') if x.get('current')), yr)
        base = pipeline.circuit_dir(circ) if yr == cur_year else pipeline.ROOT / 'HISTORICO' / str(yr) / circ['folder']      # other seasons never mix with the live folders
        out['eventos'].append(circ['id'])
        cats = api(f'results/categories?eventUuid={ev["id"]}')
        cat = next((c for c in cats if c['name'].startswith('MotoGP')), None)
        if not cat: log(f'· {circ["folder"]}: sin categoria MotoGP'); continue
        sessions = api(f'results/sessions?eventUuid={ev["id"]}&categoryUuid={cat["id"]}')
        log(f'· {circ["folder"]}: {ev["name"]} {yr} ({d0} a {d1}) · {sum(1 for s in sessions if s["status"] == "FINISHED")}/{len(sessions)} sesiones terminadas')
        schedule = []
        def record(res, label):
            if res in ('igual', 'conservado'):
                out['iguales'] += 1
                if res == 'conservado': out['avisos'].append(f'{label}: ya no esta en la web, se conserva el local')
            elif res == 'no disponible': out['avisos'].append(f'{label}: no disponible ahora en la web'); log(f'  . {label}: no disponible ahora en la web')
            elif res.startswith('error'): out['errores'].append(f'{label}: {res[7:]}'); log(f'  ! {label}: {res}')
            else: out['nuevos' if res == 'nuevo' else 'actualizados'].append(label); log(f'  {res:<11} {label}')
        for s in sessions:
            dirname = SID_DIR.get((s['type'], s.get('number')))
            if not dirname: continue
            schedule.append({'sid': SID_KEY[dirname], 'type': s['type'], 'number': s.get('number'), 'date': s['date'][:19], 'status': s['status'], 'condition': s.get('condition')})
            if s['status'] != 'FINISHED': continue
            for key, f in (s.get('session_files') or {}).items():
                url = (f or {}).get('url')
                if not url or (key in SKIP and not (bundle and key == 'session')): continue
                fname = url.rsplit('/', 1)[-1]
                local = find_local(base / dirname, fname) or base / dirname / fname
                record(fetch(url, local, simulate), f'{dirname}/{local.name}')
        # event-level reports: any folder of the circuit counts (Malasya keeps them in SPRINT/), new ones go to EVENTO/
        evdocs = [(f['url'], f['url'].rsplit('/', 1)[-1]) for f in (ev.get('event_files') or {}).values() if f and f.get('url') and f['url'].lower().endswith('circuitinformation.pdf')]
        evdocs += [(f'{FILES}/{yr}/{code}/MotoGP/{n}', n) for n in EVENT_DOCS]
        if any(x['status'] == 'FINISHED' or True for x in schedule):
            for url, fname in evdocs:
                local = find_local(base, fname, recursive=True) or base / 'EVENTO' / fname
                if remote_size(url) in (None, -1) and not local.exists(): continue                    # not published for this event (e.g. no Rider Statistics yet)
                record(fetch(url, local, simulate), f'{local.parent.name}/{local.name}')
        if not simulate:
            base.mkdir(parents=True, exist_ok=True)
            (base / 'evento.json').write_text(json.dumps({'event': code, 'year': yr, 'name': ev['name'], 'date_start': ev['date_start'], 'date_end': ev['date_end'],
                                                          'circuit': (ev.get('circuit') or {}).get('name'), 'sessions': schedule, 'updated': datetime.now().strftime('%Y-%m-%d %H:%M:%S')}, ensure_ascii=False, indent=1), encoding='utf8')
    return out

def main(argv):
    simulate, bundle, todos = '--simular' in argv, '--bundle' in argv, '--todos' in argv
    year = next((int(a) for i, a in enumerate(argv) if a.isdigit() and i > 0 and argv[i - 1] in ('--año', '--ano')), None)
    circ = next((argv[i + 1] for i, a in enumerate(argv) if a == '--circuito' and i + 1 < len(argv)), None)
    r = run([circ] if circ else None, year, active_only=not (circ or todos), simulate=simulate, bundle=bundle)
    say(f'Resumen: {len(r["nuevos"])} nuevos, {len(r["actualizados"])} actualizados, {r["iguales"]} sin cambios, {len(r["avisos"])} avisos, {len(r["errores"])} errores' + (' (simulacion: no se escribio nada)' if simulate else ''))
    if r['nuevos'] or r['actualizados']: say('Reconstruye con  python tools/actualizar.py  o pulsa F5 si el servidor esta en marcha.')
    return 1 if r['errores'] and not (r['nuevos'] or r['actualizados'] or r['iguales']) else 0

if __name__ == '__main__':
    sys.exit(main(sys.argv))
