/* Banco de pruebas de calibracion: prueba variantes del modelo de ritmo de carrera contra las carreras REALES que haya en el repositorio.
   No se usa en el panel; lo lanza tools/calibrar.py con los datos de cada circuito:   node tools/calibrar.js datos_malasya.json datos_catar.json ...
   Para cada variante (tanda elegida, peso de la Sprint, offset de tanda corta, prior del Mundial) mide, por circuito y por hito (SAT = tras Q2, SPR = tras la Sprint),
   el error de ritmo (MAE), la correlacion de posiciones (rho de Spearman) y cuantos del podio real acierta. Nada se aplica solo: sirve para decidir con datos. */
const vm = require('vm'), fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/engine.js', 'utf8');
const files = process.argv.slice(2);
const f = (x, d = 3) => x == null || !isFinite(x) ? '—' : x.toFixed(d);

function load(file, opt) {
  const DATA = JSON.parse(fs.readFileSync(file, 'utf8'));
  let src = SRC; if (opt.prior != null) src = src.replace(/const PRIOR_WC = [0-9.]+;/, `const PRIOR_WC = ${opt.prior};`);
  const ctx = vm.createContext({ DATA, BIO: {}, console, Math, Object, JSON, Number, Array, isFinite, Infinity, NaN });
  vm.runInContext(src, ctx);
  if (opt.race) vm.runInContext(`
    const OPT = ${JSON.stringify(opt)};
    CAL.race.short = OPT.calShort; CAL.race.mini = OPT.calShort + 0.08;
    raceEst = function (A, spr) {
      const st = A.stP; let pool = st.filter(s => s.len >= 9), mode = 'long';
      if (OPT.stint === 'fastest') { pool = st.filter(s => s.len >= 4); mode = 'short'; if (!pool.length) { pool = st.filter(s => s.len >= 3); mode = 'mini'; } }
      else { if (!pool.length) { pool = st.filter(s => s.len >= 4); mode = 'short'; } if (!pool.length) { pool = st.filter(s => s.len >= 3); mode = 'mini'; } }
      let e;
      if (pool.length) {
        const s = OPT.stint === 'fastest' ? pool.reduce((m, x) => x.med < m.med ? x : m, pool[0]) : pool.reduce((m, x) => (x.len > m.len || (x.len === m.len && x.med < m.med)) ? x : m, pool[0]);
        const b = shrink(s.b, s.len, 0.03, 6);
        e = { a: s.med - b * (s.len - 1) / 2 + CAL.race[mode], b, sd: s.sd, len: s.len, mode, comp: s.comp, compF: s.compF };
      } else e = { a: A.bestN + CAL.race.best, b: 0.03, sd: 0.2, len: 0, mode: 'best', comp: A.bestTyre && A.bestTyre.r, compF: A.bestTyre && A.bestTyre.f };
      if (spr && spr.len >= 6) { const aS = spr.a + CAL.sprToRace; e.a = (1 - OPT.wSpr) * e.a + OPT.wSpr * aS; e.b = 0.5 * e.b + 0.5 * shrink(spr.b, spr.len, 0.03, 6, 0.25); e.mode = e.mode + '+spr'; }
      return e; };
    buildView('auto', DATA.sessions); setView('auto');`, ctx);
  return ctx;
}
const BASE = { name: 'actual', race: false };
const grid = [BASE];
for (const stint of ['longest', 'fastest']) for (const wSpr of [0.35, 0.55, 0.75]) for (const calShort of [0.2, 0.34, 0.5]) for (const prior of [0.02, 0.04])
  grid.push({ name: `${stint}|spr${wSpr}|cal${calShort}|prior${prior}`, race: true, stint, wSpr, calShort, prior });

const results = grid.map(opt => {
  const per = files.map(file => {
    const ctx = load(file, opt), out = {};
    if (!vm.runInContext('SD.RAC && SD.RAC.real', ctx)) return null;
    for (const m of ['SAT', 'SPR']) { const a = vm.runInContext(`accuracy('RAC', '${m}')`, ctx); out[m] = { mae: a.mae, rho: a.rho, ov: a.overlap, w2: a.within2 }; }
    return out;
  }).filter(Boolean);
  const all = per.flatMap(o => Object.values(o));
  return { opt, per, mae: all.reduce((s, x) => s + x.mae, 0) / all.length, rho: all.reduce((s, x) => s + x.rho, 0) / all.length, ov: all.reduce((s, x) => s + x.ov, 0) / all.length };
});
const n = results[0].per.length;
console.log(`${n} carrera(s) reales analizadas; metricas medias de ${n * 2} casos (hito SAT y SPR de cada carrera)`);
const base = results[0];
console.log('variante'.padEnd(40), 'MAE'.padStart(6), 'rho'.padStart(6), 'podio'.padStart(6));
const show = r => console.log(r.opt.name.padEnd(40), f(r.mae).padStart(6), f(r.rho).padStart(6), f(r.ov, 2).padStart(6));
show(base);
console.log('--- mejores por correlacion de posiciones (rho) sin empeorar el error de ritmo en mas de un 10 %:');
results.slice(1).filter(r => r.mae <= base.mae * 1.10).sort((a, b) => b.rho - a.rho).slice(0, 8).forEach(show);
console.log('--- mejores por error de ritmo (MAE):');
results.slice(1).sort((a, b) => a.mae - b.mae).slice(0, 5).forEach(show);
if (n >= 2) {
  const best = results.slice(1).filter(r => r.mae <= base.mae * 1.10).sort((a, b) => b.rho - a.rho)[0];
  if (best) { console.log('--- detalle por carrera (rho SAT / SPR) de actual y de la mejor:');
    files.forEach((file, i) => console.log(file.split(/[\\/]/).pop().padEnd(28), 'actual', f(base.per[i].SAT.rho, 2), f(base.per[i].SPR.rho, 2), '| mejor', f(best.per[i].SAT.rho, 2), f(best.per[i].SPR.rho, 2))); }
}
console.log('Aviso: con pocas carreras una variante puede ganar por azar; solo cambia el modelo lo que mejore en TODAS las carreras.');
