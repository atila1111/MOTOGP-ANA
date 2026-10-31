/* ============================ ENGINE ============================ */
const SESS = {
  FP1: { label: 'FP1', long: 'Free Practice 1', kind: 'prac', day: 'Viernes' },
  PR:  { label: 'PR',  long: 'Practice (tarde)', kind: 'prac', day: 'Viernes' },
  FP2: { label: 'FP2', long: 'Free Practice 2', kind: 'prac', day: 'Sábado' },
  Q1:  { label: 'Q1',  long: 'Qualifying 1', kind: 'q', day: 'Sábado' },
  Q2:  { label: 'Q2',  long: 'Qualifying 2', kind: 'q', day: 'Sábado' },
  SPR: { label: 'SPRINT', long: `Sprint (${DATA.circuit.sprintLaps} vueltas)`, kind: 'race', day: 'Sábado' },
  RAC: { label: 'RACE', long: `Carrera (${DATA.circuit.raceLaps} vueltas)`, kind: 'race', day: 'Domingo' },
};
const MILESTONES = [
  { id: 'FRI', label: 'Viernes · post-PR', short: 'VIE', sessions: ['FP1', 'PR'], blurb: 'FP1 + PR: sustrato inicial de ritmo y tandas largas' },
  { id: 'SAM', label: 'Sábado AM · post-FP2', short: 'SÁB-AM', sessions: ['FP1', 'PR', 'FP2'], blurb: 'FP2: velocidad pura a una vuelta para recalcular la Pole y los primeros compases de la Sprint' },
  { id: 'SAT', label: 'Sábado · post-Q2', short: 'SÁB', sessions: ['FP1', 'PR', 'FP2', 'Q1', 'Q2'], blurb: 'FP2 + Q1/Q2: punta pura, vuelta ideal y ritmo pre-sprint' },
  { id: 'SPR', label: 'Post-Sprint', short: 'SPR', sessions: ['FP1', 'PR', 'FP2', 'Q1', 'Q2', 'SPR'], blurb: `Sprint (${DATA.circuit.sprintLaps} vueltas): degradación y adelantamiento reales` },
  { id: 'RAC', label: 'Post-Carrera', short: 'DOM', sessions: ['FP1', 'PR', 'FP2', 'Q1', 'Q2', 'SPR', 'RAC'], blurb: 'Carrera larga: gestión de neumáticos y ritmo de carrera' },
];
const COMP_ADJ = { S: -0.09, M: 0, H: 0.15 };       // normalisation to rear Medium (s/lap)
const CAL = {                                         // offsets practice -> race conditions (s/lap)
  spr: { short: 0.20, mini: 0.30, best: 0.46 },
  race: { long: 0.12, short: 0.34, mini: 0.42, best: 0.77 },
  sprToRace: 0.0,
};
const EVO_EXPECT = { FRI: -0.25, SAM: -0.12 };                    // expected Saturday track evolution (s/lap) applied to Friday forecasts
const START_LOSS = 2.4;                               // standing-start lap-1 loss (s)
const R = DATA.riders;
const RIDER = Object.fromEntries(R.map(r => [r.num, r]));
const NUMS = R.map(r => r.num);

const median = a => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const stdev = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
const sum = a => a.reduce((x, y) => x + y, 0);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
function linreg(xs, ys) {
  const n = xs.length; if (n < 2) return { a: ys[0] || 0, b: 0 };
  const mx = mean(xs), my = mean(ys); let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  const b = sxx ? sxy / sxx : 0; return { a: my - b * mx, b };
}
const fmtLap = s => { if (s == null || !isFinite(s)) return '—'; const m = Math.floor(s / 60), r = s - 60 * m; return `${m}'${r.toFixed(3).padStart(6, '0')}`; };
const fmtTime = s => { if (s == null || !isFinite(s)) return '—'; const m = Math.floor(s / 60), r = s - 60 * m; return m ? `${m}'${r.toFixed(3).padStart(6, '0')}` : r.toFixed(3); };
const fmtGap = s => (s == null || !isFinite(s)) ? '—' : (s === 0 ? '—' : '+' + s.toFixed(3));

/* ---- lap classification: depuración out-laps / in-laps / anuladas / lentas ---- */
function classify(sid, laps) {
  const kind = SESS[sid].kind; let prevRun = null;
  const res = laps.map(l => {
    const first = l.run !== prevRun; prevRun = l.run; let why = null;
    if (kind === 'race') { if (l.n === 1) why = 'SAL'; }
    else if (first) why = 'OUT';
    else if (l.p) why = 'IN';
    if (!why && l.x) why = 'ANU';
    return Object.assign({}, l, { why });
  });
  const ok = res.filter(l => !l.why).map(l => l.t);
  if (ok.length) {
    const ref = kind === 'race' ? median(ok) : Math.min(...ok);
    res.forEach(l => { if (!l.why && l.t > ref * 1.07) l.why = 'LENTA'; });
  }
  return res;
}
let SD = DATA.sessions, GR = {}, CLS = {}, EXCL = {}, SNAP = {}, VIEW = 'auto';   // GR: official starting grids (Sprint / Race) of the active view
const MIN_LAPS = 4;   // riders with <= 4 laps in a session (sum of all their runs) are ignored for that session's analytics
function buildCls(sd) {
  const cls = {}, ex = {};
  for (const sid of Object.keys(sd)) {
    cls[sid] = {}; ex[sid] = {};
    for (const n of NUMS) {
      const laps = sd[sid].riders[String(n)] || [];
      if (laps.length > 0 && laps.length <= MIN_LAPS) { ex[sid][n] = laps.length; cls[sid][n] = []; }
      else cls[sid][n] = classify(sid, laps);
    }
  }
  return { cls, ex };
}
const sectorUsable = l => !['OUT', 'IN', 'ANU', 'SAL'].includes(l.why);

/* ---- context for a milestone: available sessions + track-evolution offsets ---- */
function buildCtx(mid) {
  const M = MILESTONES.find(m => m.id === mid), avail = M.sessions;
  const prac = avail.filter(s => SESS[s].kind === 'prac'), ref = prac[prac.length - 1];
  const lvl = {};
  for (const s of prac) {
    lvl[s] = [0, 1, 2, 3].map(k => {
      const arr = [];
      for (const n of NUMS) {
        let b = Infinity;
        for (const l of CLS[s][n]) if (sectorUsable(l) && !l.sx[k] && l.s[k] < b) b = l.s[k];
        if (isFinite(b)) arr.push(b);
      }
      return median(arr);
    });
  }
  const off = {}, offQ = {};
  for (const s of avail) off[s] = prac.includes(s) ? [0, 1, 2, 3].map(k => lvl[s][k] - lvl[ref][k]) : [0, 0, 0, 0];
  // pole forecasts are expressed at the track level of the FASTEST practice session seen so far (qualifying is run on the best grip of the weekend),
  // not at the level of the latest one: a cool/slow FP2 must not drag every Friday lap down to its pace
  const refQ = prac.length ? prac.reduce((m, x) => sum(lvl[x]) < sum(lvl[m]) ? x : m, prac[0]) : null;
  for (const s of avail) offQ[s] = prac.includes(s) ? [0, 1, 2, 3].map(k => lvl[s][k] - lvl[refQ][k]) : [0, 0, 0, 0];
  let grid = null, poleKnown = false, gridS = null, gridR = null;
  if (avail.includes('Q2')) {
    poleKnown = true;
    grid = [...SD.Q2.order, ...SD.Q1.order.filter(n => !SD.Q2.order.includes(n))];                 // qualifying order
    gridS = GR.SPR ? GR.SPR.order : grid; gridR = GR.RAC ? GR.RAC.order : grid;                     // starting grids: official (with penalties, only starters) when published
  }
  return { mid, avail, prac, ref, off, offQ, grid, gridS, gridR, gridOff: { SPR: !!(grid && GR.SPR), RAC: !!(grid && GR.RAC) }, poleKnown };
}

/* ---- per-rider analysis ---- */
function stintsFor(sid, num, ctx) {
  const cl = CLS[sid][num] || [], kind = SESS[sid].kind, offT = sum(ctx.off[sid]), out = [];
  let cur = null, run = null;
  for (const l of cl) {
    const ok = !l.why;
    if (kind === 'race') { if (ok) { if (!cur) { cur = []; out.push(cur); } cur.push(l); } continue; }
    if (l.run !== run) { run = l.run; cur = null; }
    if (ok) { if (!cur) { cur = []; out.push(cur); } cur.push(l); } else cur = null;
  }
  return out.filter(a => a.length >= 3).map(a => {
    const tn = a.map(l => l.t - offT - (COMP_ADJ[l.r] || 0));
    const fit = linreg(a.map((_, i) => i), tn);
    return { sid, num, len: a.length, laps: a, tn, med: median(tn), sd: stdev(tn), a: fit.a, b: fit.b, comp: a[0].r, run: a[0].run, kind };
  });
}

function analyzeRider(num, ctx) {
  const o = { num, best: Infinity, bestN: Infinity, bestSid: null, sec: [Infinity, Infinity, Infinity, Infinity], secN: [Infinity, Infinity, Infinity, Infinity],
    bestQ: Infinity, vmax: 0, vtop5: 0, vmaxBy: {}, vtop5By: {}, cnt: { total: 0, clean: 0, OUT: 0, IN: 0, ANU: 0, LENTA: 0, SAL: 0 }, cleanN: [], stP: [], bySession: {} };
  for (const sid of ctx.avail) {
    const cl = CLS[sid][num] || [], offL = ctx.off[sid], offT = sum(offL), kind = SESS[sid].kind;
    const OFF = SD[sid].official || {}, bp = OFF.bp && OFF.bp[num], spd = OFF.spd && OFF.spd[num];
    const bs = { best: Infinity, ideal: Infinity, sec: [Infinity, Infinity, Infinity, Infinity], secStrict: [Infinity, Infinity, Infinity, Infinity], vmax: 0, vtop5: 0,
      n: cl.length, clean: 0, excluded: EXCL[sid] ? (EXCL[sid][num] || 0) : 0, official: null, flagged: [] };
    const speeds = [];
    for (const l of cl) {
      o.cnt.total++; if (l.why) o.cnt[l.why]++; else { o.cnt.clean++; bs.clean++; }
      if (l.v) speeds.push(l.v);
      if (!l.why) {
        if (l.t < bs.best) bs.best = l.t;
        if (l.t < o.best) { o.best = l.t; o.bestSid = sid; }
        if (kind !== 'race') { const tn = l.t - offT; o.cleanN.push(tn); if (tn < o.bestN) o.bestN = tn; const tq = l.t - sum(ctx.offQ[sid]); if (tq < o.bestQ) o.bestQ = tq; }
      }
      if (sectorUsable(l)) for (let k = 0; k < 4; k++) if (!l.sx[k] && l.s[k] < bs.secStrict[k]) bs.secStrict[k] = l.s[k];
    }
    bs.sec = bs.secStrict.slice();
    if (bp && cl.length) {   // official partials count only when a clean lap of the Analysis (no out/in-lap, no cancelled sector) confirms them
      bs.sec = bs.secStrict.map((st, k) => {
        const ov = bp.sec[k]; if (ov == null) return st;
        const ok = cl.some(l => sectorUsable(l) && !l.sx[k] && Math.abs(l.s[k] - ov) < 0.0015);
        if (!ok) { bs.flagged.push(k); return st; }
        return Math.min(ov, st);
      });
      bs.official = { it: bp.it, bt: bp.bt };
    }
    bs.ideal = sum(bs.sec);
    if (cl.length) {
      speeds.sort((x, y) => y - x);
      bs.vmax = (spd && spd.max) || speeds[0] || 0;
      bs.vtop5 = (spd && spd.avg) || (speeds.length ? mean(speeds.slice(0, 5)) : 0);
      if (bs.vmax) { o.vmaxBy[sid] = bs.vmax; o.vmax = Math.max(o.vmax, bs.vmax); }
      if (bs.vtop5) { o.vtop5By[sid] = bs.vtop5; o.vtop5 = Math.max(o.vtop5, bs.vtop5); }
    }
    if (kind !== 'race') for (let k = 0; k < 4; k++) {
      if (bs.sec[k] < o.sec[k]) o.sec[k] = bs.sec[k];
      const sn = bs.sec[k] - offL[k]; if (sn < o.secN[k]) o.secN[k] = sn;
    }
    o.bySession[sid] = bs;
    if (kind === 'prac') o.stP.push(...stintsFor(sid, num, ctx));
  }
  o.ideal = sum(o.sec); o.idealN = sum(o.secN);
  o.margin = isFinite(o.best) && isFinite(o.ideal) ? Math.max(0, o.best - o.ideal) : NaN;
  const low3 = [...o.cleanN].sort((a, b) => a - b).slice(0, 3);
  o.sd3 = low3.length >= 3 ? stdev(low3) : 0.15;
  o.nPush = o.cleanN.length;
  return o;
}

const shrink = (b, n, prior, k, hi = 0.09) => clamp((n * b + k * prior) / (n + k), 0, hi);   // hi: practice slopes are noisy (0.09 cap); slopes measured in a real Sprint/Race may be much steeper
function sprintEst(A) {
  const st = A.stP; let pool = st.filter(s => s.len >= 5), mode = 'short';
  if (!pool.length) { pool = st.filter(s => s.len >= 3); mode = 'mini'; }
  if (pool.length) {
    const s = pool.reduce((m, x) => x.med < m.med ? x : m, pool[0]);
    const b = shrink(s.b, s.len, 0.025, 5);
    return { a: s.med - b * (s.len - 1) / 2 + CAL.spr[mode], b, sd: s.sd, len: s.len, mode, comp: s.comp };
  }
  return { a: A.bestN + CAL.spr.best, b: 0.03, sd: 0.2, len: 0, mode: 'best' };
}
function raceEst(A, spr) {
  const st = A.stP; let pool = st.filter(s => s.len >= 9), mode = 'long';
  if (!pool.length) { pool = st.filter(s => s.len >= 4); mode = 'short'; }
  if (!pool.length) { pool = st.filter(s => s.len >= 3); mode = 'mini'; }
  let e;
  if (pool.length) {
    const s = pool.reduce((m, x) => (x.len > m.len || (x.len === m.len && x.med < m.med)) ? x : m, pool[0]);
    const b = shrink(s.b, s.len, 0.03, 6);
    e = { a: s.med - b * (s.len - 1) / 2 + CAL.race[mode], b, sd: s.sd, len: s.len, mode, comp: s.comp };
  } else e = { a: A.bestN + CAL.race.best, b: 0.03, sd: 0.2, len: 0, mode: 'best' };
  if (spr && spr.len >= 6) {   // blend with real Sprint pace once available
    const aS = spr.a + CAL.sprToRace;
    e.a = 0.45 * e.a + 0.55 * aS; e.b = 0.5 * e.b + 0.5 * shrink(spr.b, spr.len, 0.03, 6, 0.25); e.mode = e.mode + '+spr';
  }
  return e;
}
const totalTime = (a, b, N, pen) => a + START_LOSS + (N - 1) * a + b * (N - 1) * (N - 2) / 2 + pen;
const paceOf = (a, b, N) => a + b * (N - 2) / 2;

/* real race pace (laps 2..N normalised to rear Medium) */
function realRaceStint(sid, num, ctx) {
  const s = stintsFor(sid, num, ctx || { off: { [sid]: [0, 0, 0, 0] } });
  return s.length ? s.reduce((m, x) => x.len > m.len ? x : m, s[0]) : null;
}

const CONF_BASE = { long: 82, short: 56, mini: 42, best: 22 };
function confOf(est, nClean, extra) {
  const m = est.mode.split('+')[0];
  return Math.round(clamp(CONF_BASE[m] + (est.mode.includes('+spr') ? 10 : 0) + Math.min(8, nClean * 0.4) - Math.min(18, est.sd * 90) + (extra || 0), 5, 96));
}

/* ---- official race-control incidents (pit entry, crash, retirement, penalty) of a real Sprint/Race, by rider ---- */
const INC_KINDS = ['crash', 'retire', 'pit', 'penalty'];
function incidentsOf(sd, sid, num) { const ev = (sd[sid] && sd[sid].official && sd[sid].official.events) || []; return ev.filter(e => e.num === num && INC_KINDS.includes(e.kind)); }

/* ---- predictions of a milestone ---- */
function predictions(mid) {
  const ctx = buildCtx(mid), A = {};
  for (const n of NUMS) A[n] = analyzeRider(n, ctx);
  const hasData = n => isFinite(A[n].best);
  const evo = EVO_EXPECT[mid] || 0;
  // ---- POLE
  const pole = { id: 'POLE', label: 'Pole (Q2)', known: ctx.poleKnown, rows: [] };
  if (ctx.poleKnown) {
        pole.rows = ctx.grid.map((n, i) => {
      const raw = sid => classify(sid, SD[sid].riders[String(n)] || []).filter(l => !l.why);
      const cl = raw('Q2').length ? raw('Q2') : raw('Q1');
      const t = cl.length ? Math.min(...cl.map(l => l.t)) : null;
      return { num: n, pos: i + 1, T: t, conf: 100 };
    });
  } else {
    pole.rows = NUMS.filter(hasData).map(n => {
      const a = A[n], T = a.bestQ + 1.4 * evo - 0.4 * (isFinite(a.margin) ? a.margin : 0.1) + 0.35 * a.sd3 + Math.max(0, 6 - a.nPush) * 0.04;
      const conf = Math.round(clamp(38 + Math.min(40, a.nPush * 2.2) - a.sd3 * 40, 5, 95));
      return { num: n, T, conf, margin: a.margin, sd3: a.sd3, ideal: a.ideal, best: a.best };
    }).sort((x, y) => x.T - y.T).map((r, i) => Object.assign(r, { pos: i + 1 }));
  }
  const gridPos = {};
  const polePos = Object.fromEntries(pole.rows.map(r => [r.num, r.pos]));
  const gridOf = g => n => { const i = g ? g.indexOf(n) : -1; return i >= 0 ? i + 1 : (polePos[n] || 12); };
  const gpS = gridOf(ctx.gridS), gpR = gridOf(ctx.gridR);
  const starter = (g, off) => n => !off || g.includes(n);                  // an official grid also tells who does NOT start (injured / absent riders)
  const vs = NUMS.filter(hasData).map(n => A[n].vtop5).filter(Boolean), vmed = median(vs);
  // ---- SPRINT
  const N1 = DATA.circuit.sprintLaps, N2 = DATA.circuit.raceLaps;
  const sprKnown = ctx.avail.includes('SPR'), racKnown = ctx.avail.includes('RAC');
  const sprint = { id: 'SPR', label: 'Sprint', known: sprKnown, rows: [], gridOff: ctx.gridOff.SPR };
  const sprEstBy = {};
  for (const n of NUMS) if (hasData(n)) sprEstBy[n] = sprintEst(A[n]);
  if (sprKnown) sprint.rows = SD.SPR.results.map(r => ({ num: r.num, pos: r.pos, T: r.time, gap: r.gap, status: r.status, conf: 100 }));
  else {
    sprint.rows = NUMS.filter(hasData).filter(starter(ctx.gridS, ctx.gridOff.SPR)).map(n => {
      const e = sprEstBy[n], pen = 0.10 * (gpS(n) - 1) - 0.003 * ((A[n].vtop5 || vmed) - vmed) * (N1 - 1);
      const T = totalTime(e.a + evo, e.b, N1, pen);
      return { num: n, T, pace: paceOf(e.a + evo, e.b, N1), deg: e.b, sd: e.sd, mode: e.mode, len: e.len, conf: confOf(e, A[n].nPush, ctx.gridOff.SPR ? 6 : ctx.grid ? 4 : 0), grid: gpS(n) };
    }).sort((x, y) => x.T - y.T);
    const w = sprint.rows[0].T; sprint.rows.forEach((r, i) => { r.pos = i + 1; r.gap = r.T - w; });
  }
  // ---- RACE
  const race = { id: 'RAC', label: 'Carrera', known: racKnown, rows: [], gridOff: ctx.gridOff.RAC };
  if (racKnown) race.rows = SD.RAC.results.map(r => ({ num: r.num, pos: r.pos, T: r.time, gap: r.gap, status: r.status, conf: 100 }));
  else {
    race.rows = NUMS.filter(hasData).filter(starter(ctx.gridR, ctx.gridOff.RAC)).map(n => {
      let sprS = null;
      if (sprKnown && !incidentsOf(SD, 'SPR', n).length) { const s = realRaceStint('SPR', n); if (s) sprS = { a: s.a, b: s.b, len: s.len }; }   // a Sprint with a pit stop / crash says nothing about that rider's race pace
      const e = raceEst(A[n], sprS), pen = 0.06 * (gpR(n) - 1) - 0.003 * ((A[n].vtop5 || vmed) - vmed) * (N2 - 1);
      const T = totalTime(e.a + evo, e.b, N2, pen);
      return { num: n, T, pace: paceOf(e.a + evo, e.b, N2), deg: e.b, sd: e.sd, mode: e.mode, len: e.len, conf: confOf(e, A[n].nPush, (sprKnown ? 4 : 0) + (ctx.gridOff.RAC ? 2 : 0)), grid: gpR(n), vmax: A[n].vmax };
    }).sort((x, y) => x.T - y.T);
    const w = race.rows[0].T; race.rows.forEach((r, i) => { r.pos = i + 1; r.gap = r.T - w; });
  }
  return { mid, ctx, A, pole, sprint, race, vmed };
}
const VIEWS = {};
function buildView(name, sd) {
  SD = sd; GR = name === 'auto' ? (DATA.grids || {}) : {}; const b = buildCls(sd); CLS = b.cls; EXCL = b.ex; SNAP = {};
  for (const m of MILESTONES) SNAP[m.id] = predictions(m.id);
  VIEWS[name] = { SD, GR, CLS, EXCL, SNAP };
}
const HAS_SIM_OVERRIDE = Object.keys(DATA.sim || {}).length > 0;
buildView('auto', DATA.sessions);
if (HAS_SIM_OVERRIDE) buildView('sim', Object.assign({}, DATA.sessions, DATA.sim)); else VIEWS.sim = VIEWS.auto;
function setView(v) { const V = VIEWS[v]; if (!V) return; VIEW = v; SD = V.SD; GR = V.GR; CLS = V.CLS; EXCL = V.EXCL; SNAP = V.SNAP; }
setView('auto');

/* ---- accuracy: prediction vs reality ---- */
function realPace(sid, num) {
  const s = realRaceStint(sid, num); return s ? { pace: mean(s.tn), n: s.len, deg: s.b } : null;
}
function accuracy(target, snapId) {
  const sn = SNAP[snapId], pred = target === 'POLE' ? sn.pole : target === 'SPR' ? sn.sprint : sn.race;
  const real = target === 'POLE' ? SNAP.SAT.pole : target === 'SPR' ? SNAP.SPR.sprint : SNAP.RAC.race;
  const pTop = pred.rows.slice(0, 3).map(r => r.num), rTop = real.rows.slice(0, 3).map(r => r.num);
  const overlap = pTop.filter(n => rTop.includes(n)).length, exact = pTop.filter((n, i) => rTop[i] === n).length;
  const rows = [], dnf = [], inc = []; const sid = target === 'SPR' ? 'SPR' : target === 'RAC' ? 'RAC' : null;
  const REAL = VIEWS.auto.SD, incOf = n => sid ? incidentsOf(REAL, sid, n) : [];   // race-control incidents printed under the official classification
  const realGrid = target === 'POLE' ? null : Object.fromEntries(SNAP.SAT[target === 'SPR' ? 'sprint' : 'race'].rows.map(r => [r.num, r.grid]));   // official grid (known from Q2 on)
  if (sid) {
    for (const p of pred.rows) {
      const rr = real.rows.find(r => r.num === p.num), rp = realPace(sid, p.num);
      if (rr && rr.status === 'DNF') { dnf.push({ num: p.num, predPos: p.pos, laps: rr.laps, ev: incOf(p.num) }); continue; }
      if (rr && incOf(p.num).length) { inc.push({ num: p.num, predPos: p.pos, realPos: rr.pos, ev: incOf(p.num) }); continue; }   // pit/ride-through/crash-and-remount: pace not representative
      if (!rr || !rp || !isFinite(p.pace)) continue;
      rows.push({ num: p.num, predPos: p.pos, realPos: rr.pos, predPace: p.pace, realPace: rp.pace, d: p.pace - rp.pace, predDeg: p.deg, realDeg: rp.deg, conf: p.conf, gridPred: p.grid, gridReal: realGrid[p.num] });
    }
  }
  const mae = rows.length ? mean(rows.map(r => Math.abs(r.d))) : null, bias = rows.length ? mean(rows.map(r => r.d)) : null;
  const rankErr = rows.length ? mean(rows.map(r => Math.abs(r.predPos - r.realPos))) : (target === 'POLE' ? mean(pred.rows.slice(0, 10).map(r => { const rr = real.rows.find(x => x.num === r.num); return rr ? Math.abs(rr.pos - r.pos) : 0; })) : null);
  // ---- clean-simulation diagnostics: how much of the miss is a common offset of the whole field vs. individual events the model does not contemplate
  let maeClean = null, common = null, outliers = [];
  if (rows.length >= 6) {
    const res = rows.map(r => r.d - bias), med = median(res), mad = 1.4826 * median(res.map(x => Math.abs(x - med))), thr = Math.max(0.30, 2.5 * mad);
    rows.forEach((r, i) => { r.res = res[i]; r.out = Math.abs(res[i]) > thr; });
    outliers = rows.filter(r => r.out).sort((a, b) => Math.abs(b.res) - Math.abs(a.res));
    maeClean = mean(rows.filter(r => !r.out).map(r => Math.abs(r.d)));
    const share = rows.filter(r => Math.sign(r.d) === Math.sign(bias)).length / rows.length;
    common = { bias, share, strong: Math.abs(bias) >= 0.20 && share >= 0.7, thr };
  }
  // positions: riders present in both orders and that finished
  const pr = pred.rows.map(p => { const rr = real.rows.find(r => r.num === p.num); return rr && rr.status !== 'DNF' ? { pp: p.pos, rp: rr.pos } : null; }).filter(Boolean);
  const within2 = pr.length ? Math.round(100 * pr.filter(x => Math.abs(x.pp - x.rp) <= 2).length / pr.length) : null;
  let rho = null;
  if (pr.length > 3) { const ra = a => { const o = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = []; o.forEach(([, i], k) => r[i] = k + 1); return r; };
    const A = ra(pr.map(x => x.pp)), B = ra(pr.map(x => x.rp)), n = pr.length; rho = 1 - 6 * sum(A.map((a, i) => (a - B[i]) ** 2)) / (n * (n * n - 1)); }
  const gridErr = rows.length && rows.every(r => r.gridReal) ? mean(rows.map(r => Math.abs(r.gridPred - r.gridReal))) : null;
  // ---- conditions: official track/air temperature of the target session vs. the sessions the snapshot was built from
  let cond = null;
  if (sid && REAL[sid] && REAL[sid].official && REAL[sid].official.cond) {
    const ct = REAL[sid].official.cond, refs = MILESTONES.find(m => m.id === snapId).sessions.map(x => ({ sid: x, c: REAL[x] && REAL[x].real && REAL[x].official && REAL[x].official.cond })).filter(x => x.c);
    cond = { target: ct, refs, dGround: refs.length ? ct.ground - refs[refs.length - 1].c.ground : null };
  }
  return { target, snapId, pTop, rTop, overlap, exact, pct: Math.round(overlap / 3 * 100), mae, maeClean, bias, rankErr, within2, rho, gridErr, common, outliers, dnf, inc, cond, rows };
}
/* ---- sim vs real, session by session ---- */
function sessStat(cls, sid, n) {
  const cl = (cls[sid] && cls[sid][n]) || []; if (!cl.length) return null;
  const ok = cl.filter(l => !l.why), sec = [Infinity, Infinity, Infinity, Infinity]; let vmax = 0;
  for (const l of cl) { if (l.v) vmax = Math.max(vmax, l.v); if (sectorUsable(l)) for (let k = 0; k < 4; k++) if (!l.sx[k] && l.s[k] < sec[k]) sec[k] = l.s[k]; }
  if (!ok.length) return null;
  const ts = ok.map(l => l.t).sort((a, b) => a - b);
  return { best: ts[0], ideal: sec.every(isFinite) ? sum(sec) : NaN, vmax, n: cl.length,
    pace: SESS[sid].kind === 'race' ? mean(ts) : mean(ts.slice(0, 3)) };
}
function rankMap(vals) { const o = Object.entries(vals).sort((a, b) => a[1] - b[1]); const r = {}; o.forEach(([k], i) => r[k] = i + 1); return r; }
function compareSession(sid) {
  const A = VIEWS.auto, S = VIEWS.sim;
  if (!A.SD[sid] || !A.SD[sid].real || !(DATA.sim && DATA.sim[sid])) return null;
  const rows = [];
  for (const n of NUMS) {
    const r = sessStat(A.CLS, sid, n), s = sessStat(S.CLS, sid, n);
    if (r && s) rows.push({ num: n, real: r, sim: s, dBest: s.best - r.best, dIdeal: s.ideal - r.ideal, dV: s.vmax - r.vmax, dPace: s.pace - r.pace });
  }
  if (!rows.length) return null;
  const pos = (sd, key) => { const m = {}; if (sd[sid].results) sd[sid].results.forEach(x => m[x.num] = x.pos); return Object.keys(m).length ? m : null; };
  const byBest = (k) => rankMap(Object.fromEntries(rows.map(r => [r.num, r[k].best])));
  const pr = pos(A.SD, 'real') || byBest('real'), ps = pos(S.SD, 'sim') || byBest('sim');
  rows.forEach(r => { r.rReal = pr[r.num]; r.rSim = ps[r.num]; r.dRank = (r.rSim || 0) - (r.rReal || 0); });
  const withRank = rows.filter(r => r.rReal && r.rSim), n = withRank.length;
  const d2 = sum(withRank.map(r => (r.rReal - r.rSim) ** 2));
  const rho = n > 2 ? 1 - 6 * d2 / (n * (n * n - 1)) : NaN;
  const top = (m) => Object.entries(m).sort((a, b) => a[1] - b[1]).slice(0, 3).map(x => +x[0]);
  const tr = top(pr), ts = top(ps);
  const fin = x => x.filter(v => isFinite(v));
  return { sid, rows, n: rows.length, maeBest: mean(rows.map(r => Math.abs(r.dBest))), biasBest: mean(rows.map(r => r.dBest)),
    maeIdeal: mean(fin(rows.map(r => Math.abs(r.dIdeal)))), maePace: mean(rows.map(r => Math.abs(r.dPace))), biasPace: mean(rows.map(r => r.dPace)),
    maeV: mean(rows.map(r => Math.abs(r.dV))), rho, topReal: tr, topSim: ts, overlap: ts.filter(x => tr.includes(x)).length, exact: ts.filter((x, i) => tr[i] === x).length };
}
/* ============================ /ENGINE ============================ */
