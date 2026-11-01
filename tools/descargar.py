"""Descarga los PDF oficiales de cronometro de motogp.com (API publica) a <CIRCUITO>/<SESION>/ en vez de copiarlos a mano.

    python tools/descargar.py                    el evento en curso (de ayer a mañana de su fin de semana)
    python tools/descargar.py --circuito qatar   un circuito concreto (id de CIRCUITS en pipeline.py)
    python tools/descargar.py --todos            todos los circuitos configurados
    python tools/descargar.py --año 2025 --circuito malasya   otra temporada: va a HISTORICO/2025/MALASYA/ (nunca mezcla con la actual)
    python tools/descargar.py --simular          solo muestra que bajaria, sin escribir nada
    python tools/descargar.py --bundle           incluye tambien el Session.pdf completo (redundante, pesa mas)
    python tools/descargar.py --datos            solo los datos de la API (Mundial, estadisticas de pilotos, historico del circuito), sin PDF
    python tools/descargar.py --pdf              solo los PDF, sin datos de la API

Que hace:
  * busca el evento del circuito (campo 'api' de CIRCUITS, p. ej. MAL) y, de la categoria MotoGP, las sesiones terminadas;
  * baja cada informe que la API enlaza (Analysis, Classification, Grid, Lap Chart, Best Partial Time...) a su carpeta
    (FP1, PR, FP2, Q1, Q2, SPRINT, RACE) con el mismo nombre que usa la web;
  * baja tambien los informes del evento (Circuit Information, Entry, Rider Statistics, Event Maximum Speed) a <CIRCUITO>/EVENTO/;
  * y los de la pestaña «Championship Results» (Season Statistics, Nations, Riders Performance, Pole Positions, Podiums, Riders All Time) a <CIRCUITO>/CAMPEONATO/;
    la clasificacion del Mundial de cada sesion (worldstanding.pdf) va a la carpeta de la sesion;
  * si un PDF ya existe con el mismo tamaño lo salta; si cambio de tamaño (resultado provisional -> definitivo, Event Max Speed
    que crece con cada sesion...) lo sustituye. Un fichero equivalente con otro nombre (analysisbylap.pdf = AnalysisByLap.pdf) cuenta como existente;
  * guarda <CIRCUITO>/evento.json con el calendario (horas de cada sesion, entre ellas la de la Carrera);
  * recupera ademas datos que no vienen en PDF y los guarda en API/ (ver recuperar()):
      temporada.json       clasificacion del Mundial y calendario
      pilotos.json         estadisticas de temporada y carrera de cada piloto y su resultado en cada GP (da el historico en cada circuito)
      circuito_<COD>.json  ultimas ediciones del GP: podio, pole, vuelta rapida, condiciones, vueltas y record de pista
      estado.json          fecha y hora de la ultima recuperacion (la app la muestra siempre)

Los PDF son propiedad de MotoGP / Dorna: uso privado y sin sobrecargar el servicio (una peticion a la vez, con pausa).
"""
import json, re, sys, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor
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
SKIP = {'session'}                                          # el bundle completo (1 MB por sesion) solo se baja como respaldo o con --bundle
EVENT_DOCS = ['Entry.pdf', 'EntryBiographical.pdf', 'EventMaximumSpeed.pdf']        # en <año>/<EVT>/MotoGP/ (no los enlaza la API de sesiones)
# pestaña «Championship Results» de motogp.com -> (ruta bajo <año>/<EVT>/, nombre local en <CIRCUITO>/CAMPEONATO/). Unos cuelgan del evento y otros de MotoGP/.
CHAMP_DOCS = [('MotoGP/table1.pdf', 'SeasonStatistics.pdf'), ('table2.pdf', 'NationsStatistics.pdf'), ('MotoGP/RidersPerformance.pdf', 'RidersPerformance.pdf'),
              ('PolePositions.pdf', 'PolePositions.pdf'), ('Podiums.pdf', 'Podiums.pdf'), ('MotoGP/table5.pdf', 'RidersAllTime.pdf'), ('table4.pdf', 'RidersAllTimeAllClasses.pdf'),
              ('MotoGP/RookieOfTheYear.pdf', 'RookieOfTheYear.pdf')]          # el ultimo solo viene dentro del Session.pdf: se baja si algun dia lo publican suelto

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
            gaps = False                                                                   # the API lists reports the server does not have yet (they appear some hours after the session)
            for key, f in (s.get('session_files') or {}).items():
                url = (f or {}).get('url')
                if not url or (key in SKIP and not (bundle and key == 'session')): continue
                fname = url.rsplit('/', 1)[-1]
                local = find_local(base / dirname, fname) or base / dirname / fname
                res = fetch(url, local, simulate); record(res, f'{dirname}/{local.name}')
                gaps = gaps or (res == 'no disponible' and key != 'world_standing')
            sess_url = ((s.get('session_files') or {}).get('session') or {}).get('url')
            if gaps and sess_url and not bundle:                                          # the Session.pdf bundle already carries those reports (Lap Chart, Fastest Laps Sequence...)
                local = find_local(base / dirname, 'Session.pdf') or base / dirname / 'Session.pdf'
                log(f'  . {dirname}: faltan informes sueltos, se usa el Session.pdf completo como respaldo')
                record(fetch(sess_url, local, simulate), f'{dirname}/{local.name}')
        # event-level reports: any folder of the circuit counts (Malasya keeps them in SPRINT/), new ones go to EVENTO/
        evdocs = [(f['url'], f['url'].rsplit('/', 1)[-1]) for f in (ev.get('event_files') or {}).values() if f and f.get('url') and f['url'].lower().endswith('circuitinformation.pdf')]
        evdocs += [(f'{FILES}/{yr}/{code}/MotoGP/{n}', n) for n in EVENT_DOCS]
        if any(x['status'] == 'FINISHED' or True for x in schedule):
            for url, fname in evdocs:
                local = find_local(base, fname, recursive=True) or base / 'EVENTO' / fname
                if remote_size(url) in (None, -1) and not local.exists(): continue                    # not published for this event (e.g. no Rider Statistics yet)
                record(fetch(url, local, simulate), f'{local.parent.name}/{local.name}')
        # championship reports (season statistics, podiums, poles, rider performance...): archived in CAMPEONATO/, they are not part of the analysis
        for path, name in CHAMP_DOCS:
            url = f'{FILES}/{yr}/{code}/{path}'
            local = find_local(base, name, recursive=True) or base / 'CAMPEONATO' / name
            if remote_size(url) in (None, -1) and not local.exists(): continue
            record(fetch(url, local, simulate), f'{local.parent.name}/{local.name}')
        if not simulate:
            base.mkdir(parents=True, exist_ok=True)
            (base / 'evento.json').write_text(json.dumps({'event': code, 'year': yr, 'name': ev['name'], 'date_start': ev['date_start'], 'date_end': ev['date_end'],
                                                          'circuit': (ev.get('circuit') or {}).get('name'), 'sessions': schedule, 'updated': datetime.now().strftime('%Y-%m-%d %H:%M:%S')}, ensure_ascii=False, indent=1), encoding='utf8')
    return out

# ---------------------------------------------------------------- datos de la API (no PDF) -> API/*.json
API_DIR = pipeline.ROOT / 'API'
HIST_YEARS = 6                                           # ediciones anteriores del GP que se guardan

def jload(path, default):
    try: return json.loads(path.read_text(encoding='utf8'))
    except Exception: return default

def jsave(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(',', ':')), encoding='utf8')

def motogp_cat(event_id):
    return next((c for c in api(f'results/categories?eventUuid={event_id}') if c['name'].startswith('MotoGP')), None)

def rider_ref(c):
    r, t = c.get('rider') or {}, c.get('team') or {}
    return {'num': r.get('number'), 'name': r.get('full_name'), 'team': t.get('name'), 'cons': (c.get('constructor') or {}).get('name'), 'uuid': r.get('riders_api_uuid') or r.get('riders_id')}

def datos_temporada(sid_, yr, events, log):
    """Standings + calendar of the season, and the list of riders that have started this year (from the latest finished race)."""
    cal = [{'code': e['short_name'], 'name': e['name'], 'circuit': (e.get('circuit') or {}).get('name'), 'start': e['date_start'], 'end': e['date_end']} for e in events.values()]
    cal.sort(key=lambda x: x['start'])
    first = next((e for e in sorted(events.values(), key=lambda e: e['date_start'])), None)
    standings, riders = [], {}
    cat = motogp_cat(first['id']) if first else None
    if cat:
        for c in api(f'results/standings?seasonUuid={sid_}&categoryUuid={cat["id"]}')['classification']:
            ref = rider_ref(c)
            standings.append({**ref, 'pos': c['position'], 'points': c['points'], 'wins': c.get('race_wins'), 'podiums': c.get('podiums'), 'sprint_wins': c.get('sprint_wins'), 'sprint_podiums': c.get('sprint_podiums'), 'last': c.get('last_positions'), 'sprint_last': c.get('sprint_last_positions')})
    # the grid of the latest race: riders that raced one-off (substitutes) and left the championship are not interesting
    for e in sorted(events.values(), key=lambda e: e['date_start'], reverse=True):
        if date.fromisoformat(e['date_start']) > date.today(): continue
        c2 = motogp_cat(e['id']); ss = api(f'results/sessions?eventUuid={e["id"]}&categoryUuid={c2["id"]}') if c2 else []
        rac = next((x for x in ss if x['type'] == 'RAC' and x['status'] == 'FINISHED'), None)
        if rac:
            for c in api(f'results/session/{rac["id"]}/classification')['classification']:
                ref = rider_ref(c); riders[ref['uuid']] = ref
            break
    log(f'  . temporada {yr}: {len(standings)} pilotos en el Mundial, {len(riders)} con carrera, {len(cal)} GP')
    return {'year': yr, 'standings': standings, 'calendar': cal}, riders

def datos_piloto(ref):
    """Season/career statistics and the result of the rider in every GP of the last seasons (compact)."""
    st = api(f'sportsdata-gateway/riders/pulse/statistics?rider_id={ref["uuid"]}&show_career=true')
    ev = api(f'sportsdata-gateway/riders/pulse/event-stats?rider_id={ref["uuid"]}')
    events = []
    for key, v in ev.items():
        m = re.match(r'(\d{4}) MotoGP', key)
        if not m or int(m.group(1)) < date.today().year - HIST_YEARS: continue
        for e in v.get('events', []):
            sp, rc = e.get('SPR') or {}, e.get('RAC') or {}
            events.append({'y': int(m.group(1)), 'c': e['short_name'], 'd': (e.get('date_start') or '')[:10], 'q': e.get('qualifying_position'), 'g': e.get('grid_time'), 'pts': e.get('total_points'),
                           's': sp.get('position'), 'sp': sp.get('points'), 'r': rc.get('position'), 'rp': rc.get('points'), 'rt': rc.get('time'), 'ra': rc.get('average_speed'), 'rl': rc.get('total_laps'), 'gap': rc.get('gap_first')})
    career_motogp = next((v for k, v in st.items() if k.startswith('career_MotoGP')), None)
    return {**ref, 'season': st.get('season'), 'career': st.get('career'), 'career_motogp': career_motogp, 'events': events}

def session_cond(s):
    c = s.get('condition') or {}
    num = lambda v: int(re.sub(r'\D', '', v)) if v and re.search(r'\d', v) else None
    return {'track': c.get('track'), 'air': num(c.get('air')), 'ground': num(c.get('ground')), 'hum': num(c.get('humidity')), 'weather': c.get('weather')}

SES_KEY = {('FP', 1): 'FP1', ('PR', None): 'PR', ('FP', 2): 'FP2', ('Q', 1): 'Q1', ('Q', 2): 'Q2', ('SPR', None): 'SPR', ('WUP', None): 'WUP', ('RAC', None): 'RAC'}

def edition(ev, yr):
    """One past (or current) edition of a GP: winners, pole, fastest lap, conditions, laps."""
    cat = motogp_cat(ev['id'])
    if not cat: return None
    out = {'year': yr, 'code': ev['short_name'], 'name': ev['name'], 'start': ev['date_start'], 'end': ev['date_end'], 'cond': {}, 'laps': {}, 'final': date.fromisoformat(ev['date_end']) < date.today()}
    for s in api(f'results/sessions?eventUuid={ev["id"]}&categoryUuid={cat["id"]}'):
        key = SES_KEY.get((s['type'], s.get('number')))
        if not key or s['status'] != 'FINISHED': continue
        out['cond'][key] = session_cond(s)
        if key not in ('Q2', 'SPR', 'RAC', 'PR'): continue
        cl = api(f'results/session/{s["id"]}/classification'); rows = cl.get('classification') or []; time.sleep(PAUSE)
        if not rows: continue
        top = [{**{k: v for k, v in rider_ref(c).items() if k != 'uuid'}, 'time': c.get('time') or (c.get('best_lap') or {}).get('time'), 'gap': (c.get('gap') or {}).get('first'), 'speed': c.get('average_speed') or c.get('top_speed')} for c in rows[:3]]
        if key == 'Q2':
            out['pole'] = top[0]
            for r in cl.get('records') or []:
                if r.get('type') == 'recordLap' and r.get('bestLap'): out['record'] = {'name': (r.get('rider') or {}).get('full_name'), 'time': r['bestLap'].get('time'), 'speed': r.get('speed'), 'year': r.get('year')}
            sp = [c.get('top_speed') for c in rows if c.get('top_speed')]
            if sp: out['top_speed'] = max(sp)
        elif key == 'PR': out['pr_top'] = top[0]
        else:
            out['laps'][key] = max((c.get('total_laps') or 0 for c in rows), default=0)
            out['sprint' if key == 'SPR' else 'race'] = {'podium': top, 'finishers': sum(1 for c in rows if c.get('status') in ('INSTND', 'OUTSTND')), 'starters': len(rows)}
            for r in cl.get('records') or []:
                if r.get('type') == 'fastestLap' and r.get('bestLap'): out['sprint_fl' if key == 'SPR' else 'race_fl'] = {'name': (r.get('rider') or {}).get('full_name'), 'time': r['bestLap'].get('time'), 'speed': r.get('speed')}
    return out

def datos_circuito(circ, seasons, cur_events, log, simulate=False):
    """Last HIST_YEARS editions of the GP, cached: closed editions are never asked again."""
    code = circ.get('api'); path = API_DIR / f'circuito_{code}.json'
    old = jload(path, {'editions': []}); have = {e['year']: e for e in old['editions'] if e.get('final')}
    cur_ev = cur_events.get(code); cir_id = ((cur_ev or {}).get('circuit') or {}).get('legacy_id')
    editions = []
    for s in seasons[:HIST_YEARS + 1]:
        yr = s['year']
        if yr in have: editions.append(have[yr]); continue
        evs = cur_events if s.get('current') else {e['short_name']: e for e in api(f'results/events?seasonUuid={s["id"]}') if not e.get('test')}
        ev = evs.get(code)
        if not ev and cir_id: ev = next((e for e in evs.values() if (e.get('circuit') or {}).get('legacy_id') == cir_id), None)
        if not ev or date.fromisoformat(ev['date_start']) > date.today(): continue
        try: ed = edition(ev, yr)
        except Exception as e: log(f'  ! {code} {yr}: {e}'); continue
        if ed and ed['cond']: editions.append(ed); log(f'  . {code} {yr}: {((ed.get("race") or {}).get("podium") or [{}])[0].get("name", "sin carrera")}')
    editions.sort(key=lambda e: -e['year'])
    rec = next((e['record'] for e in editions if e.get('record')), None)
    out = {'code': code, 'circuit': ((cur_ev or {}).get('circuit') or {}).get('name'), 'record': rec, 'editions': editions}
    if not simulate: jsave(path, out)
    return out

def run_datos(circuits=None, simulate=False, log=say):
    """Standings, rider statistics and circuit history -> API/*.json. Returns a short summary."""
    seasons = api('results/seasons'); cur = next(s for s in seasons if s.get('current'))
    events = {e['short_name']: e for e in api(f'results/events?seasonUuid={cur["id"]}') if not e.get('test')}
    temp, riders = datos_temporada(cur['id'], cur['year'], events, log)
    old = jload(API_DIR / 'pilotos.json', {})
    pilotos = {}
    def one(ref):
        try: r = datos_piloto(ref)
        except Exception as e:
            log(f'  ! piloto {ref["name"]}: {e}'); r = old.get(str(ref['num']))
        time.sleep(PAUSE); return str(ref['num']), r
    with ThreadPoolExecutor(4) as ex:                              # 4 at a time: polite, and 3-4x faster than one by one
        for k, r in ex.map(one, riders.values()):
            if r: pilotos[k] = r
    log(f'  . {len(pilotos)} pilotos con estadisticas y resultados por GP')
    circ_out = {}
    for circ in pipeline.CIRCUITS:
        if circuits and circ['id'] not in circuits: continue
        if not circ.get('api'): continue
        log(f'· historico {circ["folder"]}')
        circ_out[circ['id']] = datos_circuito(circ, seasons, events, log, simulate)
    if not simulate:
        jsave(API_DIR / 'temporada.json', temp); jsave(API_DIR / 'pilotos.json', pilotos)
    return {'pilotos': len(pilotos), 'standings': len(temp['standings']), 'circuitos': {k: len(v['editions']) for k, v in circ_out.items()}}

def recuperar(circuits=None, year=None, active_only=False, simulate=False, bundle=False, pdf=True, datos=True, log=say):
    """PDFs + API data in one go, and stamp API/estado.json (the app shows it as «última actualización»)."""
    out = {'nuevos': [], 'actualizados': [], 'iguales': 0, 'avisos': [], 'errores': [], 'eventos': [], 'datos': None}
    if pdf: out.update(run(circuits, year, active_only, simulate, bundle, log))
    out.setdefault('datos', None)
    if datos and not year:
        try: out['datos'] = run_datos(circuits, simulate, log)
        except Exception as e: out['errores'].append(f'datos API: {e}'); log(f'  ! datos API: {e}')
    if not simulate and (out['datos'] or out['eventos']) and not year:
        est = jload(API_DIR / 'estado.json', {'circuitos': {}}); now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        est['actualizado'] = now
        for c in (circuits or [c['id'] for c in pipeline.CIRCUITS]): est.setdefault('circuitos', {})[c] = now
        est['resumen'] = {'nuevos': len(out['nuevos']), 'actualizados': len(out['actualizados']), 'errores': len(out['errores']), 'datos': out['datos']}
        jsave(API_DIR / 'estado.json', est)
    return out


def main(argv):
    simulate, bundle, todos = '--simular' in argv, '--bundle' in argv, '--todos' in argv
    year = next((int(a) for i, a in enumerate(argv) if a.isdigit() and i > 0 and argv[i - 1] in ('--año', '--ano')), None)
    circ = next((argv[i + 1] for i, a in enumerate(argv) if a == '--circuito' and i + 1 < len(argv)), None)
    only_pdf, only_datos = '--pdf' in argv, '--datos' in argv
    r = recuperar([circ] if circ else None, year, active_only=not (circ or todos), simulate=simulate, bundle=bundle, pdf=not only_datos, datos=not only_pdf)
    if r['datos']: say(f'Datos API: {r["datos"]["pilotos"]} pilotos, {r["datos"]["standings"]} en el Mundial, ediciones por circuito {r["datos"]["circuitos"]}')
    say(f'Resumen: {len(r["nuevos"])} nuevos, {len(r["actualizados"])} actualizados, {r["iguales"]} sin cambios, {len(r["avisos"])} avisos, {len(r["errores"])} errores' + (' (simulacion: no se escribio nada)' if simulate else ''))
    if r['nuevos'] or r['actualizados']: say('Reconstruye con  python tools/actualizar.py  o pulsa F5 si el servidor esta en marcha.')
    return 1 if r['errores'] and not (r['nuevos'] or r['actualizados'] or r['iguales']) else 0

if __name__ == '__main__':
    sys.exit(main(sys.argv))
