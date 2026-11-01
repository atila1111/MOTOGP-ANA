/* Parte común a todos los circuitos: selector y pantalla «pendiente de datos». Se carga siempre, antes del motor (no usa nada de él). */
const SHELL_SESSIONS = [['FP1', 'FP1', 'Libre 1'], ['PR', 'PR', 'Práctica'], ['FP2', 'FP2', 'Libre 2'], ['Q1', 'Q1', 'Q1'], ['Q2', 'Q2', 'Q2'], ['SPR', 'SPRINT', 'Sprint'], ['RAC', 'RACE', 'Carrera']];
const SHELL_REPORTS = 6;
function pickCircuit(id) {
  try { localStorage.setItem('motogp.circuit', id); } catch (e) {}
  location.hash = id; location.reload();
}
function CircuitSelect() {
  return <select value={CUR} onChange={e => pickCircuit(e.target.value)} aria-label="Circuito" className="bg-[#10141a] border border-[#2a313c] rounded px-2 py-1.5 text-xs text-slate-200">
    {CIRCUITS.map(c => <option key={c.id} value={c.id}>{c.flag} {c.short} · {c.gp}{c.ready ? '' : ' (sin datos)'}</option>)}
  </select>;
}
/* '2026-11-01 11:37:44' -> '01/11/2026 11:37' */
const fmtStamp = t => { const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d:\d\d)/.exec(t || ''); return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}` : null; };
const lapTxt = t => { const m = /^0?(\d+):(\d\d\.\d+)$/.exec(t || ''); return m ? `${m[1]}'${m[2]}` : (t || '—'); };
/* «Recuperar resultados de MotoGP»: pide a tools/servidor.py (POST /api/recuperar) los PDF nuevos y los datos de la API pública (Mundial, estadísticas de pilotos,
   histórico del circuito) y recarga. La fecha de la última actualización se ve siempre; el botón solo aparece si la página la sirve el servidor. */
function DescargaBtn() {
  const known = (ALL.api && ALL.api.updated) || null;                       // latest retrieval of anything (PDF or API data): the shared data is refreshed every time
  const [st, setSt] = React.useState({ srv: false, busy: false, msg: null, last: known });
  React.useEffect(() => { fetch('/api/estado').then(r => r.ok ? r.json() : null).then(j => setSt(s => ({ ...s, srv: !!(j && j.descarga) }))).catch(() => {}); }, []);
  const go = async () => {
    setSt(s => ({ ...s, busy: true, msg: 'Consultando motogp.com (PDF, Mundial, pilotos, histórico)… puede tardar un minuto' }));
    try {
      const j = await (await fetch('/api/recuperar?circuito=' + CUR, { method: 'POST' })).json(), n = j.nuevos.length + j.actualizados.length;
      const txt = j.errores.length && !n && !j.datos ? 'Error: ' + j.errores[0] : j.eventos && !j.eventos.length && !j.datos ? 'Evento no encontrado' : (n ? `${j.nuevos.length} PDF nuevos · ${j.actualizados.length} actualizados` : 'PDF sin novedades') + (j.datos ? ` · ${j.datos.pilotos} pilotos y ${Object.values(j.datos.circuitos).reduce((a, b) => a + b, 0)} ediciones` : '') + (j.errores.length ? ` · ${j.errores.length} errores` : '');
      setSt(s => ({ ...s, busy: false, msg: txt, last: j.actualizado || s.last }));
      if (j.datos || n) setTimeout(() => location.reload(), 1500);
    } catch (e) { setSt(s => ({ ...s, busy: false, msg: 'Error: ' + e })); }
  };
  const when = fmtStamp(st.last);
  return <span className="inline-flex items-center gap-2 flex-wrap">
    {st.srv && <button onClick={go} disabled={st.busy} title="Descarga de motogp.com los PDF oficiales (sesiones, evento y campeonato) y los datos de la API pública: clasificación del Mundial, estadísticas de pilotos e histórico del circuito"
      className={'px-2.5 py-1 rounded text-[11px] font-bold border transition ' + (st.busy ? 'border-slate-600 text-slate-500' : 'border-sky-500/50 text-sky-300 hover:bg-sky-500/10')}>{st.busy ? '⟳ Recuperando…' : '⟳ Recuperar resultados MotoGP'}</button>}
    <span className="text-[11px] text-slate-400 whitespace-nowrap" title={st.srv ? 'Última vez que se recuperaron datos de motogp.com' : 'Arranca iniciar.bat / iniciar.sh para poder recuperar datos desde aquí'}>Última actualización: <b className={when ? 'text-slate-200' : 'text-amber-300'}>{when || 'nunca'}</b></span>
    {st.msg && <span className="text-[11px] text-sky-300">{st.msg}</span>}</span>;
}
/* past editions of the GP from the public API (API/circuito_<COD>.json): podium, pole, fastest lap and conditions */
function HistoricoTable({ hist }) {
  const eds = (hist && hist.editions) || [];
  if (!eds.length) return <div className="text-sm text-slate-400">Sin histórico todavía: pulsa «Recuperar resultados MotoGP» con el servidor en marcha.</div>;
  const nm = x => { if (!x || !x.name) return '—'; const w = x.name.split(' '); return w.length > 1 ? w[0][0] + '. ' + w.slice(1).join(' ') : w[0]; };
  const dry = eds.filter(e => e.cond && e.cond.RAC && e.cond.RAC.track === 'Dry' && e.cond.RAC.ground);
  const avg = dry.length ? Math.round(dry.reduce((a, e) => a + e.cond.RAC.ground, 0) / dry.length) : null;
  const wins = {}; eds.forEach(e => { const w = e.race && e.race.podium && e.race.podium[0]; if (w) wins[w.name] = (wins[w.name] || 0) + 1; });
  const top = Object.entries(wins).sort((a, b) => b[1] - a[1])[0];
  return <div>
    <div className="overflow-x-auto"><table className="w-full text-xs tabular-nums">
      <thead><tr className="text-left text-[10px] uppercase tracking-wider text-slate-500"><th className="pr-3 py-1.5">Año</th><th className="pr-3">Ganador carrera</th><th className="pr-3">Tiempo</th><th className="pr-3">Podio</th><th className="pr-3">Pole</th><th className="pr-3">V. rápida carrera</th><th className="pr-3">Vtas</th><th className="pr-3">Pista (carrera)</th></tr></thead>
      <tbody>{eds.map(e => { const r = e.race, pod = r && r.podium, c = e.cond && e.cond.RAC;
        return <tr key={e.year} className="border-t border-[#1a2029]">
          <td className="pr-3 py-1.5 font-bold text-slate-200">{e.year}</td>
          <td className="pr-3 text-slate-100">{pod ? pod[0].name : '—'}<span className="text-slate-500"> {pod && pod[0].cons}</span></td>
          <td className="pr-3 text-slate-300">{pod && pod[0].time ? pod[0].time : '—'}</td>
          <td className="pr-3 text-slate-400">{pod ? pod.slice(1).map(nm).join(' · ') : '—'}</td>
          <td className="pr-3 text-slate-300">{e.pole ? <>{lapTxt(e.pole.time)} <span className="text-slate-500">{nm(e.pole)}</span></> : '—'}</td>
          <td className="pr-3 text-slate-300">{e.race_fl ? <>{lapTxt(e.race_fl.time)} <span className="text-slate-500">{nm(e.race_fl)}</span></> : '—'}</td>
          <td className="pr-3 text-slate-400">{e.laps && e.laps.RAC || '—'}</td>
          <td className="pr-3 text-slate-300">{c ? <><span className={c.track === 'Dry' ? '' : 'text-sky-300'}>{c.track === 'Dry' ? 'Seco' : 'Mojado'}</span> · {c.ground != null ? c.ground + '°' : '—'}<span className="text-slate-500"> aire {c.air != null ? c.air + '°' : '—'} · {c.hum != null ? c.hum + '%' : '—'}</span></> : '—'}</td></tr>; })}</tbody></table></div>
    <p className="text-[11px] text-slate-500 mt-2">{eds.length} ediciones{avg != null ? ` · pista media en carrera (en seco) ${avg}°` : ''}{top && top[1] > 1 ? ` · más victorias: ${top[0]} (${top[1]})` : ''}. Fuente: API pública de motogp.com{hist.record ? ` · récord de vuelta ${lapTxt(hist.record.time)} ${hist.record.name} (${hist.record.year})` : ''}.</p></div>;
}
function BrandMark() {
  return <div className="flex items-center gap-2"><div className="w-1.5 h-7 bg-red-600 skew-x-[-18deg]" /><div><div className="font-black tracking-[0.18em] text-white leading-none text-sm">MOTOGP<span className="text-red-500">·</span>TELEMETRY</div><div className="text-[10px] text-slate-500 tracking-widest">PERFORMANCE & PREDICTION LAB{ALL.version ? ' · v' + ALL.version : ''}</div></div></div>;
}
function PendingApp() {
  const c = CIRC, found = c.found || {};
  return <div className="min-h-screen">
    <header className="border-b border-[#1f2630] bg-[#0a0c10]/95">
      <div className="max-w-[1100px] mx-auto px-4 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-2"><BrandMark /><CircuitSelect /><DescargaBtn /></div>
    </header>
    <main className="max-w-[1100px] mx-auto px-4 py-8 space-y-4">
      <section className="rounded-lg border border-[#1f2630] bg-[#0d1117] p-5">
        <div className="text-[11px] uppercase tracking-widest text-amber-300 font-bold mb-1">Pendiente de datos</div>
        <h1 className="text-xl font-black text-white">{c.flag} {c.gp}</h1>
        <div className="text-sm text-slate-400">{c.name} · {c.length} km</div>
        {c.start && <div className="text-xs text-sky-300 mt-1">Fin de semana: {c.start} → {c.end} · {c.raceLaps} vueltas de carrera{c.sprintLaps ? ` · ${c.sprintLaps} de Sprint` : ''}{c.record ? ` · récord ${lapTxt(String(Math.floor(c.record.t / 60)) + ':' + (c.record.t % 60).toFixed(3).padStart(6, '0'))} ${c.record.who} (${c.record.year})` : ''}</div>}
        <p className="text-sm text-slate-300 mt-4 leading-relaxed">
          Este circuito se activa cuando existan los PDF de <b className="text-slate-100">FP1</b> y <b className="text-slate-100">PR</b> (el «Analysis» de ambas sesiones es obligatorio: de ahí sale el ritmo real del viernes que ancla la simulación).
          Las demás sesiones se simulan hasta que subas sus carpetas.
        </p>
        {c.missing && c.missing.length > 0 && Object.keys(found).length > 0 && <p className="text-[13px] text-amber-300 mt-2">Faltan: {c.missing.map(s => c.folder + '/' + s + '/Analysis').join(' · ')}</p>}
      </section>
      {c.hist && <section className="rounded-lg border border-[#1f2630] bg-[#0d1117] p-5">
        <div className="text-[11px] uppercase tracking-widest text-slate-500 font-bold mb-3">Histórico del circuito · API motogp.com</div><HistoricoTable hist={c.hist} /></section>}
      <section className="rounded-lg border border-[#1f2630] bg-[#0d1117] p-5">
        <div className="text-[11px] uppercase tracking-widest text-slate-500 font-bold mb-3">Carpetas de sesión · <code className="text-amber-300 normal-case tracking-normal">{c.folder}/</code></div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {SHELL_SESSIONS.map(([sid, dir, label]) => {
            const kinds = found[sid] || [], base = sid === 'FP1' || sid === 'PR';
            return <div key={sid} className={'rounded border px-3 py-2 text-xs ' + (kinds.length ? 'border-emerald-500/40 bg-emerald-500/5' : base ? 'border-amber-500/40 bg-amber-500/5' : 'border-[#2a313c]')}>
              <div className="font-bold text-slate-100">{label}</div>
              <div className="text-[11px] text-slate-500 break-all">{dir}/</div>
              <div className={'mt-1 ' + (kinds.length ? 'text-emerald-400' : base ? 'text-amber-300' : 'text-slate-600')}>{kinds.length ? kinds.length + '/' + SHELL_REPORTS + ' informes' : base ? 'obligatoria' : 'vacía'}</div>
            </div>;
          })}
        </div>
        <ol className="list-decimal ml-5 mt-4 space-y-1 text-[13px] text-slate-400">
          <li>Pulsa «Recuperar resultados MotoGP» (con el servidor en marcha) o <code className="text-amber-300">python tools/descargar.py --circuito {c.id}</code> para bajarlos de la web; o copia a mano los PDF oficiales de cada sesión en su carpeta: Analysis, Classification, Best Partial Times, Maximum Speed, Top Speed &amp; Average y Fastest Laps Sequence (o el «Session.pdf» completo).</li>
          <li>Con <code className="text-amber-300">python tools/servidor.py</code> abre <code className="text-amber-300">http://localhost:8000/#{c.id}</code> y pulsa F5. Sin servidor: <code className="text-amber-300">python tools/actualizar.py</code> y recarga <code className="text-amber-300">index.html</code>.</li>
        </ol>
      </section>
    </main>
  </div>;
}
