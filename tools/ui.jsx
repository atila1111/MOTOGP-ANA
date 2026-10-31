const { useState, useMemo, useEffect, useRef, useContext } = React;

/* ---------- theme / chart defaults ---------- */
Chart.defaults.color = '#8a93a3';
Chart.defaults.borderColor = '#1d232c';
Chart.defaults.font.family = "ui-monospace, 'Cascadia Mono', Consolas, monospace";
Chart.defaults.font.size = 11;
Chart.defaults.plugins.legend.labels.boxWidth = 10;
Chart.defaults.plugins.tooltip.backgroundColor = '#0b0d10';
Chart.defaults.plugins.tooltip.borderColor = '#2a313c';
Chart.defaults.plugins.tooltip.borderWidth = 1;

const TABS = [['res', 'Resumen'], ['tel', 'Telemetría'], ['pace', 'Ritmo & Simulación'], ['race', 'Simulador de carrera'], ['acc', 'Predicción vs Realidad'], ['cmp', 'Sim vs Real']];
const SIDS_ALL = ['FP1', 'PR', 'FP2', 'Q1', 'Q2', 'SPR', 'RAC'];
const TARGETS = [['POLE', 'Pole'], ['SPR', 'Sprint'], ['RAC', 'Domingo']];
const WHY = { OUT: 'Out-lap', IN: 'In-lap', ANU: 'Anulada', LENTA: '>107%', SAL: 'Salida' };
const MODE = { long: 'Tanda larga (>8)', short: 'Tanda corta', mini: 'Mini-tanda (3-4)', best: 'Solo mejor vuelta', 'long+spr': 'Larga + Sprint', 'short+spr': 'Corta + Sprint', 'mini+spr': 'Mini + Sprint', 'best+spr': 'Mejor vuelta + Sprint' };
const BIKE_COL = { DUCATI: '#e11d2e', APRILIA: '#8b5cf6', KTM: '#f97316', HONDA: '#ef4444', YAMAHA: '#3b82f6' };
const DEFAULT_SEL = [93, 73, 63, 37, 89, 72];

const mm = n => RIDER[n].short;
const tgtRows = (sn, t) => t === 'POLE' ? sn.pole : t === 'SPR' ? sn.sprint : sn.race;
const COND_ES = { Dry: 'Seco', Wet: 'Mojado', Damp: 'Húmedo' };
const condTxt = c => c ? `${COND_ES[c.cond] || c.cond || ''} · aire ${c.air}° · pista ${c.ground}° · hum. ${c.hum}%` : '';
const EV_CLS = { crash: 'text-red-300', retire: 'text-red-300', pit: 'text-amber-300', rejoin: 'text-amber-200', penalty: 'text-fuchsia-300', info: 'text-slate-500' };
const evTxt = e => (e.lap ? `V${e.lap} · ` : '') + e.text;

/* ---------- small UI atoms ---------- */
function Badge({ real, children }) {
  return <span className={'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider ' + (real ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40' : 'bg-sky-500/15 text-sky-300 border border-sky-500/40')}>{children || (real ? 'REAL' : 'SIMULADO')}</span>;
}
/* Every panel names the session / target its data belongs to. `sess` overrides the default scope given by the active milestone; sess={null} hides the tag. */
const ScopeCtx = React.createContext(null);
const TLBL = { POLE: 'Q2', SPR: 'SPRINT', RAC: 'RACE' };                                    // prediction target -> session it is judged on
const sessTag = s => SESS[s].label + (SD[s].real ? ' · REAL' : ' · SIM');
function Panel({ title, right, children, className = '', sess }) {
  const scope = useContext(ScopeCtx), tag = sess === undefined ? scope : sess;
  return <section className={'rounded-lg border border-[#1f2630] bg-[#10141a] ' + className}>
    {(title || right) && <header className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-[#1f2630]">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-300 flex flex-wrap items-center gap-x-2 gap-y-1">{title}{tag && <span className="px-1.5 py-0.5 rounded border border-red-500/40 bg-red-500/10 text-red-300 normal-case tracking-normal font-bold text-[10px]">{tag}</span>}</h3><div className="flex items-center gap-2">{right}</div></header>}
    <div className="p-4">{children}</div></section>;
}
function Dot({ n }) { return <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: RIDER[n].color }} />; }
function Num({ n }) { return <span className="font-bold text-[11px] px-1 rounded bg-[#1a2029] text-slate-300 tabular-nums">#{n}</span>; }
function Conf({ v }) {
  const c = v >= 70 ? '#34d399' : v >= 45 ? '#fbbf24' : '#f87171';
  return <div className="flex items-center gap-1.5"><div className="w-14 h-1.5 rounded bg-[#1a2029] overflow-hidden"><div className="h-full" style={{ width: v + '%', background: c }} /></div><span className="text-[10px] tabular-nums text-slate-400">{v}%</span></div>;
}
function Chip({ active, onClick, children, disabled, title }) {
  return <button title={title} disabled={disabled} onClick={onClick} className={'px-2.5 py-1 rounded text-xs font-semibold border transition ' + (disabled ? 'opacity-30 cursor-not-allowed border-[#1f2630] text-slate-500' : active ? 'bg-red-600 border-red-500 text-white' : 'border-[#2a313c] text-slate-300 hover:border-slate-500')}>{children}</button>;
}

function ChartCanvas({ type, data, options, height = 300 }) {
  const ref = useRef(null), chart = useRef(null);
  useEffect(() => {
    if (chart.current) chart.current.destroy();
    chart.current = new Chart(ref.current, { type, data, options: Object.assign({ responsive: true, maintainAspectRatio: false, animation: false }, options) });
    return () => { if (chart.current) { chart.current.destroy(); chart.current = null; } };
  }, [type, data, options]);
  return <div style={{ height }}><canvas ref={ref} /></div>;
}
const axisT = (text) => ({ title: { display: true, text } });

/* ---------- Podium card ---------- */
function PodiumCard({ target, snap, prev, onOpen }) {
  const t = tgtRows(snap, target), known = t.known;
  const label = { POLE: 'Pole', SPR: 'Sprint', RAC: 'Domingo' }[target];
  const simulated = known && !SD[{ POLE: 'Q2', SPR: 'SPR', RAC: 'RAC' }[target]].real;                  // this milestone "knows" the result only because the session is simulated
  const prevRows = prev ? tgtRows(prev, target).rows : null;
  const top = t.rows.slice(0, 3);
  return <div className="rounded-lg border border-[#1f2630] bg-[#10141a] overflow-hidden">
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1f2630]" style={{ background: 'linear-gradient(90deg,#1a0d10,#10141a)' }}>
      <div className="font-black tracking-widest text-sm text-white">TOP 3 · {label.toUpperCase()}</div>
      <span className={'text-[10px] font-bold px-2 py-0.5 rounded ' + (simulated ? 'bg-sky-500/15 text-sky-300 border border-sky-500/40' : known ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40' : 'bg-amber-500/15 text-amber-300 border border-amber-500/40')}>{simulated ? 'SIMULADO' : known ? 'RESULTADO' : 'PREDICCIÓN'}</span>
    </div>
    <ul className="divide-y divide-[#1a2029]">
      {top.map((r, i) => {
        const pp = prevRows ? prevRows.findIndex(x => x.num === r.num) + 1 : 0;
        const d = pp ? pp - (i + 1) : 0;
        return <li key={r.num} className="flex items-center gap-3 px-4 py-3">
          <div className={'w-7 h-7 rounded flex items-center justify-center font-black text-sm ' + (i === 0 ? 'bg-amber-400 text-black' : i === 1 ? 'bg-slate-300 text-black' : 'bg-orange-700 text-white')}>{i + 1}</div>
          <Dot n={r.num} />
          <div className="min-w-0 flex-1"><div className="font-bold text-slate-100 truncate">{RIDER[r.num].name}</div>
            <div className="text-[11px] text-slate-500 truncate">{RIDER[r.num].team}</div></div>
          <div className="text-right"><div className="tabular-nums text-sm text-slate-100">{target === 'POLE' ? fmtLap(r.T) : (i === 0 ? fmtTime(r.T) : fmtGap(r.gap))}</div>
            {!known && <Conf v={r.conf} />}
            {prev && !known && d !== 0 && <div className={'text-[10px] font-bold ' + (d > 0 ? 'text-emerald-400' : 'text-red-400')}>{d > 0 ? '▲ +' + d : '▼ ' + d} vs hito ant.</div>}
          </div></li>;
      })}
    </ul>
    {target !== 'POLE' && !known && <div className="px-4 py-1.5 text-[10px] border-t border-[#1a2029] text-slate-500">{t.gridOff ? <span className="text-sky-300">● Parrilla oficial (Grid.pdf): {t.rows.length} pilotos en salida</span> : 'Parrilla estimada (sin Grid.pdf)'}</div>}
    <button onClick={onOpen} className="w-full text-[11px] py-2 text-slate-400 hover:text-white border-t border-[#1a2029] tracking-wider">VER CLASIFICACIÓN COMPLETA →</button>
  </div>;
}

/* ---------- Sidebar ---------- */
function RiderPanel({ sel, setSel, snap }) {
  const sorted = useMemo(() => {
    const rank = {}; snap.race.rows.forEach(r => rank[r.num] = r.pos);
    return [...NUMS].sort((a, b) => (rank[a] || 99) - (rank[b] || 99));
  }, [snap]);
  const toggle = n => setSel(s => s.includes(n) ? s.filter(x => x !== n) : [...s, n]);
  return <Panel title={`Pilotos (${sel.length}/${NUMS.length})`} sess={null}>
    <div className="flex flex-wrap gap-1.5 mb-3">
      <Chip onClick={() => setSel([...NUMS])}>Todos</Chip><Chip onClick={() => setSel([])}>Ninguno</Chip>
      <Chip onClick={() => setSel(DEFAULT_SEL)}>Selección</Chip>
      <Chip onClick={() => setSel(sorted.slice(0, 6))}>Top 6</Chip>
    </div>
    <ul className="space-y-0.5 max-h-[26vh] lg:max-h-[52vh] overflow-y-auto pr-1">
      {sorted.map(n => <li key={n}>
        <label className={'flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-xs hover:bg-[#161c25] ' + (sel.includes(n) ? 'bg-[#141a22]' : '')}>
          <input type="checkbox" className="accent-red-600" checked={sel.includes(n)} onChange={() => toggle(n)} />
          <Dot n={n} /><span className="tabular-nums text-slate-500 w-6">{n}</span>
          <span className="truncate text-slate-200 flex-1" title={bioTip(n)}>{RIDER[n].short}{riderTags(n)}</span>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: BIKE_COL[RIDER[n].bike] }} title={RIDER[n].bike} />
        </label></li>)}
    </ul>
  </Panel>;
}

const bioTip = n => { const r = RIDER[n], b = r.bio; return [r.name, b && b.age ? b.age + ' años' : null, b && b.starts ? b.starts + ' GP en MotoGP' : null, b && b.wins ? b.wins + ' victorias' : null, b && b.wc25 ? 'Mundial 2025: ' + b.wc25 + 'º' : null,
  b && b.race25 ? 'Carrera aquí 2025: ' + b.race25 + 'º' : null, r.replaces ? 'Sustituto de ' + r.replacesName : null, r.flag === 'r' ? 'Novato' : null, r.flag === 'W' ? 'Wildcard' : null].filter(Boolean).join(' · '); };
const riderTags = n => { const r = RIDER[n]; return <>{r.replaces && <span className="ml-1 text-[9px] font-bold px-1 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30" title={'Sustituto de ' + r.replacesName}>SUST</span>}
  {r.flag === 'r' && <span className="ml-1 text-[9px] font-bold px-1 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" title="Novato">NOV</span>}
  {r.flag === 'W' && <span className="ml-1 text-[9px] font-bold px-1 rounded bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-500/30" title="Wildcard">WC</span>}</>; };

/* ---------- Ficha del circuito (Circuit Information PDF) ---------- */
function CircuitCard({ M }) {
  const c = DATA.circuit, i = c.info, rec = c.records, y = c.y25;
  if (!i) return null;
  const has = s => M.sessions.includes(s) && SD[s].real;
  const poleT = has('Q2') ? SNAP.SAT.pole.rows[0] : null;
  const spr = has('SPR') && SD.SPR.results && SD.SPR.results[0] && SD.SPR.results[0].time ? SD.SPR.results[0] : null;
  const sprLap = spr ? spr.time / SD.SPR.nlaps : null;
  const evs = DATA.event && DATA.event.evtspd ? Object.entries(DATA.event.evtspd).filter(([, v]) => M.sessions.includes(v.sid)).sort((a, b) => b[1].kmh - a[1].kmh)[0] : null;
  const d = (a, b) => (a - b >= 0 ? '+' : '') + (a - b).toFixed(3);
  const item = (l, v, sub) => <div className="rounded border border-[#1f2630] bg-[#0d1117] px-3 py-2"><div className="text-[10px] uppercase tracking-[0.12em] text-slate-500">{l}</div><div className="text-sm font-bold text-slate-100 tabular-nums">{v}</div>{sub && <div className="text-[11px] text-slate-400">{sub}</div>}</div>;
  return <Panel title="Ficha del circuito" right={<span className="text-[11px] text-slate-500">Circuit Information · {DATA.meta.eventDocs && DATA.meta.eventDocs.circuit}</span>}>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
      {item('Trazado', `${c.length} km · ${i.width} m`, `${i.right} curvas a derechas · ${i.left} a izquierdas · inaugurado ${i.built}`)}
      {item('Recta más larga', `${i.straight} m`, `Pole a la ${i.poleSide === 'Left' ? 'izquierda' : 'derecha'}`)}
      {rec && rec.lap && item('Récord absoluto', fmtLap(rec.lap.t), `${rec.lap.who} · ${rec.lap.year}`)}
      {rec && rec.vmax && item('Punta récord', rec.vmax.kmh.toFixed(1) + ' km/h', `${rec.vmax.who} · ${rec.vmax.year}`)}
      {y && y.pole && item('Pole 2025', fmtLap(y.pole.t), y.pole.who)}
      {y && y.raceLap && item('Mejor vuelta carrera 2025', fmtLap(y.raceLap.t), y.raceLap.who)}
      {y && y.podium && item('Podio 2025', y.podium.map(x => x.split(' ')[0][0] + '.' + x.split(' ').pop()).join(' · '), 'este circuito')}
      {rec && rec.pole && item('Mejor pole histórica', fmtLap(rec.pole.t), `${rec.pole.who} · ${rec.pole.year}`)}
    </div>
    {(poleT || spr || evs) && <div className="mt-3 text-xs text-slate-300 space-y-1">
      {poleT && poleT.T && <div><b className="text-sky-300">Pole {SD.Q2.real ? 'real' : ''} {fmtLap(poleT.T)}</b> ({mm(poleT.num)}): {rec && rec.lap ? <><b className="tabular-nums">{d(poleT.T, rec.lap.t)} s</b> vs récord</> : null}{y && y.pole ? <> · <b className="tabular-nums">{d(poleT.T, y.pole.t)} s</b> vs pole 2025</> : null}.</div>}
      {sprLap && y && y.raceLap && <div><b className="text-sky-300">Ritmo medio del ganador de la Sprint {fmtLap(sprLap)}</b> ({mm(spr.num)}): <b className="tabular-nums">{d(sprLap, y.raceLap.t)} s</b> sobre la mejor vuelta de carrera 2025 (incluye salida y degradación).</div>}
      {evs && rec && rec.vmax && <div><b className="text-sky-300">Mejor punta del fin de semana {evs[1].kmh.toFixed(1)} km/h</b> ({mm(+evs[0])}, {SESS[evs[1].sid].label}): {Math.abs(evs[1].kmh - rec.vmax.kmh) < 0.05 ? 'iguala el récord.' : (evs[1].kmh - rec.vmax.kmh).toFixed(1) + ' km/h respecto al récord.'}</div>}
    </div>}
  </Panel>;
}

/* ---------- TAB: Resumen ---------- */
function Resumen({ snap, prev, M, sel, goPace, goSim }) {
  const A = snap.A;
  const allV = NUMS.map(n => ({ n, v: A[n].vmax })).filter(x => x.v).sort((a, b) => b.v - a.v)[0];
  const bestL = NUMS.map(n => ({ n, t: A[n].best })).filter(x => isFinite(x.t)).sort((a, b) => a.t - b.t)[0];
  const bestI = NUMS.map(n => ({ n, t: A[n].ideal })).filter(x => isFinite(x.t)).sort((a, b) => a.t - b.t)[0];
  const tot = NUMS.reduce((s, n) => s + A[n].cnt.total, 0), clean = NUMS.reduce((s, n) => s + A[n].cnt.clean, 0);
  const K = [['Mejor vuelta real', fmtLap(bestL.t), mm(bestL.n)], ['Mejor vuelta ideal', fmtLap(bestI.t), mm(bestI.n)],
  ['Velocidad punta', allV.v.toFixed(1) + ' km/h', mm(allV.n)], ['Vueltas válidas', `${clean}/${tot}`, `${Math.round(100 * clean / tot)}% tras depuración`]];
  return <div className="space-y-4">
    {M.sessions.includes('RAC') && !SD.RAC.real && <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-4 py-3 text-sm text-sky-100 flex flex-wrap items-center gap-3">
      <span><b>La Carrera aún no tiene PDFs en {CIRC.folder}/RACE/:</b> lo que ves de Domingo es una simulación. Ajusta pista, meteo y condición (seco, mojado o flag-to-flag) en el simulador.</span>
      <button onClick={goSim} className="ml-auto px-3 py-1.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold">Abrir simulador de carrera →</button></div>}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {K.map(([a, b, c]) => <div key={a} className="rounded-lg border border-[#1f2630] bg-[#10141a] px-4 py-3">
        <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{a}</div>
        <div className="text-xl font-black text-white tabular-nums mt-1">{b}</div><div className="text-[11px] text-slate-400">{c}</div></div>)}
    </div>
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      {TARGETS.map(([t]) => <PodiumCard key={t} target={t} snap={snap} prev={prev} onOpen={() => goPace(t)} />)}
    </div>
    <CircuitCard M={M} />
    <DocsPanel M={M} />
  </div>;
}

/* ---------- TAB: Telemetría ---------- */
function Telemetria({ snap, M, sel, view, sid }) {
  const avail = M.sessions;
  const [ide, setIde] = useState('ALL');
  const [showDis, setShowDis] = useState(false);
  const [spm, setSpm] = useState('max');
  const cur = sid;                                                  // chosen in the sticky header (App guarantees it belongs to the milestone)
  const ideS = ide === 'ALL' || avail.includes(ide) ? ide : 'ALL';
  const A = snap.A, order = sel;

  const lapData = useMemo(() => {
    const ds = []; let cut = 0;
    for (const n of order) {
      const cl = CLS[cur][n] || [], ok = cl.filter(l => !l.why).map(l => l.t);
      if (!ok.length) continue;
      const lim = (SESS[cur].kind === 'race' ? median(ok) : Math.min(...ok)) * 1.07;
      const pts = [], bg = [], st = [], rad = [];
      const gap = l => { pts.push({ x: l.n, y: null }); bg.push('transparent'); st.push('circle'); rad.push(0); };
      for (const l of cl) {
        if (l.why && !showDis && l.why !== 'ANU') { cut++; gap(l); continue; }
        if (l.t > lim * (showDis ? 1.03 : 1) && l.why !== 'ANU') { cut++; gap(l); continue; }
        if (l.why === 'ANU' && l.t > lim * 1.03) { cut++; gap(l); continue; }
        pts.push({ x: l.n, y: l.t });
        if (!l.why) { bg.push(RIDER[n].color); st.push('circle'); rad.push(3.5); }
        else if (l.why === 'ANU') { bg.push('#ef4444'); st.push('crossRot'); rad.push(6); }
        else { bg.push('transparent'); st.push('rectRot'); rad.push(4); }
      }
      ds.push({ label: `#${n} ${mm(n)}`, data: pts, borderColor: RIDER[n].color, backgroundColor: bg, pointStyle: st, pointRadius: rad, pointBorderColor: RIDER[n].color, borderWidth: 1.4, tension: 0, showLine: true, spanGaps: false });
    }
    return { datasets: ds, cut };
  }, [cur, order, showDis, view]);
  const lapOpts = useMemo(() => ({ parsing: false, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => c.raw && c.raw.y != null ? `${c.dataset.label}  V${c.raw.x}: ${fmtLap(c.raw.y)}` : '' } } },
    scales: { x: { type: 'linear', ...axisT('Vuelta'), ticks: { precision: 0 } }, y: { ...axisT('Tiempo de vuelta'), ticks: { callback: v => fmtLap(v) } } } }), []);

  /* one row per rider for the chosen session ("ALL" = whole weekend so far). Ideal = Σ fastest sectors, even from different laps. */
  const rowOf = n => {
    const a = A[n];
    if (ideS === 'ALL') return { sec: a.sec, ideal: a.ideal, best: a.best, margin: a.margin, n: a.cnt.total, clean: a.cnt.clean, ex: 0, off: null, flagged: [], OUT: a.cnt.OUT, IN: a.cnt.IN, ANU: a.cnt.ANU, LENTA: a.cnt.LENTA };
    const b = a.bySession[ideS], cl = CLS[ideS][n] || [], c = k => cl.filter(l => l.why === k).length;
    const ideal = b.sec.every(isFinite) ? b.ideal : NaN;
    return { sec: b.sec, ideal, best: b.best, margin: isFinite(ideal) && isFinite(b.best) ? Math.max(0, b.best - ideal) : NaN, n: b.n, clean: b.clean, ex: b.excluded, off: b.official ? b.official.it : null, flagged: b.flagged, OUT: c('OUT'), IN: c('IN'), ANU: c('ANU'), LENTA: c('LENTA') };
  };
  const rowsAll = NUMS.map(n => [n, rowOf(n)]), rowMap = Object.fromEntries(rowsAll);
  const secBest = [0, 1, 2, 3].map(k => Math.min(...rowsAll.map(([n, r]) => r.sec[k])));
  const hasOff = ideS !== 'ALL' && order.some(n => rowMap[n].off);
  const ideTag = ideS === 'ALL' ? 'acumulado' : SESS[ideS].label;
  const secData = useMemo(() => ({ labels: order.map(n => mm(n)), datasets: ['S1', 'S2', 'S3', 'S4'].map((s, k) => ({ label: s, data: order.map(n => isFinite(rowMap[n].sec[k]) ? +(rowMap[n].sec[k] - secBest[k]).toFixed(3) : null), backgroundColor: ['#ef4444', '#f59e0b', '#38bdf8', '#a78bfa'][k] })) }), [order, snap, ideS, view]);
  const secOpts = useMemo(() => ({ plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => `${c.dataset.label}: +${c.parsed.y.toFixed(3)} s vs mejor del campo` } } }, scales: { y: axisT('Δ vs mejor sector del campo (s)') } }), []);
  const idData = useMemo(() => ({ labels: order.map(n => mm(n)), datasets: [{ label: 'Margen real − ideal (s)', data: order.map(n => isFinite(rowMap[n].margin) ? +rowMap[n].margin.toFixed(3) : null), backgroundColor: order.map(n => RIDER[n].color) }] }), [order, snap, ideS, view]);
  const idOpts = useMemo(() => ({ indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: axisT('Segundos perdidos por no encadenar los mejores sectores') } }), []);

  const spData = useMemo(() => ({ labels: order.map(n => mm(n)), datasets: avail.filter(s => NUMS.some(n => (spm === 'max' ? A[n].vmaxBy : A[n].vtop5By)[s])).map((s, i) => ({ label: SESS[s].label, data: order.map(n => +((spm === 'max' ? A[n].vmaxBy : A[n].vtop5By)[s] || 0).toFixed(1) || null), backgroundColor: ['#64748b', '#ef4444', '#f59e0b', '#38bdf8', '#34d399', '#a78bfa', '#f472b6'][i % 7] })) }), [order, snap, view, spm]);
  const spVals = spData.datasets.flatMap(d => d.data.filter(Boolean));
  const spOpts = useMemo(() => ({ plugins: { legend: { position: 'bottom' } }, scales: { y: { min: Math.floor(Math.min(...spVals, 330) - 3), ...axisT('km/h') } } }), [snap, order, view, spm]);

  const SECN = ['S1', 'S2', 'S3', 'S4'];
  return <div className="space-y-4">
    <Panel title="Evolución de vuelta (depurada)" sess={sessTag(cur)} right={<>
      <label className="text-[11px] text-slate-400 flex items-center gap-1.5"><input type="checkbox" className="accent-red-600" checked={showDis} onChange={e => setShowDis(e.target.checked)} />mostrar out/in/lentas (◇)</label>
      <Badge real={SD[cur].real} /></>}>
      {SD[cur].real && SD[cur].official && SD[cur].official.cond && <div className="text-[11px] text-slate-400 mb-2">☀ Condiciones oficiales de {SESS[cur].label}: <b className="text-slate-200">{condTxt(SD[cur].official.cond)}</b></div>}
      {order.length ? <ChartCanvas type="scatter" data={lapData} options={lapOpts} height={340} /> : <Empty />}
      <p className="text-[11px] text-slate-500 mt-2">● vuelta válida · <span className="text-red-400">✕</span> anulada (bandera/límites de pista) · ◇ out/in-lap o &gt;107% (opcional). {lapData.cut > 0 && `${lapData.cut} vueltas fuera de escala/descartadas no dibujadas.`}</p>
    </Panel>
    <FastSeq sid={cur} view={view} />
    <RaceControl sid={cur} />
    <Panel title="Vuelta ideal por sesión" sess={ideS === 'ALL' ? 'Σ ' + avail.map(x => SESS[x].label).join(' + ') : sessTag(ideS)} right={<div className="flex flex-wrap gap-1.5"><Chip active={ideS === 'ALL'} onClick={() => setIde('ALL')}>Σ Fin de semana</Chip>{avail.map(s => <Chip key={s} active={s === ideS} onClick={() => setIde(s)}>{SESS[s].label}</Chip>)}</div>}>
      <p className="text-[11px] text-slate-500 mb-3 leading-relaxed">Ideal = suma de los <b className="text-slate-300">mejores sectores de cada piloto</b> ({ideTag}), aunque salgan de vueltas distintas. Parte de los <b className="text-slate-300">Best Partial Times oficiales</b> y solo los admite si una vuelta limpia del Analysis los confirma (out-laps, in-laps «P» y tiempos anulados «*» no cuentan; un parcial subrayado fue sustituido por el mejor parcial limpio). Un piloto con <b className="text-slate-300">≤ 4 vueltas</b> en la sesión (suma de todas sus runs) <b className="text-slate-300">no se tiene en cuenta</b> en esa sesión.</p>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
        <div><div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Sectores: pérdida vs mejor del campo ({ideTag})</div>{order.length ? <ChartCanvas type="bar" data={secData} options={secOpts} height={260} /> : <Empty />}</div>
        <div><div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Margen real − ideal ({ideTag})</div>{order.length ? <ChartCanvas type="bar" data={idData} options={idOpts} height={260} /> : <Empty />}</div>
      </div>
      <div className="overflow-x-auto"><table className="w-full text-xs tabular-nums">
        <thead><tr className="text-left text-slate-500 border-b border-[#1f2630]"><th className="py-1.5 pr-3">Piloto</th>{SECN.map(s => <th key={s} className="pr-3">{s}</th>)}<th className="pr-3">Ideal</th>{hasOff && <th className="pr-3" title="Best Partial Times (PDF oficial)">IT oficial</th>}<th className="pr-3">Mejor real</th><th className="pr-3">Margen</th><th className="pr-3">Vueltas</th><th className="pr-3">Válidas</th><th className="pr-3">Out</th><th className="pr-3">In</th><th className="pr-3">Anul.</th><th>&gt;107%</th></tr></thead>
        <tbody>{order.map(n => { const r = rowMap[n]; return r.ex > 0
          ? <tr key={n} className="border-b border-[#161c25] opacity-60"><td className="py-1.5 pr-3 whitespace-nowrap"><Dot n={n} /> <span className="ml-1 text-slate-300">{mm(n)}</span></td><td colSpan={11} className="text-amber-300/80">No se tiene en cuenta: solo {r.ex} {r.ex === 1 ? 'vuelta' : 'vueltas'} en {ideTag} (≤ 4)</td></tr>
          : <tr key={n} className="border-b border-[#161c25] hover:bg-[#141a22]">
            <td className="py-1.5 pr-3 whitespace-nowrap"><Dot n={n} /> <span className="ml-1 text-slate-200">{mm(n)}</span></td>
            {r.sec.map((v, k) => <td key={k} title={(r.flagged || []).includes(k) ? 'El parcial oficial salió de una out/in-lap o vuelta anulada: se usa el mejor parcial de vuelta limpia' : ''} className={'pr-3 ' + (v === secBest[k] ? 'text-fuchsia-400 font-bold' : 'text-slate-300') + ((r.flagged || []).includes(k) ? ' underline decoration-dotted decoration-amber-400' : '')}>{isFinite(v) ? v.toFixed(3) : '—'}</td>)}
            <td className="pr-3 text-amber-300 font-bold">{fmtLap(r.ideal)}</td>
            {hasOff && <td className="pr-3 text-slate-400">{r.off ? fmtLap(r.off) : '—'}{r.off && Math.abs(r.ideal - r.off) > 0.0015 && <span className="text-amber-300"> +{(r.ideal - r.off).toFixed(3)}</span>}</td>}<td className="pr-3 text-slate-200">{fmtLap(r.best)}</td><td className="pr-3 text-slate-400">{isFinite(r.margin) ? '+' + r.margin.toFixed(3) : '—'}</td>
            <td className="pr-3 text-slate-400">{r.n}</td><td className="pr-3 text-emerald-400">{r.clean}</td><td className="pr-3 text-slate-500">{r.OUT}</td><td className="pr-3 text-slate-500">{r.IN}</td><td className="pr-3 text-red-400">{r.ANU}</td><td className="text-slate-500">{r.LENTA}</td></tr>; })}</tbody>
      </table></div>
      {!order.length && <Empty />}
    </Panel>
    <EventSpeed M={M} />
    <Panel title="Velocidad punta por sesión" sess={avail.map(x => SESS[x].label).join(' · ')} right={<div className="flex gap-1.5"><Chip active={spm === 'max'} onClick={() => setSpm('max')}>Máxima</Chip><Chip active={spm === 'top5'} onClick={() => setSpm('top5')}>Media Top 5</Chip></div>}>{order.length ? <ChartCanvas type="bar" data={spData} options={spOpts} height={300} /> : <Empty />}</Panel>
  </div>;
}
function EventSpeed({ M }) {
  const ev = DATA.event && DATA.event.evtspd; if (!ev) return null;
  const rows = Object.entries(ev).filter(([n, v]) => RIDER[n] && M.sessions.includes(v.sid)).sort((a, b) => b[1].kmh - a[1].kmh);
  if (!rows.length) return null;
  const rec = DATA.circuit.records && DATA.circuit.records.vmax, top = rows[0][1].kmh, lo = Math.min(...rows.map(r => r[1].kmh)) - 4;
  return <Panel title="Punta del evento (mejor de cada piloto)" sess={M.sessions.map(x => SESS[x].label).join(' · ')} right={<span className="text-[11px] text-slate-500">Event Best Maximum Speed · {rec ? `récord ${rec.kmh.toFixed(1)} km/h (${rec.who.split(' ').pop()} ${rec.year})` : ''}</span>}>
    <div className="space-y-1">{rows.map(([n, v]) => <div key={n} className="flex items-center gap-2 text-xs"><span className="w-28 truncate text-slate-200"><Dot n={+n} /> {mm(+n)}</span>
      <div className="flex-1 h-3 bg-[#0d1117] rounded overflow-hidden"><div className="h-full" style={{ width: (100 * (v.kmh - lo) / (top - lo)) + '%', background: RIDER[n].color }} /></div>
      <span className="w-16 tabular-nums text-slate-100 text-right">{v.kmh.toFixed(1)}</span><span className="w-14 text-slate-500">{v.sid ? SESS[v.sid].label : '—'}</span></div>)}</div>
    <p className="text-[11px] text-slate-500 mt-2">Solo se muestran las puntas conseguidas en sesiones del hito seleccionado. Sirve de control cruzado con la punta que sale de cada Analysis y con el récord del circuito.</p>
  </Panel>;
}
function FastSeq({ sid, view }) {
  const fast = SD[sid].official && SD[sid].official.fast;
  const data = useMemo(() => fast && fast.length ? { datasets: [{ label: 'Nueva vuelta rápida de la sesión', data: fast.map(f => ({ x: +(f.at / 60).toFixed(2), y: f.t, n: f.num, lap: f.lap, kmh: f.kmh })), stepped: 'before', showLine: true, borderColor: '#64748b', borderWidth: 1.5,
    pointBackgroundColor: fast.map(f => RIDER[f.num] ? RIDER[f.num].color : '#fff'), pointRadius: 6, pointHoverRadius: 8 }] } : null, [sid, view]);
  const opts = useMemo(() => ({ parsing: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `#${c.raw.n} ${mm(c.raw.n)} · ${fmtLap(c.raw.y)} · vuelta ${c.raw.lap} · ${c.raw.kmh} km/h` } } },
    scales: { x: { type: 'linear', ...axisT('Minuto de sesión') }, y: { ...axisT('Mejor vuelta de la sesión'), ticks: { callback: v => fmtLap(v) } } } }), []);
  return <Panel title="Evolución cronológica de la sesión (Fastest Laps Sequence)" sess={sessTag(sid)} right={<Badge real={SD[sid].real} />}>
    {data ? <><ChartCanvas type="scatter" data={data} options={opts} height={230} />
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-slate-400">{fast.map((f, i) => <span key={i}><Dot n={f.num} /> {mm(f.num)} <b className="text-slate-200 tabular-nums">{fmtLap(f.t)}</b> <span className="text-slate-600">min {(f.at / 60).toFixed(1)}</span></span>)}</div></>
      : <div className="text-sm text-slate-500 py-4">Disponible para sesiones reales con el PDF «Fastest Laps Sequence» en su carpeta de {CIRC.folder}/.</div>}
  </Panel>;
}
const EXTRA = [['grid', 'Grid'], ['qres', 'Q.Results'], ['comb', 'Combined'], ['fastrider', 'Fast Lap Rider'], ['lapchart', 'Lap Chart'], ['bylap', 'By Lap']];
function RaceControl({ sid }) {
  const o = SD[sid].real && SD[sid].official, ev = (o && o.events) || [], lc = o && o.lapchart;
  if (!ev.length && !lc) return null;
  const res = Object.fromEntries((SD[sid].results || []).map(r => [r.num, r]));
  const rows = lc && lc.grid ? lc.grid.map((n, i) => { const p1 = lc.laps[0] ? lc.laps[0].indexOf(n) + 1 : 0, fin = res[n]; return { n, g: i + 1, p1, d1: p1 ? (i + 1) - p1 : null, fin: fin && fin.status !== 'DNF' ? fin.pos : null, laps: fin ? fin.laps : null }; }) : [];
  const notable = ev.filter(e => e.kind !== 'info' || /flag|jump|start/i.test(e.text));
  return <Panel title="Dirección de carrera y salida" sess={sessTag(sid)} right={<Badge real />}>
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <div><div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Cronología oficial (bajo la Classification)</div>
        <ul className="text-xs space-y-1">{notable.map((e, i) => <li key={i} className={EV_CLS[e.kind]}><span className="text-slate-600 tabular-nums mr-2">{e.at}</span>{e.num && <><Dot n={e.num} /> </>}{evTxt(e)}</li>)}</ul>
        {!ev.some(e => ['crash', 'retire', 'pit', 'penalty'].includes(e.kind)) && <div className="text-xs text-slate-500 mt-2">Sin incidentes de pilotos registrados.</div>}</div>
      {rows.length > 0 && <div className="overflow-x-auto"><div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Salida y posiciones (Lap Chart)</div>
        <table className="w-full text-xs tabular-nums"><thead><tr className="text-left text-slate-500 border-b border-[#1f2630]"><th className="py-1 pr-3">Piloto</th><th className="pr-3">Parr.</th><th className="pr-3">Tras V1</th><th className="pr-3">Salida</th><th className="pr-3">Final</th><th>Total</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.n} className="border-b border-[#161c25]"><td className="py-1 pr-3 whitespace-nowrap"><Dot n={r.n} /> <span className="ml-1 text-slate-200">{mm(r.n)}</span></td><td className="pr-3 text-slate-400">{r.g}</td><td className="pr-3 text-slate-300">{r.p1 || '—'}</td>
            <td className={'pr-3 font-semibold ' + (r.d1 > 0 ? 'text-emerald-400' : r.d1 < 0 ? 'text-red-400' : 'text-slate-500')}>{r.d1 == null ? '—' : r.d1 > 0 ? '+' + r.d1 : r.d1}</td>
            <td className="pr-3 font-bold text-slate-100">{r.fin || 'DNF'}</td><td className={r.fin ? (r.g - r.fin > 0 ? 'text-emerald-400' : r.g - r.fin < 0 ? 'text-red-400' : 'text-slate-500') : 'text-red-400'}>{r.fin ? (r.g - r.fin > 0 ? '+' : '') + (r.g - r.fin) : `${r.laps} vtas`}</td></tr>)}</tbody></table>
        <p className="text-[11px] text-slate-500 mt-2">«Salida» = puestos ganados (+) o perdidos (−) en la vuelta 1 respecto a la parrilla; «Total» = parrilla − posición final.</p></div>}
    </div>
  </Panel>;
}
function DocsPanel({ M }) {
  const COLS = [['analysis', 'Analysis'], ['class', 'Classification'], ['best', 'Best Partial'], ['maxspd', 'Max Speed'], ['avgspd', 'Top&Avg'], ['fast', 'Fastest Laps']];
  return <Panel title="Trazabilidad de datos por sesión" sess="todas las sesiones" right={<span className="text-[11px] text-slate-500">{CIRC.folder}/&lt;sesión&gt;/ · {DATA.meta.built}</span>}>
    <div className="overflow-x-auto"><table className="w-full text-xs">
      <thead><tr className="text-left text-slate-500 border-b border-[#1f2630]"><th className="py-1.5 pr-3">Sesión</th><th className="pr-3">Origen</th>{COLS.map(([k, l]) => <th key={k} className="pr-3 whitespace-nowrap">{l}</th>)}<th className="pr-3">Condiciones</th><th className="pr-3">Otros informes</th><th>Validación cruzada vs Analysis</th></tr></thead>
      <tbody>{SIDS_ALL.map(s => { const real = SD[s].real && DATA.meta.real.includes(s), docs = (DATA.meta.docs || {})[s] || {}, v = (DATA.meta.validation || {})[s] || {};
        return <tr key={s} className={'border-b border-[#161c25] ' + (M.sessions.includes(s) ? '' : 'opacity-40')}>
          <td className="py-1.5 pr-3 font-bold text-slate-100">{SESS[s].label}</td><td className="pr-3"><Badge real={real} /></td>
          {COLS.map(([k]) => <td key={k} className="pr-3" title={docs[k] || ''}>{real ? (docs[k] ? <span className="text-emerald-400">✓</span> : <span className="text-slate-600">—</span>) : <span className="text-slate-700">·</span>}</td>)}
          <td className="pr-3 text-[11px] text-slate-400 whitespace-nowrap">{real && SD[s].official && SD[s].official.cond ? `${COND_ES[SD[s].official.cond.cond] || SD[s].official.cond.cond} · ${SD[s].official.cond.air}°/${SD[s].official.cond.ground}° · ${SD[s].official.cond.hum}%` : '—'}</td>
          <td className="pr-3 text-[11px] text-slate-400" title={EXTRA.map(([k]) => docs[k]).filter(Boolean).join(' · ')}>{real ? EXTRA.filter(([k]) => docs[k]).map(([, l]) => l).join(' · ') || '—' : '·'}</td>
          <td className="text-[11px] text-slate-400">{real ? [v.cls && `Classification ${v.cls}`, v.ideal && `ideal oficial = depurado ${v.ideal}`, v.speed && `Vmax ${v.speed}`, v.fastrider && `Fast Lap Rider ${v.fastrider}`, v.qres && `Qualifying Results ${v.qres}`, v.winner && `tiempo del ganador = Σ vueltas ${v.winner}`].filter(Boolean).join(' · ') || '—' : 'simulada hasta que se suba su carpeta'}</td></tr>; })}</tbody>
    </table></div>
    {DATA.meta.eventDocs && Object.keys(DATA.meta.eventDocs).length > 0 && <div className="mt-3 text-[11px] text-slate-400"><b className="text-sky-300">Documentos del evento</b> · {Object.entries(DATA.meta.eventDocs).map(([k, v]) => `${{ entry: 'Entry List', bio: 'Rider Statistics', circuit: 'Circuit Information', evtspd: 'Event Max Speed' }[k] || k} (${v})`).join(' · ')}{DATA.event && DATA.event.outOfEvent && Object.keys(DATA.event.outOfEvent).length > 0 ? ` · fuera del evento (sustituidos): ${Object.entries(DATA.event.outOfEvent).map(([n, nm]) => `${nm || ''} #${n}`).join(', ')}` : ''}</div>}
    {DATA.grids && Object.keys(DATA.grids).length > 0 && <div className="mt-3 text-[11px] text-slate-400 space-y-1">{Object.entries(DATA.grids).map(([k, g]) => { const mv = Object.entries(g.pen || {}).filter(([, d]) => d); const abs = NUMS.filter(n => !Object.values(DATA.grids).some(x => x.order.includes(n)));
      return <div key={k}><b className="text-sky-300">Parrilla {k === 'SPR' ? 'Sprint' : 'Carrera'}</b> · {g.doc} · {g.order.length} pilotos · {g.laps || '?'} vueltas · {mv.length ? 'cambios vs clasificación: ' + mv.map(([n, d]) => `${mm(+n)} ${d > 0 ? '▼' + d : '▲' + (-d)}`).join(', ') : 'sin cambios respecto a la clasificación (sin sanciones de parrilla)'}{abs.length > 0 && k === Object.keys(DATA.grids)[0] ? ` · no toman la salida: ${abs.map(n => mm(n) + ' #' + n).join(', ')}` : ''}</div>; })}</div>}
    <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">Cada piloto hereda su ritmo y sectores del <b className="text-slate-300">Analysis</b> (filtrado de out-laps, in-laps «P» y anuladas «*»), su vuelta ideal de los <b className="text-slate-300">Best Partial Times</b> (solo parciales confirmados por una vuelta limpia), su punta del <b className="text-slate-300">Top Speed</b> y la media de sus 5 mejores del <b className="text-slate-300">Top Speed &amp; Average</b>. La <b className="text-slate-300">Classification</b> fija resultados y orden de parrilla y el <b className="text-slate-300">Fastest Laps Sequence</b> la evolución de la sesión. «ideal oficial = depurado k/n»: en n pilotos el ideal oficial coincide con el recalculado solo con vueltas limpias; en el resto algún parcial oficial viene de una out/in-lap o de una vuelta anulada.</p>
  </Panel>;
}
function Empty() { return <div className="text-center text-slate-500 text-sm py-10">Selecciona al menos un piloto en el panel lateral.</div>; }

/* ---------- TAB: Ritmo & Simulación ---------- */
function Ritmo({ snap, M, sel, target, setTarget }) {
  const rows = tgtRows(snap, target).rows, known = tgtRows(snap, target).known;
  const [sortK, setSortK] = useState('pos'), [asc, setAsc] = useState(true);
  const A = snap.A;
  const data = rows.map(r => Object.assign({}, r, { name: mm(r.num), ideal: A[r.num].ideal, best: A[r.num].best, margin: A[r.num].margin, vmax: A[r.num].vmax }));
  const sorted = [...data].sort((a, b) => { const x = a[sortK], y = b[sortK]; const c = (typeof x === 'string') ? x.localeCompare(y) : ((x ?? 1e9) - (y ?? 1e9)); return asc ? c : -c; });
  const th = (k, l, cls = '') => <th className={'pr-3 py-1.5 cursor-pointer select-none hover:text-white ' + cls} onClick={() => { if (sortK === k) setAsc(!asc); else { setSortK(k); setAsc(true); } }}>{l}{sortK === k ? (asc ? ' ▲' : ' ▼') : ''}</th>;

  // stint scatter (practice stints ≥3 laps normalised) for selected riders
  const stData = useMemo(() => {
    const ds = [];
    for (const n of sel) {
      const stints = snap.A[n].stP.filter(s => s.len >= 3);
      if (!stints.length) continue;
      const ordered = [...stints].sort((a, b) => b.len - a.len || a.med - b.med);
      const s = ordered[0];
      ds.push({ type: 'scatter', label: `#${n} ${mm(n)} · ${s.len} vtas (${SESS[s.sid].label})`, data: s.tn.map((y, i) => ({ x: i + 1, y })), backgroundColor: RIDER[n].color, borderColor: RIDER[n].color, pointRadius: 4, showLine: false });
      ds.push({ type: 'line', label: `reg #${n}`, data: [0, s.len - 1].map(i => ({ x: i + 1, y: s.a + s.b * i })), borderColor: RIDER[n].color, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, fill: false });
    }
    return { datasets: ds };
  }, [snap, sel]);
  const stOpts = useMemo(() => ({ parsing: false, plugins: { legend: { position: 'bottom', labels: { filter: i => !i.text.startsWith('reg') } } }, scales: { x: { type: 'linear', ...axisT('Vuelta de la tanda'), ticks: { precision: 0 } }, y: { ...axisT('Tiempo normalizado (neumático Medium, nivel de pista de referencia)'), ticks: { callback: v => fmtLap(v) } } } }), []);

  const sel2 = rows.filter(r => sel.includes(r.num));
  const gapData = useMemo(() => ({ labels: sel2.map(r => mm(r.num)), datasets: [{ label: 'Gap predicho al ganador (s)', data: sel2.map(r => +(r.gap || 0).toFixed(3)), backgroundColor: sel2.map(r => RIDER[r.num].color) }] }), [snap, target, sel]);
  const gapOpts = useMemo(() => ({ indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: axisT(target === 'POLE' ? 'Δ a la pole (s)' : 'Δ al ganador (s)') } }), [target]);
  const degRows = target === 'POLE' ? [] : sel2.filter(r => r.deg != null);
  const degData = useMemo(() => ({ labels: degRows.map(r => mm(r.num)), datasets: [{ label: 'Degradación proyectada (s/vuelta)', data: degRows.map(r => +(r.deg).toFixed(4)), backgroundColor: degRows.map(r => RIDER[r.num].color) }] }), [snap, target, sel]);
  const degOpts = useMemo(() => ({ plugins: { legend: { display: false } }, scales: { y: axisT('s/vuelta') } }), []);

  const desc = { POLE: 'Mejor vuelta normalizada − 0,4·margen vs ideal + 0,35·σ(3 mejores) + penalización por pocas vueltas.',
    SPR: 'Mediana de la mejor tanda corta (5-8 vtas, normalizada a Medium) + σ + degradación proyectada ×' + DATA.circuit.sprintLaps + ' vueltas + parrilla (oficial si hay Grid.pdf) y punta + prior leve por clasificación del Mundial 2025 (' + PRIOR_WC + ' s/vta por puesto).',
    RAC: 'Ritmo de tanda larga (>8 vtas) + degradación por regresión lineal proyectada ×' + DATA.circuit.raceLaps + ' vueltas + parrilla (oficial si hay Grid.pdf) y velocidad punta en recta.' }[target];
  return <div className="space-y-4">
    <Panel title="Simulación" sess={'objetivo ' + TLBL[target]} right={<div className="flex gap-1.5">{TARGETS.map(([t, l]) => <Chip key={t} active={t === target} onClick={() => setTarget(t)}>{l}</Chip>)}</div>}>
      <p className="text-xs text-slate-400 mb-3 leading-relaxed"><b className="text-slate-200">Modelo:</b> {desc} {known && <span className="text-emerald-400 font-semibold"> · Este objetivo ya es resultado real (simulado) en este hito.</span>}</p>
      <div className="overflow-x-auto"><table className="w-full text-xs tabular-nums">
        <thead><tr className="text-left text-slate-500 border-b border-[#1f2630]">{th('pos', 'Pos')}{th('name', 'Piloto')}{th('T', target === 'POLE' ? 'Vuelta proy.' : 'Tiempo')}{th('gap', 'Gap')}
          {target !== 'POLE' && <>{th('pace', 'Ritmo s/vta')}{th('sd', 'σ')}{th('deg', 'Degr.')}{th('grid', 'Parr.')}</>}{th('ideal', 'Ideal')}{th('best', 'Mejor')}{th('vmax', 'V.max')}{!known && th('conf', 'Conf.')}</tr></thead>
        <tbody>{sorted.map(r => <tr key={r.num} className={'border-b border-[#161c25] hover:bg-[#141a22] ' + (sel.includes(r.num) ? 'bg-[#131922]' : '')}>
          <td className="py-1.5 pr-3 font-bold text-slate-300">{r.pos}</td>
          <td className="pr-3 whitespace-nowrap"><Dot n={r.num} /> <span className="ml-1 text-slate-100">{r.name}</span> <span className="text-slate-600">#{r.num}</span>{r.status === 'DNF' && <span className="ml-1 text-red-400 font-bold">DNF</span>}</td>
          <td className="pr-3 text-slate-100">{r.T != null ? (target === 'POLE' ? fmtLap(r.T) : fmtTime(r.T)) : '—'}</td><td className="pr-3 text-slate-400">{r.gap != null ? fmtGap(r.gap) : (r.T != null && target === 'POLE' ? fmtGap(r.T - rows[0].T) : '—')}</td>
          {target !== 'POLE' && <><td className="pr-3">{r.pace ? fmtTime(r.pace) : '—'}</td><td className="pr-3 text-slate-400">{r.sd != null ? r.sd.toFixed(3) : '—'}</td><td className="pr-3 text-slate-400">{r.deg != null ? r.deg.toFixed(3) : '—'}</td><td className="pr-3 text-slate-400">{r.grid || '—'}</td></>}
          <td className="pr-3 text-amber-300">{fmtLap(r.ideal)}</td><td className="pr-3">{fmtLap(r.best)}</td><td className="pr-3 text-slate-400">{r.vmax ? r.vmax.toFixed(1) : '—'}</td>
          {!known && <td className="pr-3"><Conf v={r.conf} /></td>}</tr>)}</tbody>
      </table></div>
      {target !== 'POLE' && !known && <p className="text-[11px] text-slate-500 mt-2">Base de la estimación: {Object.entries(rows.reduce((o, r) => { const m = (r.mode || '').split('+')[0]; o[m] = (o[m] || 0) + 1; return o; }, {})).map(([k, v]) => `${v} pilotos con «${MODE[k] || k}»`).join(' · ')}. Las tandas largas (&gt;8) llegan con FP2 el sábado; el viernes se usa tanda corta con baja confianza.</p>}
    </Panel>
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <Panel title="Tandas reales y degradación (pilotos seleccionados)">{sel.length ? <ChartCanvas type="scatter" data={stData} options={stOpts} height={320} /> : <Empty />}</Panel>
      <div className="space-y-4">
        <Panel title="Gap predicho (seleccionados)" sess={'objetivo ' + TLBL[target]}>{sel2.length ? <ChartCanvas type="bar" data={gapData} options={gapOpts} height={150 + sel2.length * 12} /> : <Empty />}</Panel>
        {target !== 'POLE' && <Panel title="Degradación proyectada" sess={'objetivo ' + TLBL[target]}>{degRows.length ? <ChartCanvas type="bar" data={degData} options={degOpts} height={170} /> : <Empty />}</Panel>}
      </div>
    </div>
  </div>;
}

/* ---------- TAB: Predicción vs Realidad ---------- */
function Gauge({ pct, label, sub }) {
  const c = pct >= 67 ? '#34d399' : pct >= 34 ? '#fbbf24' : '#f87171', r = 34, L = 2 * Math.PI * r;
  return <div className="flex items-center gap-3">
    <svg width="84" height="84" viewBox="0 0 84 84"><circle cx="42" cy="42" r={r} fill="none" stroke="#1d232c" strokeWidth="8" />
      <circle cx="42" cy="42" r={r} fill="none" stroke={c} strokeWidth="8" strokeDasharray={`${L * pct / 100} ${L}`} strokeLinecap="round" transform="rotate(-90 42 42)" />
      <text x="42" y="47" textAnchor="middle" fill="#fff" fontWeight="800" fontSize="17">{pct}%</text></svg>
    <div><div className="text-xs font-bold text-slate-200">{label}</div><div className="text-[11px] text-slate-500">{sub}</div></div></div>;
}
function TopChips({ top, ref3 }) {
  return <div className="flex flex-wrap gap-1">{top.map((n, i) => {
    const hit = ref3 ? (ref3[i] === n ? 'exact' : ref3.includes(n) ? 'set' : 'miss') : null;
    const cls = hit === 'exact' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50' : hit === 'set' ? 'bg-amber-500/15 text-amber-300 border-amber-500/40' : hit === 'miss' ? 'bg-red-500/10 text-red-300 border-red-500/30' : 'bg-[#161c25] text-slate-200 border-[#2a313c]';
    return <span key={n} className={'text-[11px] font-semibold px-1.5 py-0.5 rounded border ' + cls}>{i + 1}. {mm(n)}</span>;
  })}</div>;
}
function Precision({ M, sel, view }) {
  const mi = MILESTONES.findIndex(m => m.id === M.id);
  const at = id => MILESTONES.findIndex(m => m.id === id);
  const resolved = { POLE: true, SPR: true, RAC: true };                                                    // reality always exists: real PDFs, or the simulation until they are uploaded
  const realSim = { POLE: !SD.Q2.real, SPR: !SD.SPR.real, RAC: !SD.RAC.real };
  const allIdx = { POLE: ['FRI', 'SAM'], SPR: ['FRI', 'SAM', 'SAT'], RAC: ['FRI', 'SAM', 'SAT', 'SPR'] };    // photos taken BEFORE each result
  const snapIdx = Object.fromEntries(Object.entries(allIdx).map(([t, ids]) => [t, ids.filter(id => at(id) <= mi)]));   // only what was known at the selected milestone
  const [tg, setTg] = useState('SPR'), [snapSel, setSnapSel] = useState(null);
  const tgt = tg;
  const accs = useMemo(() => Object.fromEntries(['POLE', 'SPR', 'RAC'].map(t => [t, snapIdx[t].map(id => accuracy(t, id))])), [M.id, view]);
  const cur = accs[tgt] || [];
  const last = cur[cur.length - 1];
  const realRef = { POLE: SNAP.SAT.pole, SPR: SNAP.SPR.sprint, RAC: SNAP.RAC.race }[tgt];

  const evoData = useMemo(() => ({ labels: cur.map(a => MILESTONES.find(m => m.id === a.snapId).short), datasets: [
    { type: 'bar', label: '% acierto Top 3', data: cur.map(a => a.pct), backgroundColor: '#ef4444', yAxisID: 'y' },
    { type: 'line', label: 'Error ritmo MAE (s/vta)', data: cur.map(a => a.mae == null ? null : +a.mae.toFixed(3)), borderColor: '#fbbf24', backgroundColor: '#fbbf24', yAxisID: 'y1', tension: 0.2 }] }), [M.id, tgt]);
  const evoOpts = useMemo(() => ({ plugins: { legend: { position: 'bottom' } }, scales: { y: { min: 0, max: 100, ...axisT('% acierto') }, y1: { position: 'right', min: 0, grid: { drawOnChartArea: false }, ...axisT('s/vuelta') } } }), []);

  const rowsSel = last ? last.rows.filter(r => sel.includes(r.num)) : [];
  const pvData = useMemo(() => ({ labels: rowsSel.map(r => mm(r.num)), datasets: [
    { label: 'Ritmo predicho', data: rowsSel.map(r => +r.predPace.toFixed(3)), backgroundColor: '#64748b' },
    { label: 'Ritmo real', data: rowsSel.map(r => +r.realPace.toFixed(3)), backgroundColor: '#ef4444' }] }), [M.id, tgt, sel]);
  const allp = pvData.datasets.flatMap(d => d.data);
  const pvOpts = useMemo(() => ({ plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmtTime(c.parsed.y)}` } } }, scales: { y: { min: allp.length ? Math.floor(Math.min(...allp) * 2) / 2 - 0.5 : 0, ticks: { callback: v => fmtTime(v) }, ...axisT('s/vuelta (normalizado Medium)') } } }), [M.id, tgt, sel]);

  if (!resolved.POLE) return <Panel title="Predicción vs Realidad"><div className="py-10 text-center text-slate-400">
    <div className="text-4xl mb-2">⏳</div><div className="font-semibold text-slate-200">Aún no hay resultados reales que comparar</div>
    <p className="text-sm mt-1 max-w-xl mx-auto">Las predicciones de cada hito quedan «fotografiadas» (viernes: {snapPreview()}). Avanza a <b>Sábado · post-Q2</b> para auditar la Pole, a <b>Post-Sprint</b> y a <b>Post-Carrera</b> para el resto.</p></div></Panel>;

  const diag = cur.find(a => a.snapId === snapSel) || last;
  const maeCol = v => v == null ? 'text-slate-500' : v < 0.15 ? 'text-emerald-400' : v < 0.35 ? 'text-amber-300' : 'text-red-400';
  const MCOLS = ['FRI', 'SAM', 'SAT', 'SPR'].filter(id => at(id) <= mi);
  const sgn = v => (v > 0 ? '+' : '') + v.toFixed(3);
  const dirTxt = d => d < 0 ? 'más lento de lo previsto' : 'más rápido de lo previsto';

  return <div className="space-y-4">
    <Panel title="Evolución del error por hito" right={<span className="text-[11px] text-slate-500">¿qué podíamos esperar con lo que sabíamos en cada momento?</span>}>
      <div className="overflow-x-auto"><table className="w-full text-xs">
        <thead><tr className="text-left text-slate-500 border-b border-[#1f2630]"><th className="py-1.5 pr-3">Objetivo</th>{MCOLS.map(id => { const m = MILESTONES.find(x => x.id === id); return <th key={id} className="pr-4 whitespace-nowrap">{m.label}<div className="font-normal text-[10px] text-slate-600">{id === 'FRI' || id === 'SAM' ? 'sin Q1/Q2 · parrilla estimada' : id === 'SAT' ? 'parrilla real' : 'con Sprint real'}</div></th>; })}</tr></thead>
        <tbody>{[['POLE', 'Pole (Q2)'], ['SPR', 'Sprint'], ['RAC', 'Carrera']].map(([t, l]) => <tr key={t} className="border-b border-[#161c25]">
          <td className="py-2 pr-3 font-bold text-slate-200 whitespace-nowrap">{l}</td>
          {MCOLS.map(id => { const a = resolved[t] && accs[t] ? accs[t].find(x => x.snapId === id) : null;
            if (!a) return <td key={id} className="pr-4 text-slate-700">{snapIdx[t].includes(id) ? 'pendiente' : '·'}</td>;
            return <td key={id} className="pr-4 py-1.5 align-top tabular-nums">
              {a.mae != null ? <div className={'font-bold ' + maeCol(a.mae)}>{a.mae.toFixed(3)} <span className="text-[10px] font-normal text-slate-500">s/vta</span></div> : <div className="font-bold text-slate-200">err. pos {a.rankErr != null ? a.rankErr.toFixed(1) : '—'}</div>}
              <div className="text-[11px] text-slate-400">Top 3 <b className="text-slate-200">{a.pct}%</b>{a.within2 != null && <> · ±2 pos <b className="text-slate-200">{a.within2}%</b></>}</div>
              {a.dnf && a.dnf.length > 0 && <div className="text-[10px] text-red-300">{a.dnf.length} no terminó</div>}</td>; })}</tr>)}
        </tbody></table></div>
      <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">MAE = error medio del ritmo por vuelta (s/vta, pilotos que terminan). «Top 3» = % del podio acertado; «±2 pos» = % de pilotos clasificados a ≤ 2 puestos de lo previsto. Las predicciones son <b className="text-slate-300">simulaciones limpias</b>: no contemplan meteo, caídas, sanciones ni bandera roja, así que la desviación que queda sin explicar apunta a ellos (ver diagnóstico más abajo).</p>
    </Panel>
    <Panel title="Fotos de predicción por hito" sess={'objetivo ' + TLBL[tgt]} right={<div className="flex gap-1.5">{TARGETS.map(([t, l]) => <Chip key={t} active={t === tgt} disabled={!resolved[t]} title={!resolved[t] ? 'Aún sin resultado real en este hito' : ''} onClick={() => setTg(t)}>{l}</Chip>)}</div>}>
      <div className="overflow-x-auto"><table className="w-full text-xs">
        <thead><tr className="text-left text-slate-500 border-b border-[#1f2630]"><th className="py-1.5 pr-3">Foto</th><th className="pr-3">Top 3 predicho</th><th className="pr-3">Podio acierto</th><th className="pr-3">Posiciones exactas</th><th className="pr-3">±2 pos</th><th className="pr-3">Orden (ρ)</th><th className="pr-3">Error ritmo (MAE)</th><th className="pr-3" title="MAE sin los pilotos atípicos">MAE sin atípicos</th><th className="pr-3">Sesgo</th><th className="pr-3">Error pos. medio</th><th>Error parrilla</th></tr></thead>
        <tbody>
          {cur.map(a => <tr key={a.snapId} className="border-b border-[#161c25]">
            <td className="py-2 pr-3 font-bold text-slate-200 whitespace-nowrap">{MILESTONES.find(m => m.id === a.snapId).label}</td>
            <td className="pr-3"><TopChips top={a.pTop} ref3={a.rTop} /></td>
            <td className="pr-3 font-bold tabular-nums">{a.overlap}/3 <span className="text-slate-500">({a.pct}%)</span></td><td className="pr-3 tabular-nums">{a.exact}/3</td>
            <td className="pr-3 tabular-nums">{a.within2 != null ? a.within2 + '%' : '—'}</td><td className="pr-3 tabular-nums">{a.rho != null ? a.rho.toFixed(2) : '—'}</td>
            <td className="pr-3 tabular-nums">{a.mae != null ? a.mae.toFixed(3) + ' s/vta' : '—'}</td><td className="pr-3 tabular-nums text-slate-400">{a.maeClean != null ? a.maeClean.toFixed(3) : '—'}</td>
            <td className="pr-3 tabular-nums">{a.bias != null ? sgn(a.bias) : '—'}</td>
            <td className="pr-3 tabular-nums">{a.rankErr != null ? a.rankErr.toFixed(2) : '—'}</td><td className="tabular-nums text-slate-400">{a.gridErr != null ? a.gridErr.toFixed(1) + ' pos' : '—'}</td></tr>)}
          <tr className="bg-[#0d1117]"><td className="py-2 pr-3 font-bold text-emerald-300">REALIDAD {tgt === 'POLE' ? '(Q2)' : tgt === 'SPR' ? '(Sprint)' : '(Carrera)'}{realSim[tgt] && <span className="ml-1 text-[10px] font-normal text-amber-300">· simulada, aún sin PDFs</span>}</td><td className="pr-3" colSpan={10}><TopChips top={realRef.rows.slice(0, 3).map(r => r.num)} /></td></tr>
        </tbody></table></div>
      <p className="text-[11px] text-slate-500 mt-2"><span className="text-emerald-300">Verde</span> posición exacta · <span className="text-amber-300">ámbar</span> en el podio pero otra posición · <span className="text-red-300">rojo</span> fallo. «Sesgo» positivo = ritmo predicho más lento que el real. «Error parrilla» = puestos de diferencia entre la parrilla estimada y la oficial (solo antes de Q2).</p>
    </Panel>
    {diag && <Panel title="Predicho vs real por piloto" sess={'objetivo ' + TLBL[tgt]} right={<div className="flex gap-1.5 flex-wrap">{cur.map(a => <Chip key={a.snapId} active={a.snapId === diag.snapId} onClick={() => setSnapSel(a.snapId)}>{'Foto ' + MILESTONES.find(m => m.id === a.snapId).short}</Chip>)}</div>}>
      {(() => { const pr = tgtRows(SNAP[diag.snapId], tgt).rows, rl = realRef.rows, rm = Object.fromEntries(rl.map(r => [r.num, r])), rows = pr.map(p => ({ p, r: rm[p.num] })).filter(x => x.r);
        const pace = Object.fromEntries(diag.rows.map(x => [x.num, x]));
        return <div className="overflow-x-auto"><table className="w-full text-xs tabular-nums">
          <thead><tr className="text-left text-slate-500 border-b border-[#1f2630]"><th className="py-1.5 pr-3">Piloto</th><th className="pr-3">Pos. predicha</th><th className="pr-3">Pos. real</th><th className="pr-3">Δ pos</th>{tgt === 'POLE' ? <><th className="pr-3">Vuelta predicha</th><th className="pr-3">Vuelta real</th><th>Δ s</th></> : <><th className="pr-3">Ritmo predicho</th><th className="pr-3">Ritmo real</th><th>Δ s/vta</th></>}</tr></thead>
          <tbody>{rows.map(({ p, r }) => { const dp = p.pos - r.pos, x = pace[p.num], dnf = r.status === 'DNF';
            return <tr key={p.num} className="border-b border-[#161c25]"><td className="py-1 pr-3 whitespace-nowrap"><Dot n={p.num} /> <span className="ml-1 text-slate-200">{mm(p.num)}</span></td><td className="pr-3 text-slate-400">{p.pos}</td><td className="pr-3 font-bold text-slate-100">{dnf ? 'DNF' : r.pos}</td>
              <td className={'pr-3 font-semibold ' + (dnf ? 'text-red-400' : dp === 0 ? 'text-emerald-400' : Math.abs(dp) <= 2 ? 'text-amber-300' : 'text-red-400')}>{dnf ? '—' : dp === 0 ? '=' : (dp > 0 ? '+' : '') + dp}</td>
              {tgt === 'POLE' ? <><td className="pr-3 text-slate-400">{p.T ? fmtLap(p.T) : '—'}</td><td className="pr-3 text-slate-200">{r.T ? fmtLap(r.T) : '—'}</td><td className="text-slate-400">{p.T && r.T ? sgn(p.T - r.T) : '—'}</td></>
                : <><td className="pr-3 text-slate-400">{x ? fmtTime(x.predPace) : '—'}</td><td className="pr-3 text-slate-200">{x ? fmtTime(x.realPace) : '—'}</td><td className={x ? (Math.abs(x.d) > 0.5 ? 'text-red-400' : 'text-slate-400') : 'text-slate-600'}>{x ? sgn(x.d) : '—'}</td></>}</tr>; })}</tbody></table></div>; })()}
      <p className="text-[11px] text-slate-500 mt-2">Δ pos = posición predicha − real (positivo: se esperaba peor puesto del que consiguió). Δ vuelta/ritmo = predicho − real (negativo: se predijo más rápido de lo que fue).</p>
    </Panel>}
    {diag && diag.rows.length > 0 && <Panel title="Diagnóstico de la desviación" sess={'objetivo ' + TLBL[tgt]} right={<div className="flex gap-1.5 flex-wrap">{cur.map(a => <Chip key={a.snapId} active={a.snapId === diag.snapId} onClick={() => setSnapSel(a.snapId)}>{MILESTONES.find(m => m.id === a.snapId).short}</Chip>)}</div>}>
      <div className="space-y-3 text-[13px] leading-relaxed">
        <div className="text-slate-300">{diag.common && diag.common.strong
          ? <><b className="text-amber-300">Desfase común del campo:</b> el ritmo de carrera fue de media <b className="tabular-nums">{Math.abs(diag.common.bias).toFixed(3)} s/vta {dirTxt(diag.common.bias)}</b> y el {Math.round(diag.common.share * 100)}% de los pilotos se desvió en el mismo sentido. Es la huella de algo que afecta a todos y que la simulación limpia no contempla (temperatura/agarre de pista, lluvia o pista mojada a tramos, neumático distinto al supuesto, bandera roja o distancia distinta).</>
          : <><b className="text-emerald-300">Sin desfase común relevante</b> (sesgo {diag.bias != null ? sgn(diag.bias) : '—'} s/vta): el nivel global del campo estaba bien calibrado; el error que hay es individual.</>}</div>
        {diag.gridErr != null && diag.gridErr > 0 && <div className="text-slate-400">La parrilla estimada falló de media <b className="text-slate-200 tabular-nums">{diag.gridErr.toFixed(1)} puestos</b> respecto a la oficial: parte de la desviación de esta foto viene de no conocer aún Q1/Q2.</div>}
        {diag.cond && <div className="text-slate-400"><b className="text-sky-300">Meteo (oficial):</b> {SESS[diag.target].label} con <b className="text-slate-200">{condTxt(diag.cond.target)}</b>. Pista en las sesiones del hito: {diag.cond.refs.map(x => `${SESS[x.sid].label} ${x.c.ground}°`).join(' · ')}{diag.cond.dGround != null && Math.abs(diag.cond.dGround) >= 3 ? <> — <b className="text-amber-300">{diag.cond.dGround > 0 ? '+' : ''}{diag.cond.dGround}° respecto a la última sesión previa</b>: {diag.cond.dGround > 0 ? 'más calor, más degradación y menos agarre del previsto.' : 'más fresco, menos degradación de la prevista.'}</> : ' — sin cambio térmico relevante (≤ 3°).'}</div>}
        {diag.dnf && diag.dnf.length > 0 && <div><b className="text-red-300">No terminaron</b> (excluidos del MAE): <span className="inline-flex gap-1.5 flex-wrap align-middle">{diag.dnf.map(r => <span key={r.num} className="text-[11px] px-1.5 py-0.5 rounded border border-red-500/30 bg-red-500/10 text-red-200"><Dot n={r.num} /> {mm(r.num)} · previsto P{r.predPos}{r.laps != null ? ` · ${r.laps} vtas` : ''}{r.ev && r.ev.length > 0 ? ' · ' + r.ev.map(evTxt).join('; ') : ''}</span>)}</span> {diag.dnf.every(r => r.ev && r.ev.length) ? <span className="text-slate-500">Causa tomada de la dirección de carrera oficial.</span> : <span className="text-slate-500">Posible caída, avería o sanción: la simulación limpia no los modela.</span>}</div>}
        {diag.inc && diag.inc.length > 0 && <div><b className="text-amber-300">Incidentes en carrera</b> (terminaron, pero su ritmo no es representativo; excluidos del MAE): <span className="inline-flex gap-1.5 flex-wrap align-middle">{diag.inc.map(r => <span key={r.num} className="text-[11px] px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-200"><Dot n={r.num} /> {mm(r.num)} · previsto P{r.predPos} → P{r.realPos} · {r.ev.map(evTxt).join('; ')}</span>)}</span></div>}
        {diag.outliers.length > 0 ? <div><div className="text-slate-400 mb-1">Pilotos con una desviación atípica tras quitar el desfase común (más de {diag.common.thr.toFixed(2)} s/vta):</div>
          <div className="overflow-x-auto"><table className="w-full text-xs tabular-nums"><thead><tr className="text-left text-slate-500 border-b border-[#1f2630]"><th className="py-1.5 pr-3">Piloto</th><th className="pr-3">Pos. pred.</th><th className="pr-3">Pos. real</th><th className="pr-3">Δ s/vta</th><th className="pr-3">Atípico</th><th>Lectura</th></tr></thead>
            <tbody>{diag.outliers.map(r => <tr key={r.num} className="border-b border-[#161c25]"><td className="py-1.5 pr-3 whitespace-nowrap"><Dot n={r.num} /> <span className="ml-1 text-slate-200">{mm(r.num)}</span></td><td className="pr-3">{r.predPos}</td><td className="pr-3 font-bold">{r.realPos}</td>
              <td className="pr-3 text-red-400 font-semibold">{sgn(r.d)}</td><td className="pr-3 text-slate-300">{sgn(r.res)}</td>
              <td className="text-slate-400">{r.res < 0 ? 'Más lento de lo previsto: toque o caída sin abandono, sanción (long lap), problema de neumático/moto o tráfico.' : 'Más rápido de lo previsto: carrera limpia en aire libre, mejor gestión de neumático o una mejora de forma no vista en los libres.'}</td></tr>)}</tbody></table></div></div>
          : <div className="text-slate-500">Ningún piloto sale de lo esperable una vez descontado el desfase común.</div>}
        <p className="text-[11px] text-slate-500">La lectura es una pista, no un diagnóstico: el motor solo ve tiempos, no sabe qué pasó en pista. Una desviación grande aislada suele ser un evento individual; un desfase de todo el campo suele ser meteo o condiciones de pista.</p>
      </div>
    </Panel>}
    {last && <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Panel title="Última foto" sess={'objetivo ' + TLBL[tgt]}><Gauge pct={last.pct} label={`Acierto Top 3 · ${tgt === 'POLE' ? 'Pole' : tgt === 'SPR' ? 'Sprint' : 'Carrera'}`} sub={`${last.overlap}/3 en podio · ${last.exact}/3 exactos`} /></Panel>
      <Panel title="Diferencia de ritmo" sess={'objetivo ' + TLBL[tgt]}>{last.mae != null ? <div><div className="text-3xl font-black tabular-nums text-white">{last.mae.toFixed(3)}<span className="text-sm text-slate-400"> s/vta</span></div><div className="text-[11px] text-slate-500 mt-1">MAE sobre {last.rows.length} pilotos · sesgo {last.bias > 0 ? '+' : ''}{last.bias.toFixed(3)} s/vta</div></div> : <div className="text-sm text-slate-500">La pole se evalúa por posición (no hay ritmo por vuelta).</div>}</Panel>
      <Panel title="Mejora de la predicción" sess={'objetivo ' + TLBL[tgt]}>{cur.length > 1 ? <div><div className="text-3xl font-black tabular-nums text-white">{cur[cur.length - 1].pct - cur[0].pct >= 0 ? '+' : ''}{cur[cur.length - 1].pct - cur[0].pct}<span className="text-sm text-slate-400"> pp</span></div>
        <div className="text-[11px] text-slate-500 mt-1">acierto Top 3 de la 1ª a la última foto{cur[0].mae != null && ` · MAE ${cur[0].mae.toFixed(2)} → ${cur[cur.length - 1].mae.toFixed(2)} s/vta`}</div></div> : <div className="text-sm text-slate-500">Solo hay una foto previa para este objetivo.</div>}</Panel>
    </div>}
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <Panel title="Evolución de la precisión entre fotos" sess={'objetivo ' + TLBL[tgt]}>{cur.length ? <ChartCanvas type="bar" data={evoData} options={evoOpts} height={280} /> : <Empty />}</Panel>
      <Panel title="Ritmo predicho vs real (seleccionados)" sess={'objetivo ' + TLBL[tgt]}>{rowsSel.length ? <ChartCanvas type="bar" data={pvData} options={pvOpts} height={280} /> : <div className="text-center text-slate-500 text-sm py-10">{tgt === 'POLE' ? 'Disponible para Sprint y Carrera.' : 'Selecciona pilotos en el panel lateral.'}</div>}</Panel>
    </div>
    {last && last.rows.length > 0 && <Panel title="Detalle por piloto (última foto)" sess={'objetivo ' + TLBL[tgt]}>
      <div className="overflow-x-auto"><table className="w-full text-xs tabular-nums"><thead><tr className="text-left text-slate-500 border-b border-[#1f2630]"><th className="py-1.5 pr-3">Piloto</th><th className="pr-3">Pos. pred.</th><th className="pr-3">Pos. real</th><th className="pr-3">Δ pos</th><th className="pr-3">Ritmo pred.</th><th className="pr-3">Ritmo real</th><th className="pr-3">Δ s/vta</th><th className="pr-3">Degr. pred.</th><th>Degr. real</th></tr></thead>
        <tbody>{[...last.rows].sort((a, b) => a.realPos - b.realPos).map(r => <tr key={r.num} className={'border-b border-[#161c25] ' + (sel.includes(r.num) ? 'bg-[#131922]' : '')}>
          <td className="py-1.5 pr-3 whitespace-nowrap"><Dot n={r.num} /> <span className="ml-1 text-slate-200">{mm(r.num)}</span></td><td className="pr-3">{r.predPos}</td><td className="pr-3 font-bold">{r.realPos}</td>
          <td className={'pr-3 ' + (r.predPos === r.realPos ? 'text-emerald-400' : 'text-slate-400')}>{r.predPos - r.realPos > 0 ? '+' : ''}{r.predPos - r.realPos}</td>
          <td className="pr-3">{fmtTime(r.predPace)}</td><td className="pr-3">{fmtTime(r.realPace)}</td><td className={'pr-3 font-semibold ' + (Math.abs(r.d) < 0.15 ? 'text-emerald-400' : Math.abs(r.d) < 0.35 ? 'text-amber-300' : 'text-red-400')}>{r.d > 0 ? '+' : ''}{r.d.toFixed(3)}</td>
          <td className="pr-3 text-slate-400">{r.predDeg.toFixed(3)}</td><td className="text-slate-400">{r.realDeg.toFixed(3)}</td></tr>)}</tbody></table></div></Panel>}
  </div>;
}
function snapPreview() {
  const s = SNAP.FRI; return `Pole: ${s.pole.rows.slice(0, 3).map(r => mm(r.num)).join(' / ')} · Sprint: ${s.sprint.rows.slice(0, 3).map(r => mm(r.num)).join(' / ')} · Domingo: ${s.race.rows.slice(0, 3).map(r => mm(r.num)).join(' / ')}`;
}

/* ---------- TAB: Simulación vs Real ---------- */
function UploadHelp() {
  return <div className="text-sm text-slate-300 space-y-2 leading-relaxed">
    <p className="font-semibold text-slate-100">Cómo añadir una sesión real</p>
    <ol className="list-decimal ml-5 space-y-1 text-[13px] text-slate-400">
      <li>Copia los PDF oficiales de la sesión a su carpeta (<code className="text-amber-300">{CIRC.folder}/FP2/</code>, <code className="text-amber-300">Q1/</code>, <code className="text-amber-300">Q2/</code>, <code className="text-amber-300">SPRINT/</code> o <code className="text-amber-300">RACE/</code>): <b className="text-slate-200">«Chronological Analysis»</b> (obligatorio) y el resto de informes (opcionales: validan los datos y afinan la vuelta ideal y las velocidades). La sesión se detecta por la carpeta y, si no, por el título del PDF. También puedes prefijar el nombre con <code className="text-amber-300">FP2_</code>, <code className="text-amber-300">Q1_</code>, <code className="text-amber-300">Q2_</code>, <code className="text-amber-300">SPR_</code> o <code className="text-amber-300">RAC_</code>.</li>
      <li>Arranca <code className="text-amber-300">python tools/servidor.py</code> y abre <code className="text-amber-300">http://localhost:8000</code>: cada vez que refrescas (F5) se reescanea la carpeta. Sin servidor: <code className="text-amber-300">python tools/actualizar.py</code> y recarga <code className="text-amber-300">index.html</code>.</li>
      <li>La sesión pasa a REAL, el resto sigue simulado, y aquí aparece la comparativa simulación vs real.</li>
    </ol></div>;
}
/* ---------- TAB: Simulador de carrera ---------- */
const NUMK = ['laps', 'runs', 'seed', 'switchLap', 'pitLoss', 'wetPen', 'wetSd', 'wetNoise', 'crashPct', 'wetCrashMult', 'kPace', 'kDeg', 'paceSd', 'ground', 'air', 'hum', 'hour'];
function Simulador({ M, sel }) {
  const c = DATA.circuit, N0 = c.raceLaps, fc = c.forecast;
  const base = useMemo(() => raceBase(M.id), [M.id]), ref = useMemo(raceRefCond, []);
  const init = () => Object.assign({}, RACE_DEFAULTS, { laps: N0, ground: fc ? fc.ground : ref.ground, air: fc ? fc.air : ref.air, hum: fc ? fc.hum : ref.hum, refGround: ref.ground, rain: fc ? fc.rain : null, date: c.raceDate || '', hour: c.raceHour || 15 });
  const [draft, setDraft] = useState(init), [applied, setApplied] = useState(init), [msg, setMsg] = useState(null);
  const set = (k, v) => setDraft(d => Object.assign({}, d, { [k]: v }));
  const clean = d => { const o = Object.assign({}, d); NUMK.forEach(k => { if (!isFinite(+o[k]) || o[k] === '') o[k] = init()[k]; else o[k] = +o[k]; }); o.laps = clamp(Math.round(o.laps), 5, 60); o.runs = clamp(Math.round(o.runs), 50, 3000); o.switchLap = clamp(Math.round(o.switchLap), 1, o.laps - 1); return o; };
  const res = useMemo(() => base && base.rows.length ? simulateRaceMC(base.rows, applied, N0) : null, [applied, base]);
  const run = (seed) => setApplied(clean(Object.assign({}, draft, seed != null ? { seed } : {})));
  const dirty = JSON.stringify(clean(draft)) !== JSON.stringify(applied);
  const loadForecast = async () => {
    try {
      if (!c.lat || !draft.date) throw new Error('falta la fecha o las coordenadas del circuito');
      setMsg('Consultando Open-Meteo…');
      const j = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,shortwave_radiation&timezone=auto&start_date=${draft.date}&end_date=${draft.date}`)).json();
      if (j.error) throw new Error(j.reason || 'sin respuesta');
      const h = j.hourly, i = h.time.findIndex(t => +t.slice(11, 13) === +draft.hour); if (i < 0) throw new Error('hora no disponible');
      const air = h.temperature_2m[i], hum = h.relative_humidity_2m[i], rain = h.precipitation_probability[i], sw = h.shortwave_radiation[i] || 0, ground = Math.round(air + Math.min(18, 0.019 * sw));
      setDraft(d => Object.assign({}, d, { air, hum, rain, ground }));
      setMsg(`Open-Meteo ${draft.date} ${draft.hour}:00 → aire ${air}°, humedad ${hum}%, lluvia ${rain}%, radiación ${Math.round(sw)} W/m² → pista estimada ${ground}° (aire + 0,019·radiación). Pulsa «Simular».`);
    } catch (e) { setMsg('No se pudo cargar la previsión (' + e.message + '). Introduce los valores a mano.'); }
  };
  const fld = (k, l, step = 1, w = 'w-16') => <label className="flex items-center gap-1.5 text-[11px] text-slate-400">{l}<input type="number" step={step} value={draft[k]} onChange={e => set(k, e.target.value)} className={w + ' bg-[#0d1117] border border-[#2a313c] rounded px-1.5 py-1 text-xs text-slate-100 tabular-nums'} /></label>;
  const P = applied, lbl = { DRY: 'SECO', WET: 'MOJADO', F2F: 'FLAG-TO-FLAG' }[P.cond] + (P.cond === 'F2F' ? (P.f2f === 'DRY>WET' ? ' seco→mojado' : ' mojado→seco') + ' (v' + P.switchLap + ')' : '') + ` · pista ${P.ground}° · ${P.laps} vtas`;
  const tag = 'RACE · SIM · ' + lbl;
  const ids = res ? res.riders.map(r => r.num) : [], selIn = sel.filter(n => ids.includes(n));
  const labels = res ? Array.from({ length: res.N }, (_, i) => i + 1) : [];
  const gapData = useMemo(() => res ? { labels, datasets: selIn.map(n => ({ label: mm(n), data: res.gapByLap.map(g => g[n] == null ? null : +g[n].toFixed(2)), borderColor: RIDER[n].color, backgroundColor: RIDER[n].color, pointRadius: 0, borderWidth: 2, tension: 0.2, spanGaps: false })) } : null, [res, sel]);
  const posData = useMemo(() => res ? { labels, datasets: selIn.map(n => ({ label: mm(n), data: res.posByLap.map(g => g[n] == null ? null : g[n]), borderColor: RIDER[n].color, backgroundColor: RIDER[n].color, pointRadius: 2, borderWidth: 2, stepped: true })) } : null, [res, sel]);
  const probData = useMemo(() => res ? { labels: res.riders.slice(0, 10).map(r => mm(r.num)), datasets: [{ label: '% victoria', data: res.riders.slice(0, 10).map(r => +(100 * r.win).toFixed(1)), backgroundColor: '#ef4444' }, { label: '% podio', data: res.riders.slice(0, 10).map(r => +(100 * r.pod).toFixed(1)), backgroundColor: '#64748b' }] } : null, [res]);
  const gapOpts = useMemo(() => ({ plugins: { legend: { position: 'bottom' } }, scales: { x: axisT('vuelta'), y: axisT('gap al líder (s)') } }), []);
  const posOpts = useMemo(() => ({ plugins: { legend: { position: 'bottom' } }, scales: { x: axisT('vuelta'), y: Object.assign({ reverse: true, min: 1, ticks: { precision: 0 } }, axisT('posición')) } }), []);
  const probOpts = useMemo(() => ({ plugins: { legend: { position: 'bottom' } }, scales: { y: Object.assign({ min: 0, max: 100 }, axisT('%')) } }), []);
  const rain = draft.rain;
  return <div className="space-y-4">
    {SD.RAC.real && <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-100">La Carrera ya es REAL: este simulador responde a «¿qué habría pasado con otra pista o meteo?» partiendo de la predicción previa a la carrera.</div>}
    <Panel title="Parámetros de pista y carrera" sess={tag} right={<div className="flex gap-1.5"><Chip onClick={() => run()} active={dirty}>{dirty ? 'Simular (hay cambios)' : 'Simular'}</Chip><Chip onClick={() => run(Math.floor(Math.random() * 1e6))}>Otra semilla</Chip></div>}>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div className="space-y-3">
          <div><div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Condición de la carrera</div>
            <div className="flex flex-wrap gap-1.5">{[['DRY', 'Seco'], ['WET', 'Mojado'], ['F2F', 'Flag-to-flag']].map(([k, l]) => <Chip key={k} active={draft.cond === k} onClick={() => set('cond', k)}>{l}</Chip>)}</div></div>
          {draft.cond === 'F2F' && <div className="rounded border border-[#1f2630] bg-[#0d1117] p-3 space-y-2">
            <div className="flex flex-wrap gap-1.5"><Chip active={draft.f2f === 'DRY>WET'} onClick={() => set('f2f', 'DRY>WET')}>Empieza seco → llueve</Chip><Chip active={draft.f2f === 'WET>DRY'} onClick={() => set('f2f', 'WET>DRY')}>Empieza mojado → se seca</Chip></div>
            <div className="flex flex-wrap gap-4">{fld('switchLap', 'Vuelta del cambio', 1)}{fld('pitLoss', 'Pérdida cambio de moto (s)', 1)}</div>
            <p className="text-[11px] text-slate-500">Cada piloto entra a cambiar de moto entre 1 vuelta antes y 3 después del cambio de pista; mientras tanto rueda con el neumático equivocado (más lento y más riesgo de caída).</p></div>}
          <div><div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Estado de pista esperado</div>
            <div className="flex flex-wrap gap-4">{fld('ground', 'Pista °C')}{fld('air', 'Aire °C')}{fld('hum', 'Humedad %')}</div>
            <div className="flex flex-wrap gap-1.5 mt-2">{['SPR', 'Q2', 'FP2', 'PR'].filter(x => SD[x].real && SD[x].official && SD[x].official.cond).map(x => <Chip key={x} onClick={() => setDraft(d => Object.assign({}, d, { ground: SD[x].official.cond.ground, air: SD[x].official.cond.air, hum: SD[x].official.cond.hum }))}>{`Como ${SESS[x].label} (${SD[x].official.cond.ground}°)`}</Chip>)}
              {fc && <Chip onClick={() => setDraft(d => Object.assign({}, d, { ground: fc.ground, air: fc.air, hum: fc.hum, rain: fc.rain }))} title={fc.src}>Previsión Met Office (aire {fc.air}°)</Chip>}</div>
            <p className="text-[11px] text-slate-500 mt-2">El ritmo de partida se midió con pista a <b className="text-slate-300">{ref.ground}°</b>{ref.sid ? ` (${SESS[ref.sid].label} real)` : ''}. Cada °C de diferencia cambia el ritmo {draft.kPace} s/vta y la degradación un {Math.round(100 * draft.kDeg)}%.</p></div>
        </div>
        <div className="space-y-3">
          <div><div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Previsión meteorológica</div>
            {fc && <div className="text-xs text-slate-300 leading-relaxed">{fc.src}: <b>{fc.air}°</b> · lluvia <b>{fc.rain}%</b> · {fc.sky}{fc.estimated && fc.estimated.length ? <span className="text-slate-500"> (pista y humedad estimadas)</span> : null}</div>}
            {rain != null && <div className={'text-xs mt-1 ' + (rain >= 50 ? 'text-red-300' : rain >= 25 ? 'text-amber-300' : 'text-emerald-300')}>Probabilidad de lluvia {rain}% → {rain >= 50 ? 'conviene simular MOJADO o flag-to-flag' : rain >= 25 ? 'riesgo real de flag-to-flag: compara con esa condición' : 'carrera en seco lo más probable'}.</div>}
            <div className="flex flex-wrap items-center gap-3 mt-2"><label className="flex items-center gap-1.5 text-[11px] text-slate-400">Fecha<input type="date" value={draft.date} onChange={e => set('date', e.target.value)} className="bg-[#0d1117] border border-[#2a313c] rounded px-1.5 py-1 text-xs text-slate-100" /></label>{fld('hour', 'Hora', 1, 'w-14')}
              <Chip onClick={loadForecast} title="Consulta api.open-meteo.com desde tu navegador (sin clave); no se envía nada más que las coordenadas del circuito y la fecha">Cargar previsión (Open-Meteo)</Chip>
              {c.forecastUrl && <a href={c.forecastUrl} target="_blank" rel="noreferrer" className="text-xs text-sky-300 hover:underline">Abrir Met Office ↗</a>}</div>
            {msg && <p className="text-[11px] text-slate-400 mt-2">{msg}</p>}</div>
          <details className="rounded border border-[#1f2630] bg-[#0d1117] p-3"><summary className="text-xs font-bold text-slate-300 cursor-pointer">Supuestos del modelo (editables)</summary>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3">{fld('laps', 'Vueltas')}{fld('runs', 'Simulaciones', 50)}{fld('seed', 'Semilla', 1, 'w-20')}{fld('paceSd', 'Incertidumbre ritmo (s/vta)', 0.05)}
              {fld('crashPct', 'Caídas en seco (% por piloto)', 0.5)}{fld('wetCrashMult', 'Caídas en mojado (×)', 0.5)}{fld('wetPen', 'Mojado: +s/vta', 0.5)}{fld('wetSd', 'Mojado: dispersión pilotos (s)', 0.1)}
              {fld('kPace', 'Temp: s/vta por °C', 0.002, 'w-20')}{fld('kDeg', 'Temp: degradación por °C', 0.01, 'w-20')}</div>
            <p className="text-[11px] text-slate-500 mt-2">Son supuestos, no calibrados con carreras reales: el mojado no tiene datos propios de cada piloto (se sortea su habilidad), y la sensibilidad térmica no está medida. Úsalos para comparar escenarios, no como predicción exacta.</p></details>
        </div>
      </div>
    </Panel>
    {!res && <Panel title="Resultado" sess={tag}><div className="text-sm text-slate-400">No hay una predicción de carrera de la que partir (faltan FP1 y PR).</div></Panel>}
    {res && <>
      <Panel title="Resultado esperado" sess={tag} right={<span className="text-[11px] text-slate-500">{P.runs} simulaciones · base: predicción {MILESTONES.find(m => m.id === base.mid).label}{base.gridOff ? ' · parrilla oficial' : ' · parrilla estimada'}</span>}>
        <div className="overflow-x-auto"><table className="w-full text-xs tabular-nums">
          <thead><tr className="text-left text-slate-500 border-b border-[#1f2630]"><th className="py-1.5 pr-3">Pos</th><th className="pr-3">Piloto</th><th className="pr-3">Parr.</th><th className="pr-3">% victoria</th><th className="pr-3">% podio</th><th className="pr-3">Pos. media</th><th className="pr-3">P10–P90</th><th>% abandono</th></tr></thead>
          <tbody>{res.riders.map(r => <tr key={r.num} className={'border-b border-[#161c25] hover:bg-[#141a22] ' + (sel.includes(r.num) ? 'bg-[#131922]' : '')}>
            <td className="py-1.5 pr-3 font-bold text-slate-300">{r.exp}</td><td className="pr-3 whitespace-nowrap"><Dot n={r.num} /> <span className="ml-1 text-slate-100">{mm(r.num)}</span></td><td className="pr-3 text-slate-400">{r.grid}</td>
            <td className="pr-3"><div className="flex items-center gap-2"><div className="w-16 h-1.5 bg-[#0d1117] rounded overflow-hidden"><div className="h-full bg-red-500" style={{ width: Math.min(100, 100 * r.win) + '%' }} /></div><span className="text-slate-100">{(100 * r.win).toFixed(1)}</span></div></td>
            <td className="pr-3 text-slate-200">{(100 * r.pod).toFixed(1)}</td><td className="pr-3">{r.mean != null ? r.mean.toFixed(1) : '—'}</td><td className="pr-3 text-slate-400">{r.p10 != null ? r.p10 + '–' + r.p90 : '—'}</td>
            <td className={r.dnf > 0.1 ? 'text-red-400' : 'text-slate-400'}>{(100 * r.dnf).toFixed(1)}</td></tr>)}</tbody></table></div>
        <p className="text-[11px] text-slate-500 mt-2">Δ pista {res.dT >= 0 ? '+' : ''}{res.dT}° respecto al ritmo de referencia → ritmo {res.dryAdj >= 0 ? '+' : ''}{res.dryAdj.toFixed(2)} s/vta, degradación ×{res.degMul.toFixed(2)}.</p>
      </Panel>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Panel title="Probabilidad de victoria y podio (top 10)" sess={tag}><ChartCanvas type="bar" data={probData} options={probOpts} height={280} /></Panel>
        <Panel title="Carrera representativa: orden final" sess={tag}><ol className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">{res.rep.map((r, i) => <li key={r.num} className={'flex items-center gap-2 ' + (r.dnf ? 'text-red-400' : 'text-slate-200')}><span className="w-6 text-slate-500 tabular-nums">{r.dnf ? '—' : i + 1}</span><Dot n={r.num} />{mm(r.num)}{r.dnf && <span className="text-[10px] font-bold">DNF</span>}</li>)}</ol>
          <p className="text-[11px] text-slate-500 mt-3">De las {P.runs} carreras simuladas, la más cercana a las posiciones medias; los gráficos de abajo son de esta carrera.</p></Panel>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Panel title="Gap al líder por vuelta (seleccionados)" sess={tag}>{selIn.length ? <ChartCanvas type="line" data={gapData} options={gapOpts} height={300} /> : <Empty />}</Panel>
        <Panel title="Posición por vuelta (seleccionados)" sess={tag}>{selIn.length ? <ChartCanvas type="line" data={posData} options={posOpts} height={300} /> : <Empty />}</Panel>
      </div>
    </>}
  </div>;
}

function Comparativa({ sel, sess }) {
  const withSim = SIDS_ALL.filter(s => DATA.meta.real.includes(s) && DATA.sim && DATA.sim[s]);
  const cur = withSim.includes(sess) ? sess : withSim[withSim.length - 1];            // header choice, or the latest session that has both a real and a simulated version
  const forced = cur && cur !== sess;
  const cmp = useMemo(() => cur ? compareSession(cur) : null, [cur]);
  const rows = cmp ? [...cmp.rows].sort((a, b) => (a.rReal || 99) - (b.rReal || 99)) : [];
  const chartData = useMemo(() => ({ labels: rows.map(r => mm(r.num)), datasets: [{ label: cur && SESS[cur].kind === 'race' ? 'Δ ritmo medio sim − real (s/vta)' : 'Δ mejor vuelta sim − real (s)', data: rows.map(r => +((cur && SESS[cur].kind === 'race' ? r.dPace : r.dBest)).toFixed(3)), backgroundColor: rows.map(r => RIDER[r.num].color) }] }), [cur]);
  const chartOpts = useMemo(() => ({ plugins: { legend: { display: true, position: 'bottom' } }, scales: { y: axisT('segundos (positivo = la simulación fue más lenta)') } }), []);
  return <div className="space-y-4">
    <Panel title="Estado de las sesiones" sess={null} right={<span className="text-[11px] text-slate-500">actualizado {DATA.meta.built}</span>}>
      <div className="flex flex-wrap gap-2">{SIDS_ALL.map(s => { const real = DATA.meta.real.includes(s); return <div key={s} className={'px-3 py-2 rounded border text-xs ' + (real ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-sky-500/30 bg-sky-500/5')}>
        <div className="font-bold text-slate-100 flex items-center gap-2">{SESS[s].label} <Badge real={real} /></div>
        <div className="text-slate-500 mt-0.5">{real ? DATA.meta.sources[s] : 'esperando PDF…'}</div></div>; })}</div>
    </Panel>
    {!cmp && <Panel title="Simulación vs Real" sess={null}><div className="text-sm text-slate-400 mb-4">Todavía no hay ninguna sesión real de sábado/domingo que comparar con su simulación.</div><UploadHelp /></Panel>}
    {cmp && <>
      <Panel title="Simulación vs Real" sess={SESS[cur].label + ' · REAL vs SIM'} right={forced ? <span className="text-[11px] text-amber-300">{SESS[sess].label} no tiene versión real y simulada a la vez: se muestra {SESS[cur].label}</span> : <span className="text-[11px] text-slate-500">comparables: {withSim.map(s => SESS[s].label).join(' · ')}</span>}>
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          {[['Pilotos', cmp.n, 'comparados'], ['MAE mejor vuelta', cmp.maeBest.toFixed(3) + ' s', 'sesgo ' + (cmp.biasBest > 0 ? '+' : '') + cmp.biasBest.toFixed(3)],
          ['MAE ritmo', cmp.maePace.toFixed(3) + ' s', 'sesgo ' + (cmp.biasPace > 0 ? '+' : '') + cmp.biasPace.toFixed(3)], ['MAE vuelta ideal', isFinite(cmp.maeIdeal) ? cmp.maeIdeal.toFixed(3) + ' s' : '—', 'Σ mejores sectores'],
          ['Orden (Spearman)', isFinite(cmp.rho) ? cmp.rho.toFixed(2) : '—', '1 = mismo orden'], ['Top 3 acertado', cmp.overlap + '/3', cmp.exact + '/3 exactos']].map(([a, b, c]) =>
            <div key={a} className="rounded border border-[#1f2630] bg-[#0d1117] px-3 py-2"><div className="text-[10px] uppercase tracking-wider text-slate-500">{a}</div><div className="text-lg font-black text-white tabular-nums">{b}</div><div className="text-[11px] text-slate-500">{c}</div></div>)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 text-xs">
          <div><div className="text-slate-500 mb-1">Top 3 real</div><TopChips top={cmp.topReal} /></div>
          <div><div className="text-slate-500 mb-1">Top 3 simulado (verde = acertado)</div><TopChips top={cmp.topSim} ref3={cmp.topReal} /></div>
        </div>
      </Panel>
      <Panel title="Diferencia por piloto" sess={SESS[cur].label + ' · REAL vs SIM'}><ChartCanvas type="bar" data={chartData} options={chartOpts} height={280} /></Panel>
      <Panel title="Detalle sim vs real" sess={SESS[cur].label + ' · REAL vs SIM'}>
        <div className="overflow-x-auto"><table className="w-full text-xs tabular-nums">
          <thead><tr className="text-left text-slate-500 border-b border-[#1f2630]"><th className="py-1.5 pr-3">Piloto</th><th className="pr-3">Pos real</th><th className="pr-3">Pos sim</th><th className="pr-3">Mejor real</th><th className="pr-3">Mejor sim</th><th className="pr-3">Δ</th><th className="pr-3">Ideal real</th><th className="pr-3">Ideal sim</th><th className="pr-3">Δ</th><th className="pr-3">Vmax real</th><th className="pr-3">Vmax sim</th><th className="pr-3">Ritmo real</th><th className="pr-3">Ritmo sim</th><th>Δ</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.num} className={'border-b border-[#161c25] hover:bg-[#141a22] ' + (sel.includes(r.num) ? 'bg-[#131922]' : '')}>
            <td className="py-1.5 pr-3 whitespace-nowrap"><Dot n={r.num} /> <span className="ml-1 text-slate-200">{mm(r.num)}</span></td>
            <td className="pr-3 font-bold">{r.rReal}</td><td className={'pr-3 ' + (r.rReal === r.rSim ? 'text-emerald-400' : 'text-slate-400')}>{r.rSim}</td>
            <td className="pr-3">{fmtLap(r.real.best)}</td><td className="pr-3 text-sky-300">{fmtLap(r.sim.best)}</td><td className={'pr-3 font-semibold ' + (Math.abs(r.dBest) < 0.2 ? 'text-emerald-400' : Math.abs(r.dBest) < 0.5 ? 'text-amber-300' : 'text-red-400')}>{r.dBest > 0 ? '+' : ''}{r.dBest.toFixed(3)}</td>
            <td className="pr-3">{fmtLap(r.real.ideal)}</td><td className="pr-3 text-sky-300">{fmtLap(r.sim.ideal)}</td><td className="pr-3 text-slate-400">{isFinite(r.dIdeal) ? (r.dIdeal > 0 ? '+' : '') + r.dIdeal.toFixed(3) : '—'}</td>
            <td className="pr-3">{r.real.vmax ? r.real.vmax.toFixed(1) : '—'}</td><td className="pr-3 text-sky-300">{r.sim.vmax ? r.sim.vmax.toFixed(1) : '—'}</td>
            <td className="pr-3">{fmtTime(r.real.pace)}</td><td className="pr-3 text-sky-300">{fmtTime(r.sim.pace)}</td><td className="text-slate-400">{r.dPace > 0 ? '+' : ''}{r.dPace.toFixed(3)}</td></tr>)}</tbody>
        </table></div>
        <p className="text-[11px] text-slate-500 mt-2">Ritmo = media de las 3 mejores vueltas válidas (práctica/Q) o media de todas las válidas (Sprint/Carrera). Los pilotos con ≤ 4 vueltas en la sesión no se comparan.</p>
      </Panel>
      <Panel title="Añadir más sesiones" sess={null}><UploadHelp /></Panel>
    </>}
  </div>;
}

/* ---------- App ---------- */
function App() {
  const [view, setViewState] = useState('auto'), [mid, setMid] = useState('FRI'), [tab, setTab] = useState('res'), [sel, setSel] = useState(DEFAULT_SEL), [target, setTarget] = useState('SPR'), [sess, setSess] = useState('PR');
  const changeView = v => { setView(v); setViewState(v); };
  const M = MILESTONES.find(m => m.id === mid), mi = MILESTONES.indexOf(M);
  const snap = SNAP[mid], prev = mi > 0 ? SNAP[MILESTONES[mi - 1].id] : null;
  const orderedSel = useMemo(() => NUMS.filter(n => sel.includes(n)), [sel]);
  const c = DATA.circuit;
  const curS = M.sessions.includes(sess) ? sess : M.sessions[M.sessions.length - 1];          // active session: chosen in the header, kept inside the milestone
  const scope = 'datos hasta ' + SESS[M.sessions[M.sessions.length - 1]].label;
  return <ScopeCtx.Provider value={scope}><div className="min-h-screen">
    <header className="sticky top-0 z-30 border-b border-[#1f2630] bg-[#0a0c10]/95 backdrop-blur">
      <div className="max-w-[1500px] mx-auto px-4 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-2">
        <BrandMark />
        <CircuitSelect />
        <nav className="flex gap-1 flex-wrap" aria-label="Hito del fin de semana">
          {MILESTONES.map((m, i) => <button key={m.id} onClick={() => setMid(m.id)} className={'px-3 py-1.5 rounded text-xs font-bold border transition ' + (m.id === mid ? 'bg-red-600 border-red-500 text-white shadow-[0_0_14px_rgba(239,68,68,.35)]' : 'border-[#2a313c] text-slate-300 hover:border-slate-500')}><span className="opacity-60 mr-1">{i + 1}</span>{m.label}</button>)}
        </nav>
        <div className="ml-auto hidden md:flex items-center gap-3 text-[11px] text-slate-400">
          {c.weather && <span>☀ {c.weather.air}° · pista {c.weather.ground}° · hum. {c.weather.hum}%</span>}<span title={c.lapsEstimated.RAC ? 'Vueltas estimadas hasta que haya Carrera real' : ''}>{c.length} km · {c.lapsEstimated.RAC ? '~' : ''}{c.raceLaps} vtas</span><Badge real>{'REAL ' + SIDS_ALL.filter(s => SD[s].real).join(' ')}</Badge>{SIDS_ALL.some(s => !SD[s].real) && <Badge real={false}>{'SIM ' + SIDS_ALL.filter(s => !SD[s].real).join(' ')}</Badge>}</div>
      </div>
      <div className="max-w-[1500px] mx-auto px-4 pb-2 flex items-center gap-1.5 overflow-x-auto" aria-label="Sesión activa">
        <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500 mr-1 shrink-0">Sesión</span>
        {SIDS_ALL.map(x => { const ok = M.sessions.includes(x), real = SD[x].real, on = x === curS;
          return <button key={x} disabled={!ok} onClick={() => setSess(x)} title={!ok ? 'Aún no disputada en este hito' : (real ? 'Datos reales' : 'Simulación') + ' · aplica a Telemetría y Sim vs Real'}
            className={'shrink-0 px-2.5 py-1 rounded text-[11px] font-bold border flex items-center gap-1.5 transition ' + (on ? 'bg-red-600 border-red-500 text-white' : ok ? 'border-[#2a313c] text-slate-300 hover:border-slate-500' : 'border-[#1a2029] text-slate-600 opacity-50 cursor-not-allowed')}>
            <span className={'w-1.5 h-1.5 rounded-full ' + (real ? 'bg-emerald-400' : 'bg-sky-400')} />{SESS[x].label}<span className="text-[9px] font-semibold opacity-70">{real ? 'REAL' : 'SIM'}</span></button>; })}
        <span className="ml-2 text-[11px] text-slate-500 shrink-0 hidden md:inline">activa: <b className="text-slate-200">{sessTag(curS)}</b> · aplica a Telemetría y Sim vs Real</span>
      </div>
      <div className="max-w-[1500px] mx-auto px-4 pb-1 flex items-center justify-between gap-3">
        <div className="flex gap-1 overflow-x-auto">{TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={'px-3 py-2 text-xs font-bold tracking-wide border-b-2 whitespace-nowrap ' + (tab === k ? 'border-red-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300')}>{l}</button>)}</div>
        <div className="flex items-center gap-2 shrink-0"><span className="text-[11px] text-slate-500 hidden sm:inline">Fuente</span>
          <Chip active={view === 'auto'} onClick={() => changeView('auto')} title="Usa la sesión real cuando existe y la simulación cuando no">Real si existe</Chip>
          <Chip active={view === 'sim'} disabled={!HAS_SIM_OVERRIDE} onClick={() => changeView('sim')} title={HAS_SIM_OVERRIDE ? 'Ignora las sesiones reales de sábado/domingo y usa su simulación' : 'Aún no hay sesiones reales de sáb/dom que sustituir'}>Solo simulación</Chip></div>
      </div>
    </header>
    <main className="max-w-[1500px] mx-auto px-4 py-4 grid grid-cols-1 lg:grid-cols-[250px_minmax(0,1fr)] gap-4">
      <aside className="lg:sticky lg:top-[166px] self-start"><RiderPanel sel={sel} setSel={setSel} snap={snap} /></aside>
      <div className="min-w-0" key={view}>
        {tab === 'res' && <Resumen snap={snap} prev={prev} M={M} sel={orderedSel} goPace={t => { setTarget(t); setTab('pace'); }} goSim={() => setTab('race')} />}
        {tab === 'race' && <Simulador M={M} sel={orderedSel} />}
        {tab === 'tel' && <Telemetria snap={snap} M={M} sel={orderedSel} view={view} sid={curS} />}
        {tab === 'pace' && <Ritmo snap={snap} M={M} sel={orderedSel} target={target} setTarget={setTarget} />}
        {tab === 'acc' && <Precision M={M} sel={orderedSel} view={view} />}
        {tab === 'cmp' && <Comparativa sel={orderedSel} sess={curS} />}
      </div>
    </main>
    <footer className="max-w-[1500px] mx-auto px-4 pb-8 text-[11px] text-slate-600 leading-relaxed">
      Sesiones reales: cronometraje oficial MotoGP / Tissot (PDFs «Chronological Analysis», {CIRC.short}). Sesiones simuladas: <b className="text-sky-400">simulación sintética</b> con semilla fija anclada al ritmo real del viernes — no son resultados oficiales — hasta que se añada su PDF a {CIRC.folder}/ y se refresque (<code>python tools/servidor.py</code>). El motor usa vueltas depuradas (out/in-laps, anuladas y &gt;107%), ignora a los pilotos con ≤ 4 vueltas en una sesión y normaliza por evolución de pista y neumático.
    </footer>
  </div></ScopeCtx.Provider>;
}
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
