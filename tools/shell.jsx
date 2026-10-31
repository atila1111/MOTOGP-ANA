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
/* «PDF motogp.com»: solo aparece si la página la sirve tools/servidor.py (GET /api/estado). Baja los informes nuevos del circuito activo y recarga. */
function DescargaBtn() {
  const [st, setSt] = React.useState({ srv: false, busy: false, msg: null });
  React.useEffect(() => { fetch('/api/estado').then(r => r.ok ? r.json() : null).then(j => setSt(s => ({ ...s, srv: !!(j && j.descarga) }))).catch(() => {}); }, []);
  if (!st.srv) return null;
  const go = async () => {
    setSt(s => ({ ...s, busy: true, msg: 'Consultando motogp.com…' }));
    try {
      const j = await (await fetch('/api/descargar?circuito=' + CUR, { method: 'POST' })).json(), n = j.nuevos.length + j.actualizados.length;
      setSt({ srv: true, busy: false, msg: n ? `${j.nuevos.length} nuevos · ${j.actualizados.length} actualizados` : j.errores.length ? 'Error: ' + j.errores[0] : j.eventos && !j.eventos.length ? 'Evento no encontrado' : 'Sin novedades' + (j.avisos && j.avisos.length ? ` (${j.avisos.length} avisos)` : '') });
      if (n) setTimeout(() => location.reload(), 1200);
    } catch (e) { setSt({ srv: true, busy: false, msg: 'Error: ' + e }); }
  };
  return <span className="inline-flex items-center gap-2"><button onClick={go} disabled={st.busy} title="Descarga de motogp.com los PDF oficiales que falten o hayan cambiado en este circuito"
    className={'px-2.5 py-1 rounded text-[11px] font-bold border transition ' + (st.busy ? 'border-slate-600 text-slate-500' : 'border-sky-500/50 text-sky-300 hover:bg-sky-500/10')}>{st.busy ? '⟳ Descargando…' : '⟳ PDF motogp.com'}</button>
    {st.msg && <span className="text-[11px] text-slate-400">{st.msg}</span>}</span>;
}
function BrandMark() {
  return <div className="flex items-center gap-2"><div className="w-1.5 h-7 bg-red-600 skew-x-[-18deg]" /><div><div className="font-black tracking-[0.18em] text-white leading-none text-sm">MOTOGP<span className="text-red-500">·</span>TELEMETRY</div><div className="text-[10px] text-slate-500 tracking-widest">PERFORMANCE & PREDICTION LAB</div></div></div>;
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
        <p className="text-sm text-slate-300 mt-4 leading-relaxed">
          Este circuito se activa cuando existan los PDF de <b className="text-slate-100">FP1</b> y <b className="text-slate-100">PR</b> (el «Analysis» de ambas sesiones es obligatorio: de ahí sale el ritmo real del viernes que ancla la simulación).
          Las demás sesiones se simulan hasta que subas sus carpetas.
        </p>
        {c.missing && c.missing.length > 0 && Object.keys(found).length > 0 && <p className="text-[13px] text-amber-300 mt-2">Faltan: {c.missing.map(s => c.folder + '/' + s + '/Analysis').join(' · ')}</p>}
      </section>
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
          <li>Pulsa «PDF motogp.com» (con el servidor en marcha) o <code className="text-amber-300">python tools/descargar.py --circuito {c.id}</code> para bajarlos de la web; o copia a mano los PDF oficiales de cada sesión en su carpeta: Analysis, Classification, Best Partial Times, Maximum Speed, Top Speed &amp; Average y Fastest Laps Sequence (o el «Session.pdf» completo).</li>
          <li>Con <code className="text-amber-300">python tools/servidor.py</code> abre <code className="text-amber-300">http://localhost:8000/#{c.id}</code> y pulsa F5. Sin servidor: <code className="text-amber-300">python tools/actualizar.py</code> y recarga <code className="text-amber-300">index.html</code>.</li>
        </ol>
      </section>
    </main>
  </div>;
}
