"""MotoGP telemetry pipeline.

Scans <CIRCUITO>/<sesión>/*.pdf for every circuit in CIRCUITS (official timing reports: Analysis, Classification, Best Partial
Times, Maximum Speed, Top Speed & Average, Fastest Laps Sequence, Grid, Qualifying Results, Lap Chart, ...), detects which session each one is (FP1, PR, FP2, Q1, Q2,
SPR, RAC), and builds index.html with ONE dataset per circuit:
  * a circuit becomes active as soon as its FP1 and PR Analysis PDFs exist (they anchor the simulation); until then it is "pending";
  * every session that has a real PDF uses the real laps;
  * every session without one uses a deterministic simulation (anchored on the real Friday pace);
  * the simulation of sessions that DO have real data is kept too, so the dashboard can compare sim vs real.

Run:  python tools/actualizar.py      (static rebuild)   |   python tools/servidor.py   (rebuild on every F5)
"""
import json, math, random, re, statistics as st, sys, time
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / 'tools'
import os
PDF_OVERRIDE = os.environ.get('MOTOGP_PDF_DIR')            # test hook: replaces the folder of the FIRST circuit
SESSION_DIRS = ['FP1', 'PR', 'FP2', 'Q1', 'Q2', 'SPRINT', 'RACE']      # inner folders prepared for every circuit
# One entry per circuit folder in the project root. Lap counts are only the defaults used while the Sprint/Race are simulated
# (a real Sprint/Race replaces them); lengths are the published track lengths. `salt` varies the seeded simulation per circuit.
CIRCUITS = [
    {'id': 'malasya', 'folder': 'MALASYA', 'flag': '🇲🇾', 'short': 'Sepang', 'name': 'Petronas Sepang International Circuit', 'gp': 'Gran Premio de Malasia',
     'length': 5.543, 'sprintLaps': 10, 'raceLaps': 20, 'record': {'t': 116.337, 'who': 'F. Bagnaia', 'year': 2024}, 'weather': None, 'salt': 0,
     'lat': 2.7608, 'lon': 101.7380, 'raceDate': '2026-11-01', 'raceHour': 15,
     'forecastUrl': 'https://weather.metoffice.gov.uk/forecast/w22rendfv#?date=2026-11-01',
     # Met Office page read on 2026-10-31 for Sunday 15:00 local: 33 C, 20% chance of rain, sunny, wind 6 mph; humidity only as a daily range (49-96%).
     # Track temperature and humidity at race time are estimates (track ~ air + 14 C under sun, as seen in PR/Sprint).
     'forecast': {'air': 33, 'rain': 20, 'hum': 60, 'ground': 47, 'sky': 'Soleado', 'src': 'Met Office (Sepang), domingo 15:00', 'estimated': ['ground', 'hum']}},
    {'id': 'mandalika', 'folder': 'MANDALIKA', 'flag': '🇮🇩', 'short': 'Mandalika', 'name': 'Pertamina Mandalika International Street Circuit', 'gp': 'Gran Premio de Indonesia',
     'length': 4.31, 'sprintLaps': 13, 'raceLaps': 27, 'record': None, 'weather': None, 'salt': 1, 'lat': -8.8967, 'lon': 116.3014, 'raceHour': 15},
    {'id': 'portimao', 'folder': 'PORTIMAO', 'flag': '🇵🇹', 'short': 'Portimão', 'name': 'Autódromo Internacional do Algarve', 'gp': 'Gran Premio de Portugal',
     'length': 4.592, 'sprintLaps': 12, 'raceLaps': 25, 'record': None, 'weather': None, 'salt': 2, 'lat': 37.2272, 'lon': -8.6267, 'raceHour': 14},
    {'id': 'qatar', 'folder': 'QATAR', 'flag': '🇶🇦', 'short': 'Lusail', 'name': 'Lusail International Circuit', 'gp': 'Gran Premio de Catar',
     'length': 5.38, 'sprintLaps': 11, 'raceLaps': 22, 'record': None, 'weather': None, 'salt': 3, 'lat': 25.4900, 'lon': 51.4542, 'raceHour': 19},
    {'id': 'valencia', 'folder': 'VALENCIA', 'flag': '🇪🇸', 'short': 'Valencia', 'name': 'Circuit Ricardo Tormo', 'gp': 'Gran Premio de la Comunitat Valenciana',
     'length': 4.005, 'sprintLaps': 13, 'raceLaps': 27, 'record': None, 'weather': None, 'salt': 4, 'lat': 39.4589, 'lon': -0.6310, 'raceHour': 14},
]
DEFAULT_CIRCUIT = 'malasya'
def circuit_dir(c): return Path(PDF_OVERRIDE) if PDF_OVERRIDE and c is CIRCUITS[0] else ROOT / c['folder']
def ensure_folders():
    """Prepare <CIRCUITO>/<sesión>/ (empty) for every circuit so the user only has to drop the PDFs in."""
    for c in CIRCUITS:
        if PDF_OVERRIDE and c is CIRCUITS[0]: continue
        for s in SESSION_DIRS: (circuit_dir(c) / s).mkdir(parents=True, exist_ok=True)
def all_pdfs(): return [p for c in CIRCUITS for p in circuit_dir(c).rglob('*.pdf')]
SIDS = ['FP1', 'PR', 'FP2', 'Q1', 'Q2', 'SPR', 'RAC']
SIM_SIDS = ['FP2', 'Q1', 'Q2', 'SPR', 'RAC']
SHORT = {93: 'M.MARQUEZ', 73: 'A.MARQUEZ', 63: 'BAGNAIA', 89: 'MARTIN', 37: 'ACOSTA', 72: 'BEZZECCHI', 79: 'OGURA', 49: 'DI GIANNANTONIO',
         21: 'MORBIDELLI', 33: 'BINDER', 23: 'BASTIANINI', 12: 'VIÑALES', 36: 'MIR', 5: 'ZARCO', 11: 'MOREIRA', 42: 'RINS', 27: 'LECUONA',
         43: 'MILLER', 10: 'MARINI', 20: 'QUARTARARO', 47: 'A.FERNANDEZ', 25: 'R.FERNANDEZ'}
FOLDER_SID = {'FP1': 'FP1', 'PR': 'PR', 'FP2': 'FP2', 'Q1': 'Q1', 'Q2': 'Q2', 'SPR': 'SPR', 'SPRINT': 'SPR', 'RAC': 'RAC', 'RACE': 'RAC', 'CARRERA': 'RAC'}
NATS = 'SPA|ITA|FRA|JPN|BRA|RSA|AUS|GBR|POR|GER|THA|TUR|ARG|MAL|INA|COL|CZE|FIN|NED|AUT|BEL|SUI|USA|CHN|IND|HUN'

def log(*a): print(*a, file=sys.stderr)

# =====================================================================================================
#  PDF parsing
# =====================================================================================================
def t2s(tok):
    m = re.fullmatch(r"(?:(\d+)')?(\d+)\.(\d{3})", tok)
    return None if not m else int(m.group(1) or 0) * 60 + int(m.group(2)) + int(m.group(3)) / 1000
def is_time(tok): return re.fullmatch(r"(?:\d+')?\d+\.\d{3}", tok) is not None
def is_speed(tok): return re.fullmatch(r"\d{3}\.\d", tok) is not None

def lines_of(words):
    words = sorted(words, key=lambda w: (round(w['top']), w['x0']))
    rows = []
    for w in words:
        if rows and abs(rows[-1][0] - w['top']) <= 3:
            rows[-1][1].append(w); rows[-1][0] = w['top']
        else:
            rows.append([w['top'], [w]])
    return [(t, sorted(ws, key=lambda w: w['x0'])) for t, ws in rows]

BIKES = 'DUCATI|APRILIA|KTM|HONDA|YAMAHA'
DOC_KINDS = ['analysis', 'class', 'best', 'maxspd', 'avgspd', 'fast']                       # the six reports every session has (pending-circuit cards count these)
EVENT_KINDS = ['entry', 'bio', 'circuit', 'evtspd']                                          # event-level reports (not tied to one session, any folder)
EXTRA_KINDS = ['grid', 'qres', 'comb', 'fastrider', 'lapchart', 'bylap']                   # reports that only some sessions have
DOC_LABEL = {'analysis': 'Analysis', 'class': 'Classification', 'best': 'Best Partial Times', 'maxspd': 'Maximum Speed', 'avgspd': 'Top Speed & Average', 'fast': 'Fastest Laps Sequence',
             'grid': 'Starting Grid', 'qres': 'Qualifying Results', 'comb': 'Combined Practice Times', 'fastrider': 'Fastest Lap of each Rider', 'lapchart': 'Lap Chart', 'bylap': 'Analysis by Lap',
             'entry': 'Entry List', 'bio': 'Rider Statistics (Biographical)', 'circuit': 'Circuit Information', 'evtspd': 'Event Best Maximum Speed'}
IGNORED_TITLES = ('WORLD CHAMPIONSHIP', 'QUALIFYING SESSION ENTRY', 'AWARD')               # bundle pages that carry no timing data we use
TITLE_KINDS = (('EVENT BEST MAXIMUM SPEED', 'evtspd'), ('CIRCUIT INFORMATION', 'circuit'), ('RIDER STATISTICS', 'bio'), ('ENTRY LIST', 'entry'), ('CHRONOLOGICAL ANALYSIS', 'analysis'), ('ANALYSIS BY LAP', 'bylap'), ('BEST PARTIAL', 'best'), ('TOP SPEED & AVERAGE', 'avgspd'), ('TOP SPEED AND AVERAGE', 'avgspd'),
               ('TOP SPEED', 'maxspd'), ('MAXIMUM SPEED', 'maxspd'), ('FASTEST LAP OF EACH', 'fastrider'), ('FASTEST LAP', 'fast'), ('STARTING GRID', 'grid'),
               ('QUALIFYING RESULTS', 'qres'), ('COMBINED PRACTICE', 'comb'), ('LAP CHART', 'lapchart'), ('CLASSIFICATION', 'class'))

def detect_text(txt):
    """Title of ONE page -> (sid, kind). kind None when the page is not a recognised report (or is an analysis continuation page)."""
    up = (txt or '').upper()
    if 'GRAND PRIX' not in up: return None, None
    first = next((l.strip() for l in up.split(chr(10)) if l.strip()), '')
    if any(k in first for k in IGNORED_TITLES): return None, None
    kind = next((k for key, k in TITLE_KINDS if key in first), None)
    if kind is None: return None, None
    lines = [l.strip() for l in up.split(chr(10)) if l.strip()]
    gi = next((i for i, l in enumerate(lines) if 'GRAND PRIX' in l), 0)
    title = ' '.join(lines[gi + 1: gi + 4])
    sid = None
    m = re.search(r'FREE PRACTICE\s*(?:NR\.?)?\s*(\d)', title)
    if m: sid = 'FP' + m.group(1)
    elif re.search(r'(?:QUALIFYING|Q)\s*(?:NR\.?)?\s*([12])\b', title): sid = 'Q' + re.search(r'(?:QUALIFYING|Q)\s*(?:NR\.?)?\s*([12])\b', title).group(1)
    elif 'SPRINT' in title or ('SPRINT' in first and kind == 'grid'): sid = 'SPR'
    elif re.search(r'\bRACE\b', title) and 'WARM' not in title: sid = 'RAC'
    elif 'PRACTICE' in title: sid = 'PR'
    if kind == 'grid': sid = 'SPR' if 'SPRINT' in first else 'RAC'            # a starting grid belongs to the race it starts, whatever folder it sits in
    elif kind == 'qres': sid = 'Q2'
    elif kind in EVENT_KINDS: sid = 'EVT'
    return sid, kind

def sections(path):
    """Split a PDF into report sections. A multi-report bundle ("Session.pdf") yields several; the
    unnumbered continuation pages of an Analysis stay attached to it."""
    out, cur = [], None
    try:
        pdf = pdfplumber.open(path)
        for i, pg in enumerate(pdf.pages):
            txt = pg.extract_text() or ''
            sid, kind = detect_text(txt)
            if kind and cur and kind == 'class' and cur['kind'] == 'class' and cur['sid'] == sid and cur['pages'][-1] == i - 1:
                cur['pages'].append(i); cur['texts'][i] = txt                     # Sprint/Race classification spans 2 pages (results + conditions/incidents)
            elif kind:
                cur = {'sid': sid, 'kind': kind, 'path': path, 'pages': [i], 'texts': {i: txt}}; out.append(cur)
            elif cur and cur['kind'] == 'analysis' and re.search(r'Lap\s+Lap Time\s+T1', txt):
                cur['pages'].append(i); cur['texts'][i] = txt
            elif cur and cur['kind'] == 'bio' and txt.lstrip().startswith('Rider Date'):
                cur['pages'].append(i); cur['texts'][i] = txt
            else:
                cur = cur if (cur and cur['kind'] != 'analysis') else None
    except Exception as e:
        log('  ! no se pudo leer', path.name, e)
    fm = re.match(r'^(FP1|FP2|PR|Q1|Q2|SPR|RAC)[_\-]', path.name)          # explicit override: "FP2_analysis.pdf"
    folder = FOLDER_SID.get(path.parent.name.upper())                        # MALASYA/<sesión>/...
    for s in out:
        if fm: s['sid'] = fm.group(1)
        elif folder and s['kind'] != 'grid' and s['kind'] not in EVENT_KINDS: s['sid'] = folder
    return out

def scan_pdfs(pdf_dir):
    """-> {sid: {kind: section}} . Standalone files beat the "Session" bundle; newer beats older."""
    cand = {}
    for p in sorted(pdf_dir.rglob('*.pdf'), key=lambda p: p.stat().st_mtime):
        secs = sections(p)
        if not secs: log('  · ignorado:', p.relative_to(pdf_dir)); continue
        for s in secs:
            s['root'] = pdf_dir
            if not s['sid']: log('  · sesión no reconocida en', p.relative_to(pdf_dir), s['kind']); continue
            s['bundle'] = p.stem.lower() == 'session' and len(secs) > 1
            key = (s['sid'], s['kind'])
            if key not in cand or (cand[key]['bundle'] and not s['bundle']) or (cand[key]['bundle'] == s['bundle']): cand[key] = s
    found = {}
    for (sid, kind), s in cand.items(): found.setdefault(sid, {})[kind] = s
    return found

# ---------------------------------------------------------------------------------------------- parsers
def parse_analysis(sec):
    riders, cur, run = {}, None, None
    pdf = pdfplumber.open(sec['path'])
    for pi in sec['pages']:
        pg = pdf.pages[pi]
        ws = [w for w in pg.extract_words() if (185 if pi == sec['pages'][0] else 62) < w['top'] < 725]
        for col in (0, 1):
            cw = [w for w in ws if (w['x0'] < 300) == (col == 0)]
            hdr = [w for w in cw if re.fullmatch(r"\d+(st|nd|rd|th)", w['text']) and w['x0'] < (60 if col == 0 else 345)]
            events = []
            for h in hdr:
                nxt = sorted([w for w in cw if abs(w['top'] - h['top']) < 3 and w['x0'] > h['x0'] and w['text'].isdigit()], key=lambda w: w['x0'])
                if nxt: events.append((h['top'], h['text'], int(nxt[0]['text']), [id(h), id(nxt[0])]))
            skip = set(i for e in events for i in e[3])
            cw = [w for w in cw if id(w) not in skip]
            L = [(t, 'L', lw) for t, lw in lines_of(cw)] + [(e[0], 'H', e) for e in events]
            L.sort(key=lambda x: x[0] - (0.5 if x[1] == 'H' else 0))
            for top, kind, lw in L:
                if kind == 'H':
                    cur = lw[2]; riders.setdefault(cur, {'num': cur, 'laps': []})
                    run = {'run': 1, 'f': None, 'r': None, 'new': False}      # default run (races have a single stint)
                    continue
                toks = []
                for w in lw:
                    t_ = w['text']
                    toks += [t_[:-1], '*'] if len(t_) > 1 and t_.endswith('*') else [t_]
                s = ' '.join(toks)
                if s.startswith('Fastest'): continue
                if toks[0] != 'Run' and 'Tyre' in toks and 'New' in toks and run is not None:
                    run['new'] = True; i = toks.index('New'); toks = toks[:i] + toks[i + 2:]
                if 'start' in toks and 'at' in toks:
                    toks = [t for t in toks if not (re.fullmatch(r"\d*Laps", t) or t in ('at', 'start'))]
                if not toks or cur is None: continue
                s = ' '.join(toks)
                if toks[0] == 'Run' and '#' in toks:
                    try:
                        fr = toks[toks.index('Front') + 2]; rr = toks[toks.index('Rear') + 2]
                    except Exception: fr = rr = None
                    run = {'run': int(toks[toks.index('#') + 1]), 'f': fr, 'r': rr, 'new': False}; continue
                if s.startswith('New Tyre') and run is not None:
                    run['new'] = True; continue
                if toks[0].isdigit() and len(toks) >= 6 and is_time(toks[1]) and run is not None:
                    pit = canc = False; secs, flags, speed = [], [], None
                    for x in toks[2:]:
                        if x == 'P': pit = True
                        elif x == '*':
                            if not secs: canc = True
                            else: flags[-1] = True
                        elif is_speed(x): speed = float(x)
                        elif is_time(x): secs.append(t2s(x)); flags.append(False)
                    if len(secs) != 4: continue
                    riders[cur]['laps'].append({'n': int(toks[0]), 'run': run['run'], 't': round(t2s(toks[1]), 3), 's': [round(v, 3) for v in secs], 'v': speed,
                                                'x': 1 if canc else 0, 'p': 1 if pit else 0, 'sx': [1 if f else 0 for f in flags],
                                                'f': (run['f'] or '').replace('Slick-', ''), 'r': (run['r'] or '').replace('Slick-', ''), 'nw': 1 if run['new'] else 0})
    return riders

def sec_text(sec): return '\n'.join(sec['texts'].get(i, '') for i in sec['pages'])

def parse_class_text(txt):
    """Classification of a session. Practice/qualifying rows carry best time + gaps; Sprint/Race rows carry total time / gap."""
    res, nc = {}, 0
    rx = re.compile(r"^(\d+)\s+(?:(\d+)\s+)?(\d+)\s+(.+?)\s+(%s)\s+(.+)\s+(%s)\s+(.*)$" % (NATS, BIKES))          # pos [pts] # rider ...
    rxnc = re.compile(r"^(\d+)\s+([^\d].*?)\s+(%s)\s+(.+)\s+(%s)\s+(.*)$" % (NATS, BIKES))                       # "Not classified" rows: no position
    for ln in txt.split('\n'):
        m = rx.match(ln)
        if m:
            pos, pts, num, name, nat, team, bike, tail = m.groups()
            rec = {'pos': int(pos), 'num': int(num), 'name': name, 'nat': nat, 'team': team, 'bike': bike}
            if pts: rec['pts'] = int(pts)
        else:
            m = rxnc.match(ln)
            if not m: continue
            num, name, nat, team, bike, tail = m.groups(); nc += 1
            rec = {'pos': 90 + nc, 'num': int(num), 'name': name, 'nat': nat, 'team': team, 'bike': bike, 'nc': True}
        toks = tail.split()
        if len(toks) >= 3 and re.fullmatch(r"\d+'\d+\.\d{3}", toks[0]) and toks[1].isdigit() and toks[2].isdigit():
            rec.update(best=t2s(toks[0]), bestLap=int(toks[1]), laps=int(toks[2]))
            fl = [float(x) for x in toks[3:] if re.fullmatch(r"\d+\.\d+", x)]
            if toks[3:] and is_speed(toks[-1]): rec['vmax'] = float(toks[-1]); fl = fl[:-1]
            if len(fl) >= 1: rec['gap'] = fl[0]
            if len(fl) >= 2: rec['gapPrev'] = fl[1]
        else:
            tt = [x for x in toks if re.fullmatch(r"\+?\d+'?\d*\.\d{3}", x)]
            if toks and is_speed(toks[-1]): rec['vmax'] = float(toks[-1])
            if tt:
                if "'" in tt[0] and not tt[0].startswith('+'):
                    rec['time'] = t2s(tt[0])
                    if len(tt) > 1: rec['gap'] = t2s(tt[1].lstrip('+'))
                else: rec['gap'] = t2s(tt[0].lstrip('+'))
            lp = re.search(r"(\d+)\s+[Ll]aps?", tail)
            if lp: rec['lapsDown'] = int(lp.group(1))
        res[int(num)] = rec
    return res

def norm_abbr(s): return re.sub(r'[^A-Z.]', '', s.upper())

def build_abbr(riders_meta):
    """"M.MARQUEZ" / "F.DI GIANNANT" (truncated) -> rider number."""
    full = {}
    for n, m in riders_meta.items():
        parts = m['name'].split()
        first, sur = parts[0], ' '.join(p for p in parts[1:])
        full[n] = norm_abbr(first[0] + '.' + sur)
    def lookup(ab):
        a = norm_abbr(ab)
        c = [n for n, f in full.items() if f.startswith(a) or a.startswith(f)]
        if len(c) == 1: return c[0]
        c = [n for n, f in full.items() if f == a]
        return c[0] if len(c) == 1 else None
    return lookup

def parse_best(txt, lookup):
    """Best Partial Times -> {num: {it, bt, sec:[T1..T4]}} (official ideal lap, best lap and best partials)."""
    out = {}
    rx = re.compile(r"^(\d+)\s+(.+?)\s+(\d+\.\d{3})\s+(.+?)\s+(\d+\.\d{3})\s+(.+?)\s+(\d+\.\d{3})\s+(.+?)\s+(\d+\.\d{3})\s+(\d+)\s+(.+?)\s+(\d+'\d+\.\d{3})\s+(\d+'\d+\.\d{3})\s+\((\d+)\)\s*$")
    for ln in txt.split('\n'):
        m = rx.match(ln.strip())
        if not m: continue
        g = m.groups()
        for k in range(4):
            n = lookup(g[1 + 2 * k]);
            if n is not None: out.setdefault(n, {'sec': [None] * 4})['sec'][k] = float(g[2 + 2 * k])
        n = lookup(g[10])
        if n is not None: out.setdefault(n, {'sec': [None] * 4}).update(it=t2s(g[11]), bt=t2s(g[12]))
    return out

def parse_maxspd(txt):
    out = {}
    for ln in txt.split('\n'):
        m = re.match(r"^(\d+)\s+.+?\s+(%s)\s+.+?\s+(%s)\s+(\d{3}\.\d)\s*$" % (NATS, BIKES), ln.strip())
        if m: out[int(m.group(1))] = float(m.group(4))
    return out

def parse_avgspd(txt):
    out = {}
    for ln in txt.split('\n'):
        m = re.match(r"^(\d+)\s+.+?\s+(%s)\s+(%s)\s+((?:\d{3}\.\d\s*)+)$" % (NATS, BIKES), ln.strip())
        if m:
            v = [float(x) for x in m.group(4).split()]
            if len(v) >= 3: out[int(m.group(1))] = {'top5': v[:-2], 'avg': v[-2], 'max': v[-1]}
    return out

def parse_fast(txt):
    out = []
    for ln in txt.split('\n'):
        m = re.match(r"^(\d+'\d+\.\d{3})\s+(\d+)\s+.+?\s+(%s)\s+(%s)\s+(\d+'\d+\.\d{3})\s+(\d+\.\d)\s+(\d+)\s*$" % (NATS, BIKES), ln.strip())
        if m: out.append({'at': t2s(m.group(1)), 'num': int(m.group(2)), 't': t2s(m.group(5)), 'kmh': float(m.group(6)), 'lap': int(m.group(7))})
    return out

def parse_cond(txt):
    """Track conditions printed under a classification -> {cond: 'Dry', air, hum, ground} (empty when the page has none)."""
    c = {}
    m = re.search(r"condition:\s*([A-Za-z]+)", txt)
    if m: c['cond'] = m.group(1).capitalize()
    for k, rx in (('air', r"Air:\s*(\d+)"), ('hum', r"Humidity:\s*(\d+)"), ('ground', r"Ground:\s*(\d+)")):
        m = re.search(rx, txt)
        if m: c[k] = int(m.group(1))
    return c

def hms(tok):
    m = re.fullmatch(r"(\d+):(\d+)'(\d+)", tok)
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3)) if m else None

def parse_events(txt, names):
    """Race-control timeline under a Sprint/Race classification (crashes, pit entries, retirements, ...) -> [{t, at, text, num, kind}]."""
    out = []
    for ln in txt.split('\n'):
        m = re.match(r"^(\d+:\d+'\d+)\s+(.+)$", ln.strip())
        if not m: continue
        text = m.group(2); low = text.lower()
        num = next((n for n, nm in names.items() if text.startswith(nm)), None)
        kind = ('crash' if 'crashed' in low else 'retire' if 'retired' in low else 'pit' if 'entered pits' in low else 'rejoin' if 're-joined' in low
                else 'penalty' if any(k in low for k in ('penalty', 'long lap', 'ride through', 'sanction', 'jump start', 'time penalty')) and 'no jump' not in low else 'info')
        out.append({'t': hms(m.group(1)), 'at': m.group(1), 'text': text, 'num': num, 'kind': kind})
    return out

def parse_grid(txt, names):
    """Starting grid -> {order: [numbers by grid slot], laps, times: {num: qualifying time}}. The page is a staggered 3-column drawing, so rows are
    read in text order (checked against the Lap Chart / qualifying times by the caller)."""
    hits = []
    for n, nm in names.items():
        m = re.search(r"(?<!\d)%d %s" % (n, re.escape(nm)), txt)
        if m: hits.append((m.start(), n))
    order = [n for _, n in sorted(hits)]
    times = re.findall(r"\d+'\d+\.\d{3}", txt)
    lp = re.search(r"(\d+)\s+LAPS", txt.upper())
    g = {'order': order, 'laps': int(lp.group(1)) if lp else None}
    if len(times) == len(order): g['times'] = {n: t2s(t) for n, t in zip(order, times)}
    return g

def parse_qres(txt):
    """Qualifying Results -> {num: {pos, q: 'Q1'|'Q2' (session of the best lap), best, lap, total, vmax}} (overall order, Q2 riders first)."""
    out = {}
    rx = re.compile(r"^(\d+)\s+(\d+)\s+(.+?)\s+(%s)\s+(.+)\s+(%s)\s+(Q[12])\s+(\d+'\d+\.\d{3})\s+(\d+)\s+(\d+)\s+(.*)$" % (NATS, BIKES))
    for ln in txt.split('\n'):
        m = rx.match(ln.strip())
        if not m: continue
        pos, num, name, nat, team, bike, q, t, lap, tot, tail = m.groups(); toks = tail.split()
        out[int(num)] = {'pos': int(pos), 'q': q, 'best': t2s(t), 'lap': int(lap), 'total': int(tot), 'vmax': float(toks[-1]) if toks and is_speed(toks[-1]) else None}
    return out

def parse_comb(txt):
    """Combined Practice Times -> {num: {times: [(best, lap), ...], gap}} (FP1 and FP2 bests, in column order)."""
    out = {}
    rx = re.compile(r"^(\d+)\s+(\d+)\s+.+?\s+(%s)\s+.+\s+(%s)\s+(.*)$" % (NATS, BIKES))
    for ln in txt.split('\n'):
        m = rx.match(ln.strip())
        if not m: continue
        pos, num, nat, bike, tail = m.groups(); toks = tail.split(); ts = []
        while len(toks) >= 2 and re.fullmatch(r"\d+'\d+\.\d{3}", toks[0]) and toks[1].isdigit():
            ts.append([t2s(toks[0]), int(toks[1])]); toks = toks[2:]
        gaps = [float(x) for x in toks if re.fullmatch(r"\d+\.\d{3}", x)]
        out[int(num)] = {'pos': int(pos), 'times': ts, 'gap': gaps[0] if gaps else 0.0}
    return out

def parse_lapchart(txt):
    """Lap Chart -> {grid: [nums by slot], laps: [[nums by position after lap k]]}."""
    grid, laps = None, []
    for ln in txt.split('\n'):
        m = re.match(r"^(Grid|\d+)\s+((?:\d+\s*)+)$", ln.strip())
        if not m: continue
        nums = [int(x) for x in m.group(2).split()]
        if m.group(1) == 'Grid': grid = nums
        else: laps.append((int(m.group(1)), nums))
    laps.sort(key=lambda x: x[0])
    return {'grid': grid, 'laps': [n for _, n in laps]}

SESS_NAMES = {'free practice nr. 1': 'FP1', 'free practice nr. 2': 'FP2', 'practice': 'PR', 'qualifying nr. 1': 'Q1', 'qualifying nr. 2': 'Q2', 'tissot sprint': 'SPR', 'race': 'RAC'}

def parse_entry(txt):
    """Entry List -> {num: {surname, first, abbr, nat, team, bike, flag: ''|'r'|'W'|'R', replaces}}. r = rookie, W = wildcard, R(n) = substitute of rider n."""
    out = {}
    rx = re.compile(r"^(?:(r|W|R\((\d+)\))\s+)?(\d+)\s+(.+?)\s+\((\S+)\)\s+(%s)\s+(.+)\s+(%s)$" % (NATS, BIKES))
    for ln in txt.split('\n'):
        m = rx.match(ln.strip())
        if not m: continue
        fl, rep_, num, nm, ab, nat, team, bike = m.groups()
        parts = nm.split(); k = next((i for i, w in enumerate(parts) if not w.isupper() and w.upper() != w), len(parts))
        out[int(num)] = {'surname': ' '.join(parts[:k]), 'first': ' '.join(parts[k:]), 'abbr': ab, 'nat': nat, 'team': team, 'bike': bike,
                         'flag': ('R' if fl and fl.startswith('R(') else fl) or '', 'replaces': int(rep_) if rep_ else None}
    return out

BIO_COLS = {'starts': 346.5, 'wins': 373, 'poles': 399, 'fast': 429.5, 'pod': 465, 'bf': 500, 'bg': 528, 'titles': 581, 'wc25': 733.5, 'race25': 761.5, 'grid25': 785.5}

def parse_bio(sec):
    """Rider Statistics -> {num: {age, starts, wins, poles, fast, pod, bf, bg, titles, wc25, race25, grid25}} for the MotoGP row of each rider
    (career figures; wc25 = 2025 championship position, race25/grid25 = result / grid at THIS circuit in 2025). Columns are read by x position
    because empty cells are blank."""
    out = {}
    pdf = pdfplumber.open(sec['path'])
    for pi in sec['pages']:
        ws = [w for w in pdf.pages[pi].extract_words() if 40 < w['top'] < 760]
        for top, l in lines_of(ws):
            m = re.match(r"^(\d+)([A-Z]\.\S.*)$", l[0]['text'])
            if not m or not any(w['text'] == 'MotoGP' for w in l): continue
            rec = {}
            for w in l:
                c = (w['x0'] + w['x1']) / 2
                if 214 < w['x0'] < 230 and w['text'].isdigit(): rec['age'] = int(w['text'])
                if 330 < w['x0'] < 620 or w['x0'] >= 720:
                    col = min(BIO_COLS, key=lambda k: abs(BIO_COLS[k] - c))
                    if abs(BIO_COLS[col] - c) < 14 and col not in rec and re.fullmatch(r"\d+|'\d+(,'\d+)*", w['text']): rec[col] = int(w['text']) if w['text'].isdigit() else w['text']
            out[int(m.group(1))] = rec
    return out

def parse_evtspd(txt):
    """Event Best Maximum Speed -> {num: {kmh, sid}} (best top speed of each rider over the weekend and the session where it happened)."""
    out = {}
    for ln in txt.split('\n'):
        m = re.match(r"^(\d+)\s+.+?\s+(%s)\s+.+\s+(%s)\s+(\d{3}\.\d)\s+(.+)$" % (NATS, BIKES), ln.strip())
        if m: out[int(m.group(1))] = {'kmh': float(m.group(4)), 'sid': SESS_NAMES.get(m.group(5).strip().lower())}
    return out

def parse_circuit(txt):
    """Circuit Information -> geometry + MotoGP records and last year's references."""
    def lap(rx, t=txt):
        m = re.search(rx + r"\s+(\d{4})?\s*([A-Za-z\u00c0-\u00ff' .-]+?)\s+\((\w{3})\)\s+(\w+)\s+(\d+'\d+\.\d{3})\s+(\d+\.\d)", t)
        return m
    head = txt.split('Moto2 All-Time')[0]
    info = {}
    for key, rx in (('width', r"Width\s+(\d+)"), ('right', r"Right corners\s+(\d+)"), ('left', r"Left corners\s+(\d+)"), ('straight', r"Longest straight\s+(\d+)"), ('built', r"Constructed\s+(\d{4})")):
        m = re.search(rx, txt)
        if m: info[key] = int(m.group(1))
    m = re.search(r"Pole position\s+(Left|Right)", txt)
    if m: info['poleSide'] = m.group(1)
    recs = {}
    for key, label in (('lap', 'All-Time Lap Record'), ('race', 'Best Race Lap'), ('pole', 'Best Pole')):
        m = re.search(label + r"\s+(\d{4})\s+(.+?)\s+\((\w{3})\)\s+(\w+)\s+(\d+'\d+\.\d{3})\s+(\d+\.\d)", head)
        if m: recs[key] = {'year': int(m.group(1)), 'who': m.group(2), 'bike': m.group(4), 't': t2s(m.group(5)), 'kmh': float(m.group(6))}
    m = re.search(r"Top Speed\s+(\d{4})\s+(.+?)\s+\((\w{3})\)\s+(\w+)\s+(\d{3}\.\d)", head)
    if m: recs['vmax'] = {'year': m.group(1) and int(m.group(1)), 'who': m.group(2), 'bike': m.group(4), 'kmh': float(m.group(5))}
    y25 = {}
    tail = txt.split('2025 Info')[1].split('Moto2')[0] if '2025 Info' in txt else ''
    for key, label in (('bestLap', 'MotoGP Best Lap'), ('raceLap', 'Race fastest lap'), ('pole', 'Pole position')):
        m = re.search(label + r"\s+(.+?)\s+\((\w{3})\)\s+(\w+)\s+(\d+'\d+\.\d{3})\s+(\d+\.\d)", tail)
        if m: y25[key] = {'who': m.group(1), 't': t2s(m.group(4)), 'kmh': float(m.group(5))}
    m = re.search(r"Top Speed\s+(.+?)\s+\((\w{3})\)\s+(\w+)\s+(\d{3}\.\d)", tail)
    if m: y25['vmax'] = {'who': m.group(1), 'kmh': float(m.group(4))}
    pod = re.findall(r"\b([123])\.\s*([A-Za-z ]+?)\s*\(\w{3}\)", tail)
    seen = {}
    for pos, who in pod:
        seen.setdefault(int(pos), who.strip())
    if len(seen) == 3: y25['podium'] = [seen[1], seen[2], seen[3]]
    ln = re.search(r"Length\s+([\d,]+)\s*m", txt)
    if ln: info['lengthM'] = int(ln.group(1).replace(',', ''))
    return {'info': info, 'records': recs, 'y25': y25}

# =====================================================================================================
#  Helpers on compact laps
# =====================================================================================================
def clean_flying(laps):
    out, prev = [], None
    for l in laps:
        first = l['run'] != prev; prev = l['run']
        if first or l['p'] or l['x']: continue
        out.append(l)
    return out

def sector_best(laps):
    b, prev = [None] * 4, None
    for l in laps:
        first = l['run'] != prev; prev = l['run']
        if first or l['p'] or l['x']: continue
        for i in range(4):
            if l['sx'][i]: continue
            if b[i] is None or l['s'][i] < b[i]: b[i] = l['s'][i]
    return b

def order_from_laps(laps_by_num):
    best = {}
    for n, laps in laps_by_num.items():
        fl = clean_flying(laps)
        if fl: best[n] = min(l['t'] for l in fl)
    return sorted(best, key=lambda n: best[n])

def results_from_laps(laps_by_num):
    """Race classification computed from lap sums: more laps first, then lower cumulative time. DNF = >1 lap down."""
    rows = []
    for n, laps in laps_by_num.items():
        if laps: rows.append((n, len(laps), round(sum(l['t'] for l in laps), 3)))
    if not rows: return [], 0
    nl = max(r[1] for r in rows)
    rows.sort(key=lambda r: (-r[1], r[2]))
    win = next(r for r in rows if r[1] == nl)[2]
    res = []
    for i, (n, k, t) in enumerate(rows):
        fin = k >= nl - 1
        res.append({'pos': i + 1, 'num': n, 'time': t if fin else None, 'gap': round(t - win, 3) if fin and k == nl else None, 'laps': k, 'status': 'FIN' if fin else 'DNF'})
    return res, nl

# =====================================================================================================
#  Simulation (deterministic, independent per session)
# =====================================================================================================
class Sim:
    COMP = {'S': (-0.10, 1.45), 'M': (0.0, 1.0), 'H': (0.14, 0.72)}
    SAT_EVO = -0.30

    def __init__(self, nums, fri, salt=0):
        self.nums, self.fri, self.base = nums, fri, 20261030 + salt
        self.race_shift = 0.0          # extra s/lap on simulated race pace (calibrated from a real Sprint of the same circuit, see build_circuit)
        self.rng = random.Random(self.base)
        real = {n: [] for n in nums}
        self.prof = {}
        meta_best = {}
        fp1b = {n: sector_best(fri['FP1'].get(n, [])) for n in nums}
        prb = {n: sector_best(fri['PR'].get(n, [])) for n in nums}
        pair = [n for n in nums if None not in fp1b[n] and None not in prb[n]]
        delta = [st.median([fp1b[n][i] - prb[n][i] for n in pair]) for i in range(4)] if pair else [1.0] * 4
        for n in nums:
            sec = []
            for i in range(4):
                c = []
                if prb[n][i] is not None: c.append(prb[n][i])
                if fp1b[n][i] is not None: c.append(fp1b[n][i] - delta[i])
                sec.append(min(c) if c else 29.0)
            allv = [l['v'] or 0 for k in ('FP1', 'PR') for l in fri[k].get(n, [])] or [334]
            self.prof[n] = {'sec': sec, 'ideal': sum(sec), 'vmax': max(allv) or 334.0, 'npr': len(clean_flying(fri['PR'].get(n, [])))}
        g = self.rng.gauss; u = self.rng.uniform
        for n in nums:                       # hidden "true form" -> predictions are never perfect
            p = self.prof[n]; unc = 0.10 + (0.35 if p['npr'] < 6 else 0)
            p['fq'] = g(0, unc); p['fr'] = 0.5 * p['fq'] + g(0, 0.12); p['deg'] = u(0.014, 0.05); p['cons'] = u(0.06, 0.16)
        self.fri_best = {}
        for n in nums:
            ts = [l['t'] for k in ('FP1', 'PR') for l in clean_flying(fri[k].get(n, []))]
            self.fri_best[n] = min(ts) if ts else 999

    # --- primitives
    def seed(self, tag): self.rng = random.Random(self.base * 31 + tag)
    def gauss(self, sd, mu=0.0): return self.rng.gauss(mu, sd)
    def split(self, n, total, noise=0.05):
        sb = self.prof[n]['sec']; w = [s / sum(sb) for s in sb]
        raw = [total * w[i] + self.gauss(noise) for i in range(4)]; raw[3] += total - sum(raw)
        return [round(x, 3) for x in raw]
    def mk(self, lapn, run, t, s, v, x=0, p=0, f='S', r='S', nw=0):
        return {'n': lapn, 'run': run, 't': round(t, 3), 's': s, 'v': v, 'x': x, 'p': p, 'sx': [0, 0, 0, 0], 'f': f, 'r': r, 'nw': nw}
    def vspeed(self, n, bonus=0.0): return round(self.prof[n]['vmax'] - abs(self.gauss(1.6)) - 0.8 + bonus, 1)
    def outlap(self, n, lapn, run, f, r):
        t = self.prof[n]['ideal'] + self.rng.uniform(22, 32); return self.mk(lapn, run, t, self.split(n, t, 0.8), None, 0, 0, f, r, 1)
    def inlap(self, n, lapn, run, f, r):
        t = self.prof[n]['ideal'] + self.rng.uniform(9, 22); return self.mk(lapn, run, t, self.split(n, t, 0.6), self.vspeed(n, -2), 0, 1, f, r)
    def flying(self, n, lapn, run, t, f, r, x=0): return self.mk(lapn, run, t, self.split(n, t), self.vspeed(n), x, 0, f, r)
    def qpace(self, n, evo=None): return self.prof[n]['ideal'] + 0.13 + self.prof[n]['fq'] + (self.SAT_EVO if evo is None else evo)
    def rpace(self, n, comp='M', evo=None): return self.qpace(n, evo) + 0.62 + self.COMP[comp][0] + self.prof[n]['fr']

    # --- sessions
    def fp2(self):
        self.seed(2); out = {}
        for n in self.nums:
            laps, lapn, run = [], 0, 0; pr = self.prof[n]
            fq, rq = self.rng.choice(['S', 'M']), self.rng.choice(['S', 'M'])
            run += 1; lapn += 1; laps.append(self.outlap(n, lapn, run, fq, rq)); q = self.qpace(n, self.SAT_EVO + 0.18)
            for k in range(4): lapn += 1; laps.append(self.flying(n, lapn, run, q + 0.65 - 0.15 * k + self.gauss(0.10), fq, rq))
            lapn += 1; laps.append(self.inlap(n, lapn, run, fq, rq))
            run += 1; lapn += 1
            comp = self.rng.choice(['M', 'M', 'H', 'S'])
            L = self.rng.choice([6, 9, 10, 11, 12, 12]) if pr['npr'] > 5 else self.rng.choice([4, 5])
            laps.append(self.outlap(n, lapn, run, 'M', comp))
            for k in range(L):
                lapn += 1
                t = self.rpace(n, comp, self.SAT_EVO + 0.2) + (pr['deg'] * self.COMP[comp][1] - 0.012) * k + self.gauss(pr['cons'])
                laps.append(self.flying(n, lapn, run, t, 'M', comp))
            lapn += 1; laps.append(self.inlap(n, lapn, run, 'M', comp))
            run += 1; lapn += 1; laps.append(self.outlap(n, lapn, run, 'S', 'S')); q = self.qpace(n, self.SAT_EVO + 0.10)
            for k, t in enumerate([q + 0.35 + self.gauss(0.12), q + 0.05 + self.gauss(0.10), q + 0.20 + self.gauss(0.12)]):
                lapn += 1; laps.append(self.flying(n, lapn, run, t, 'S', 'S', 1 if (k == 1 and self.rng.random() < 0.12) else 0))
            lapn += 1; laps.append(self.inlap(n, lapn, run, 'S', 'S'))
            out[n] = laps
        return {'real': False, 'riders': out}

    def _quali(self, group, evo):
        out = {}
        for n in group:
            laps, lapn, run = [], 0, 0
            for rr in range(2):
                run += 1; lapn += 1; laps.append(self.outlap(n, lapn, run, 'S', 'S')); q = self.qpace(n, evo)
                for k in range(2 if rr == 0 else 3):
                    lapn += 1
                    lead = 0.30 if (rr == 0 and k == 0) else (0.06 if k == 1 else 0.0)
                    t = q + lead + abs(self.gauss(0.10)) + (0.0 if rr == 1 else 0.12); x = 1 if self.rng.random() < 0.07 else 0
                    laps.append(self.flying(n, lapn, run, t + (-0.25 if x else 0), 'S', 'S', x))
                lapn += 1; laps.append(self.inlap(n, lapn, run, 'S', 'S'))
            out[n] = laps
        return out

    def quali(self):
        comb = sorted(self.nums, key=lambda n: self.fri_best[n]); q2d, q1s = comb[:10], comb[10:]
        self.seed(3); q1 = self._quali(q1s, self.SAT_EVO - 0.12); q1o = order_from_laps(q1)
        self.seed(4); q2 = self._quali(q2d + q1o[:2], self.SAT_EVO - 0.20); q2o = order_from_laps(q2)
        return ({'real': False, 'riders': q1, 'order': q1o}, {'real': False, 'riders': q2, 'order': q2o})

    def _race(self, nlaps, grid, comps_c, deg_scale, evo, dnf_lap, tag):
        nums = self.nums; comps = {n: self.rng.choice(comps_c) for n in nums}
        gpos = {n: i + 1 for i, n in enumerate(grid)}; cum = {n: 0.0 for n in nums}; laps = {n: [] for n in nums}
        dnf, order, prev_t = {}, list(grid), {}
        for k in range(1, nlaps + 1):
            times = {}
            for n in nums:
                if n in dnf: continue
                c = comps[n]; net = self.prof[n]['deg'] * self.COMP[c][1] * deg_scale - 0.012
                t = self.rpace(n, c, evo) + self.race_shift + net * (k - 1) + self.gauss(self.prof[n]['cons'])
                if k == 1: t += 2.4 + 0.045 * gpos[n] + self.gauss(0.5)
                times[n] = t
            prev = None
            for n in order:
                if n in dnf: continue
                t = times[n]
                if k > 1 and prev is not None:
                    if cum[n] - cum[prev] < 0.45 and t < prev_t.get(prev, t) - 0.05 and self.rng.random() > 0.45: t = max(t, prev_t.get(prev, t) + 0.10)
                times[n] = t; cum[n] += t; prev = n
            if k == dnf_lap:
                cand = [n for n in order if n not in dnf and gpos[n] > 3]; dnf[cand[tag % len(cand)]] = k
            for n in times:
                if n in dnf and dnf[n] == k: cum[n] -= times[n]; continue
                laps[n].append((k, times[n], comps[n]))
            prev_t = times; order = sorted([n for n in order if n not in dnf], key=lambda n: cum[n])
        return laps, cum, dnf

    def race(self, sid, nlaps, grid, comps_c, deg_scale, evo, dnf_lap, tag, vbonus, seedtag):
        self.seed(seedtag)
        laps, cum, dnf = self._race(nlaps, grid, comps_c, deg_scale, evo, dnf_lap, tag)
        out = {}
        for n in self.nums:
            out[n] = [{'n': k, 'run': 1, 't': round(t, 3), 's': self.split(n, t, 0.06), 'v': None if k == 1 else self.vspeed(n, vbonus), 'x': 0, 'p': 0,
                       'sx': [0, 0, 0, 0], 'f': 'M', 'r': c, 'nw': 1 if k == 1 else 0} for (k, t, c) in laps[n]]
        res = {n: out[n] for n in self.nums}
        results, _ = results_from_laps(res)
        for r in results:
            if r['num'] in dnf: r.update({'status': 'DNF', 'time': None, 'gap': None, 'laps': dnf[r['num']] - 1})
        results.sort(key=lambda r: (r['status'] == 'DNF', r['pos']))
        for i, r in enumerate(results): r['pos'] = i + 1
        return {'real': False, 'riders': out, 'results': results, 'nlaps': nlaps}

# =====================================================================================================
#  Assemble DATA
# =====================================================================================================
def compact_riders(laps_by_num, nums):
    return {str(n): laps_by_num.get(n, []) for n in nums}

def strict_ideal(laps):
    sb = sector_best(laps)
    return sum(sb) if None not in sb else None

def build_official(sid, secs, meta, laps_by_num):
    """Everything the non-Analysis reports say about a session, cross-checked against the Analysis laps."""
    o, val = {}, {}
    names = {n: m['name'] for n, m in meta.items()}
    best_of = lambda n: (lambda fl: min(fl) if fl else None)([l['t'] for l in laps_by_num.get(n, []) if not l['x']])
    if 'class' in secs:
        ctext = sec_text(secs['class'])
        cond = parse_cond(ctext)
        if cond: o['cond'] = cond
        lp = re.search(r"AFTER (\d+) LAPS", ctext.upper())
        if lp: o['nlaps'] = int(lp.group(1))
        if sid in ('SPR', 'RAC'):
            ev = parse_events(ctext, names)
            if ev: o['events'] = ev
        cls = parse_class_text(ctext); o['cls'] = {n: {k: v for k, v in r.items() if k not in ('name', 'team', 'nat', 'bike')} for n, r in cls.items()}
        pr = {n: r for n, r in cls.items() if 'best' in r}
        if pr and laps_by_num:
            ok = sum(1 for n, r in pr.items() if (lambda fl: bool(fl) and abs(min(fl) - r['best']) <= 0.0015 and len(laps_by_num.get(n, [])) == r['laps'])([l['t'] for l in laps_by_num.get(n, []) if not l['x']]))
            val['cls'] = f'{ok}/{len(pr)}'
    if 'best' in secs:
        bp = parse_best(sec_text(secs['best']), build_abbr(meta))
        o['bp'] = {n: {'it': v.get('it'), 'bt': v.get('bt'), 'sec': v['sec']} for n, v in bp.items() if v.get('it')}
        if laps_by_num and o['bp']:
            ok = tot = 0; d = []
            for n, v in o['bp'].items():
                si = strict_ideal(laps_by_num.get(n, []))
                if si is None: continue
                tot += 1; d.append(si - v['it'])
                if abs(si - v['it']) <= 0.0015: ok += 1
            if tot: val['ideal'] = f'{ok}/{tot}'
    spd = {}
    if 'avgspd' in secs:
        for n, v in parse_avgspd(sec_text(secs['avgspd'])).items(): spd[n] = dict(v)
    if 'maxspd' in secs:
        for n, v in parse_maxspd(sec_text(secs['maxspd'])).items(): spd.setdefault(n, {})['max'] = v
    if spd:
        o['spd'] = spd
        if laps_by_num:
            ok = tot = 0
            for n, v in spd.items():
                lv = [l['v'] for l in laps_by_num.get(n, []) if l['v']]
                if lv and v.get('max'): tot += 1; ok += abs(max(lv) - v['max']) < 0.05
            if tot: val['speed'] = f'{int(ok)}/{tot}'
    if 'fast' in secs: o['fast'] = parse_fast(sec_text(secs['fast']))
    if 'fastrider' in secs:
        fr = parse_class_text(sec_text(secs['fastrider'])); o['fastrider'] = {n: {'best': r['best'], 'lap': r['bestLap']} for n, r in fr.items() if 'best' in r}
        if laps_by_num and o['fastrider']:
            ok = sum(1 for n, r in o['fastrider'].items() if best_of(n) is not None and abs(best_of(n) - r['best']) <= 0.0015)
            val['fastrider'] = f"{ok}/{len(o['fastrider'])}"
    if 'qres' in secs:
        q = parse_qres(sec_text(secs['qres'])); o['qres'] = q
        mine = {n: r for n, r in q.items() if r['q'] == sid}
        if laps_by_num and mine:
            val['qres'] = f"{sum(1 for n, r in mine.items() if best_of(n) is not None and abs(best_of(n) - r['best']) <= 0.0015)}/{len(mine)}"
    if 'comb' in secs: o['comb'] = parse_comb(sec_text(secs['comb']))
    if 'lapchart' in secs: o['lapchart'] = parse_lapchart(sec_text(secs['lapchart']))
    o['validation'] = val
    docs = {}
    for k, s in secs.items():
        pg = f" (p.{s['pages'][0] + 1}-{s['pages'][-1] + 1})" if s.get('bundle') else ''
        docs[k] = str(s['path'].relative_to(s['root'])).replace('\\', '/') + pg
    o['docs'] = docs
    return o

def build_circuit(circ):
    """-> (DATA | None, info). None while the circuit lacks the FP1 + PR Analysis that anchor the simulation; info always lists what was found."""
    found = scan_pdfs(circuit_dir(circ))
    info = {'found': {sid: [k for k in DOC_KINDS if k in found[sid]] for sid in SIDS if sid in found}}
    log(f'· {circ["folder"]}: ' + (', '.join(f'{s} ({len(k)} informes)' for s, k in info['found'].items()) or 'sin PDFs todavía'))
    for sid in SIDS:
        if sid in found: log(f'  {sid}: ' + ', '.join(f'{DOC_LABEL[k]}' for k in DOC_KINDS + EXTRA_KINDS if k in found[sid]))
    # --- rider table from the classifications (FP1 first, then PR, ...)
    meta = {}
    for sid in SIDS:
        if sid in found and 'class' in found[sid]:
            for n, m in parse_class_text(sec_text(found[sid]['class'])).items(): meta.setdefault(n, dict(m, _pos=m['pos'], _sid=sid))
    real_laps = {}
    for sid in SIDS:
        if sid in found and 'analysis' in found[sid]:
            raw = parse_analysis(found[sid]['analysis'])
            real_laps[sid] = {n: v['laps'] for n, v in raw.items()}
            log(f'  {sid}: Analysis -> {len(raw)} pilotos, {sum(len(v) for v in real_laps[sid].values())} vueltas')
        elif sid in found and set(found[sid]) - {'grid'}: log(f'  ! {sid}: faltan los datos de Analysis (vuelta a vuelta); la sesión se ignora y se simula')
    info['missing'] = [s for s in ('FP1', 'PR') if s not in real_laps]
    if info['missing']:
        log(f'  ! {circ["folder"]} pendiente: faltan ' + ' y '.join(f'{circ["folder"]}/{s}/Analysis' for s in info['missing']) + ' (base de la simulación)')
        return None, info
    for sid in real_laps:
        for n in real_laps[sid]:
            if n not in meta: log(f'  ! piloto #{n} en {sid} sin ficha (clasificación) -> ignorado')
    nums = sorted(meta, key=lambda n: (SIDS.index(meta[n]['_sid']), meta[n]['_pos'], n))
    riders = []
    for i, n in enumerate(nums):
        m = meta[n]; hue = (i * 137.508) % 360; name = m['name'].replace('�', 'Ñ')
        riders.append({'num': n, 'name': name, 'short': SHORT.get(n, name.split()[-1]), 'team': m['team'], 'bike': m['bike'], 'nat': m['nat'],
                       'color': 'hsl(%d,78%%,%d%%)' % (hue, 58 if i % 2 == 0 else 66)})
    # (rider enrichment from the event-level documents happens after they are parsed, see below)
    # --- real sessions (compact laps + official reports)
    real_sessions = {}
    for sid, lb in real_laps.items():
        lbn = {n: lb.get(n, []) for n in nums}
        s = {'real': True, 'riders': compact_riders(lb, nums), 'source': found[sid]['analysis']['path'].name}
        off = build_official(sid, found[sid], meta, lbn)
        for k, v in off.get('validation', {}).items(): log(f'    {sid} validación {DOC_LABEL.get({"cls": "class", "ideal": "best", "speed": "maxspd"}.get(k, k), k)} vs Analysis: {v}')
        s['official'] = off
        cls = off.get('cls', {})
        if sid in ('Q1', 'Q2'):
            s['order'] = order_from_laps(lbn)
            oc = sorted([n for n, r in cls.items() if 'best' in r], key=lambda n: cls[n]['pos'])
            if oc and s['order'] and oc[0] == s['order'][0]: s['order'] = oc          # official classification when consistent
        if sid in ('SPR', 'RAC'):
            s['results'], s['nlaps'] = results_from_laps(lbn)
            if off.get('nlaps'): s['nlaps'] = off['nlaps']                       # "CLASSIFICATION AFTER 10 LAPS"
            fin = sorted([r for r in cls.values() if not r.get('nc') and (r.get('time') or r.get('gap') is not None)], key=lambda r: r['pos'])
            ncs = sorted([r for r in cls.values() if r.get('nc')], key=lambda r: r['pos'])
            if fin and s['results'] and len(fin) + len(ncs) >= 0.8 * len(s['results']) and fin[0]['num'] == s['results'][0]['num']:
                byn = {r['num']: r for r in s['results']}; nl = s['nlaps']; w0 = fin[0].get('time') or byn[fin[0]['num']]['time']
                res = [{'pos': r['pos'], 'num': r['num'], 'time': round(w0 if r['pos'] == fin[0]['pos'] else w0 + (r.get('gap') or 0), 3) if w0 else None,
                        'gap': 0.0 if r['pos'] == fin[0]['pos'] else r.get('gap'), 'laps': nl - r.get('lapsDown', 0) if r.get('lapsDown', 0) < 5 else nl, 'status': 'FIN', 'pts': r.get('pts', 0)} for r in fin]
                for r in ncs: res.append({'pos': len(res) + 1, 'num': r['num'], 'time': None, 'gap': None, 'laps': max(0, nl - r.get('lapsDown', 0)), 'status': 'DNF', 'pts': 0})
                for r in sorted(byn.values(), key=lambda r: r['pos']):
                    if r['num'] not in {x['num'] for x in res}: res.append(dict(r, pos=len(res) + 1, status='DNF', time=None, gap=None))
                s['results'] = res
                s['official']['results_source'] = 'classification'
                log(f'    {sid}: resultado oficial tomado de la Classification ({len(fin)} clasificados, {len(ncs)} no clasificados)')
                lt = [l['t'] for l in lbn.get(res[0]['num'], [])]
                if lt and w0: off['validation']['winner'] = 'ok' if abs(w0 - sum(lt)) <= 0.0015 else f'Δ{w0 - sum(lt):+.3f}'
                if 'events' in off and lt:                                          # lap of every incident, from the winner's cumulative lap times
                    ev = off['events']; t0 = next((e['t'] for e in ev if 'RACE START' in e['text'].upper()), None)
                    if t0 is not None:
                        cum = [sum(lt[:i + 1]) for i in range(len(lt))]
                        for e in ev: e['lap'] = 1 + sum(1 for c in cum if c <= e['t'] - t0) if e['t'] >= t0 else 0
            else: log(f'    {sid}: resultado calculado sumando vueltas del Analysis (la Classification no se pudo leer/validar)')
        real_sessions[sid] = s
    fri = {k: real_laps[k] for k in ('FP1', 'PR')}
    # --- event-level documents (Entry list, rider statistics, circuit information, event top speeds): any folder, newest wins
    evt = found.get('EVT', {}); event = {}; edocs = {}
    for k in EVENT_KINDS:
        if k in evt: edocs[k] = str(evt[k]['path'].relative_to(evt[k]['root'])).replace(chr(92), '/')
    if 'entry' in evt: event['entry'] = parse_entry(sec_text(evt['entry']))
    if 'bio' in evt: event['bio'] = parse_bio(evt['bio'])
    if 'evtspd' in evt: event['evtspd'] = parse_evtspd(sec_text(evt['evtspd']))
    if 'circuit' in evt: event['circuit'] = parse_circuit(sec_text(evt['circuit']))
    if event:
        log('  Evento: ' + ', '.join(f'{DOC_LABEL[k]}' for k in EVENT_KINDS if k in evt) + ' -> ' + ', '.join(
            f'{k} {len(v)}' if isinstance(v, dict) and k != 'circuit' else k for k, v in event.items()))
        if 'bio' in event: log(f'  Rider Statistics: {len(event["bio"])} pilotos, clasificacion 2025 en {sum(1 for r in event["bio"].values() if "wc25" in r)}')
        if 'evtspd' in event:
            ok = tot = 0
            for n, v in event['evtspd'].items():
                mx = max([l['v'] for sd in real_laps.values() for l in sd.get(n, []) if l['v']] or [0])
                if mx: tot += 1; ok += abs(mx - v['kmh']) < 0.05
            if tot: log(f'  Event Max Speed vs maximos de las sesiones: {ok}/{tot} (el resto: la punta del evento sale de una vuelta fuera de nuestro Analysis)')
    # --- official starting grids (Q2/Grid.pdf = Sunday grid, SPRINT/Grid.pdf = Sprint grid): authoritative slot of every rider (penalties included) + who starts
    names = {n: m['name'] for n, m in meta.items()}
    qord = real_sessions['Q2']['order'] + [n for n in real_sessions.get('Q1', {}).get('order', []) if n not in real_sessions['Q2']['order']] if 'Q2' in real_sessions else []
    qres = real_sessions.get('Q2', {}).get('official', {}).get('qres')
    if qres: qord = sorted(qres, key=lambda n: qres[n]['pos'])
    grids = {}
    for gs in ('SPR', 'RAC'):
        sec = found.get(gs, {}).get('grid')
        if not sec: continue
        g = parse_grid(sec_text(sec), names)
        if len(g['order']) < 10: log(f'  ! Grid {gs}: solo {len(g["order"])} pilotos reconocidos -> ignorada'); continue
        g['doc'] = str(sec['path'].relative_to(sec['root'])).replace(chr(92), '/') + (f" (p.{sec['pages'][0] + 1})" if sec.get('bundle') else '')
        if qord: g['pen'] = {n: (g['order'].index(n) + 1) - (qord.index(n) + 1) for n in g['order'] if n in qord}
        chk = real_sessions.get(gs, {}).get('official', {}).get('lapchart')
        if chk and chk.get('grid') and chk['grid'] != g['order']: log(f'  ! Grid {gs}: el orden leido no coincide con el Lap Chart')
        elif chk and chk.get('grid'): log(f'  Grid {gs}: coincide con el Lap Chart ({len(g["order"])} pilotos)')
        if g.get('times'):                                                    # grid times are the qualifying bests
            qb = {n: (qres[n]['best'] if qres and n in qres else None) for n in g['order']}
            tot = [n for n in g['order'] if qb[n]]; ok = sum(1 for n in tot if abs(qb[n] - g['times'][n]) <= 0.0015)
            if tot: log(f'  Grid {gs}: tiempos vs Qualifying Results {ok}/{len(tot)}')
        moved = [(n, d) for n, d in (g.get('pen') or {}).items() if d]
        log(f'  Grid {gs}: {len(g["order"])} en parrilla, {g.get("laps")} vueltas' + (f', {len(moved)} con cambio de puesto respecto a la clasificación' if moved else ', igual que la clasificación'))
        grids[gs] = g
    absent = [n for n in nums if grids and not any(n in g['order'] for g in grids.values())]
    if absent: log('  No toman la salida: ' + ', '.join(f'#{n}' for n in absent))
    sprl = real_sessions['SPR']['nlaps'] if 'SPR' in real_sessions else (grids.get('SPR', {}).get('laps') or circ['sprintLaps'])
    racl = real_sessions['RAC']['nlaps'] if 'RAC' in real_sessions else (grids.get('RAC', {}).get('laps') or circ['raceLaps'])
    sim = Sim(nums, fri, circ['salt'])
    sim_q1, sim_q2 = sim.quali()
    def sim_grid(gs):
        if gs in grids: grd = list(grids[gs]['order'])
        elif 'Q2' in real_sessions: grd = list(qord)
        else: grd = sim_q2['order'] + [n for n in sim_q1['order'] if n not in sim_q2['order']]
        return grd + [n for n in sorted(nums, key=lambda n: sim.fri_best[n]) if n not in grd]
    sim_sessions = {'FP2': sim.fp2(), 'Q1': sim_q1, 'Q2': sim_q2,
                    'SPR': sim.race('SPR', sprl, sim_grid('SPR'), ['S', 'M', 'M'], 0.9, sim.SAT_EVO - 0.05, 4, 7, 0.4, 5)}
    # A real Sprint tells how far above the Friday ideal lap the field really races at this circuit and temperature. The clean Sprint simulation stays
    # untouched (it is what gets compared against reality); only the not-yet-real Sunday simulation inherits the measured gap.
    def pace_off(laps_by_num, skip=()):
        d = []
        for n, ls in laps_by_num.items():
            if n in skip or n not in sim.prof: continue
            t = [l['t'] for l in ls if l['n'] >= 2]
            if len(t) >= 6:
                md = st.median(t); t = [x for x in t if x <= 1.07 * md]
                d.append(sum(t) / len(t) - sim.prof[n]['ideal'])
        return st.median(d) if len(d) >= 8 else None
    if 'SPR' in real_sessions:
        skip = {e['num'] for e in real_sessions['SPR']['official'].get('events', []) if e.get('num') and e['kind'] in ('crash', 'retire', 'pit', 'penalty')}
        r_off, s_off = pace_off({n: real_laps['SPR'].get(n, []) for n in nums}, skip), pace_off(sim_sessions['SPR']['riders'], skip)
        if r_off is not None and s_off is not None:
            sim.race_shift = r_off - s_off
            log(f'  Calibración: ritmo medio de la Sprint real = ideal de viernes +{r_off:.2f} s (simulación limpia +{s_off:.2f}) -> la carrera simulada se desplaza +{sim.race_shift:.2f} s/vta')
    sim_sessions['RAC'] = sim.race('RAC', racl, sim_grid('RAC'), ['M', 'M', 'H'], 1.0, sim.SAT_EVO, 9, 13, 0.2, 6)
    for s in sim_sessions.values(): s['riders'] = compact_riders(s['riders'], nums)
    sessions = {sid: real_sessions.get(sid) or sim_sessions[sid] for sid in SIDS}
    simulated_overrides = {sid: sim_sessions[sid] for sid in SIM_SIDS if sid in real_sessions}
    ent, bio = event.get('entry', {}), event.get('bio', {})
    subs = {v['replaces'] for v in ent.values() if v.get('replaces')}
    for r in riders:
        e, b = ent.get(r['num'], {}), bio.get(r['num'])
        if e.get('flag'): r['flag'] = e['flag']
        if e.get('replaces'): r['replaces'] = e['replaces']; r['replacesName'] = (ent.get(e['replaces']) or {}).get('surname', '#%d' % e['replaces'])
        if b: r['bio'] = b
    event['outOfEvent'] = {str(n): (ent.get(n) or {}).get('surname') for n in subs}
    cinfo = {k: circ[k] for k in ('id', 'folder', 'flag', 'short', 'name', 'gp', 'length', 'record', 'weather')}
    if 'circuit' in event:
        ci = event['circuit']; cinfo['info'] = ci['info']; cinfo['records'] = ci['records']; cinfo['y25'] = ci['y25']
        lr = ci['records'].get('lap')
        if lr: cinfo['record'] = {'t': lr['t'], 'who': lr['who'], 'year': lr['year']}
        if ci['info'].get('lengthM') and abs(ci['info']['lengthM'] / 1000 - circ['length']) > 0.002: log(f'  ! Longitud del PDF {ci["info"]["lengthM"]} m distinta de la tabla ({circ["length"]} km)')
    cinfo.update({k: circ.get(k) for k in ('lat', 'lon', 'raceDate', 'raceHour', 'forecastUrl', 'forecast')})
    cinfo.update(sprintLaps=sprl, raceLaps=racl, lapsEstimated={'SPR': 'SPR' not in real_sessions and 'SPR' not in grids, 'RAC': 'RAC' not in real_sessions and 'RAC' not in grids})
    wsid = next((x for x in reversed(SIDS) if x in real_sessions and real_sessions[x]['official'].get('cond')), None)      # header weather = latest real session
    if wsid: c_ = real_sessions[wsid]['official']['cond']; cinfo['weather'] = {'air': c_.get('air'), 'hum': c_.get('hum'), 'ground': c_.get('ground'), 'cond': c_.get('cond'), 'sid': wsid}
    for gs, g in grids.items():
        if gs == 'RAC' and 'Q2' in real_sessions: real_sessions['Q2']['official']['docs']['grid'] = g['doc']
        if gs == 'SPR' and 'SPR' in real_sessions: real_sessions['SPR']['official']['docs']['grid'] = g['doc']
    return {
        'circuit': cinfo,
        'riders': riders, 'sessions': sessions, 'sim': simulated_overrides, 'grids': grids, 'event': {k: v for k, v in event.items() if k in ('entry', 'bio', 'evtspd', 'outOfEvent')},
        'meta': {'real': [s for s in SIDS if s in real_sessions], 'built': time.strftime('%Y-%m-%d %H:%M:%S'),
                 'sources': {s: real_sessions[s]['source'] for s in real_sessions},
                 'docs': {s: real_sessions[s]['official']['docs'] for s in real_sessions}, 'eventDocs': edocs,
                 'validation': {s: real_sessions[s]['official']['validation'] for s in real_sessions}},
    }, info

def build_data(cid=DEFAULT_CIRCUIT):
    """DATA of one circuit (None while it is pending). Used by --json and by tests."""
    return build_circuit(next(c for c in CIRCUITS if c['id'] == cid))[0]

def build_all():
    """-> {'default', 'circuits': [{...circuit card, 'ready', 'found', 'missing'}], 'data': {id: DATA | None}}"""
    ensure_folders()
    out = {'default': DEFAULT_CIRCUIT, 'circuits': [], 'data': {}}
    for c in CIRCUITS:
        d, info = build_circuit(c)
        card = {k: c[k] for k in ('id', 'folder', 'flag', 'short', 'name', 'gp', 'length')}
        card.update(ready=d is not None, found=info['found'], missing=info.get('missing', []))
        out['circuits'].append(card); out['data'][c['id']] = d
    return out

def build_html(data=None):
    data = data or build_all()
    t = (TOOLS / 'template.html').read_text(encoding='utf8')
    html = (t.replace('__DATA__', json.dumps(data, ensure_ascii=False, separators=(',', ':')))
             .replace('__ENGINE__', (TOOLS / 'engine.js').read_text(encoding='utf8'))
             .replace('__SHELL__', (TOOLS / 'shell.jsx').read_text(encoding='utf8'))
             .replace('__UI__', (TOOLS / 'ui.jsx').read_text(encoding='utf8')))
    return html, data

def write_index():
    html, data = build_html()
    (ROOT / 'index.html').write_text(html, encoding='utf8')
    log(f'index.html escrito ({len(html) // 1024} KB)')
    for c in data['circuits']:
        d = data['data'][c['id']]
        log(f'  {c["folder"]}: ' + (f'reales {d["meta"]["real"]} · simuladas {[s for s in SIDS if s not in d["meta"]["real"]]}' if d else 'pendiente (faltan ' + ', '.join(c['missing']) + ')'))
    return html

if __name__ == '__main__':
    if len(sys.argv) > 2 and sys.argv[1] == '--json':
        Path(sys.argv[2]).write_text(json.dumps(build_data(*sys.argv[3:4]), ensure_ascii=False, separators=(',', ':')), encoding='utf8')
    else:
        write_index()
