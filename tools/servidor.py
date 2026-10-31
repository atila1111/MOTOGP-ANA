"""Servidor local: cada F5 reescanea las carpetas de circuito (MALASYA/, MANDALIKA/, PORTIMAO/, QATAR/, VALENCIA/) y reconstruye el dashboard si hay PDFs nuevos (o cambios en tools/).

    python tools/servidor.py          ->  http://localhost:8000

El panel muestra (solo con este servidor) el boton «PDF motogp.com», que llama a tools/descargar.py para bajar los informes nuevos.
"""
import http.server, importlib, json, socketserver, sys, threading
from urllib.parse import parse_qs, urlparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pipeline

import os
PORT = int(os.environ.get("PORT", 8000))
LOCK = threading.Lock()
CACHE = {'sig': None, 'html': b'', 'error': None}

def signature():
    files = pipeline.all_pdfs() + [c_dir / 'evento.json' for c_dir in (pipeline.circuit_dir(c) for c in pipeline.CIRCUITS)] + [pipeline.TOOLS / n for n in ('engine.js', 'ui.jsx', 'shell.jsx', 'template.html', 'pipeline.py')] + list(pipeline.PHOTO_DIR.glob('*.webp'))
    return tuple(sorted((str(p), p.stat().st_mtime_ns) for p in files if p.exists()))

def current_html():
    with LOCK:
        sig = signature()
        if sig != CACHE['sig']:
            print('· cambios detectados, reconstruyendo…', file=sys.stderr)
            try:
                importlib.reload(pipeline)            # pick up edits made to pipeline.py itself, not just to the PDFs / engine / UI files
                html, data = pipeline.build_html()
                (pipeline.ROOT / 'index.html').write_text(html, encoding='utf8')
                CACHE.update(sig=sig, html=html.encode('utf8'), error=None)
                print('· listo: ' + ' | '.join(f'{c["folder"]} {data["data"][c["id"]]["meta"]["real"] if data["data"][c["id"]] else "pendiente"}' for c in data['circuits']), file=sys.stderr)
            except BaseException as e:           # SystemExit from the pipeline included
                CACHE.update(sig=sig, error=str(e))
                print('! error:', e, file=sys.stderr)
        if CACHE['error']:
            return f'<pre style="color:#f87171;background:#0a0c10;padding:24px;font-size:14px">Error al construir el dashboard:\n\n{CACHE["error"]}</pre>'.encode('utf8')
        return CACHE['html']

DL_LOCK = threading.Lock()

def run_download(circuit):
    """POST /api/descargar?circuito=<id>: baja de motogp.com los PDF que falten o hayan cambiado (tools/descargar.py) y devuelve el resumen."""
    import descargar
    lines = []
    with DL_LOCK:
        r = descargar.run([circuit] if circuit else None, active_only=False, log=lambda *a: lines.append(' '.join(str(x) for x in a)))
    r['log'] = lines
    return r

class Handler(http.server.BaseHTTPRequestHandler):
    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf8')
        self.send_response(code); self.send_header('Content-Type', 'application/json; charset=utf-8'); self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_POST(self):
        u = urlparse(self.path)
        if u.path == '/api/descargar':
            try: self.send_json(run_download((parse_qs(u.query).get('circuito') or [None])[0]))
            except BaseException as e: self.send_json({'nuevos': [], 'actualizados': [], 'iguales': 0, 'avisos': [], 'errores': [str(e)], 'log': []}, 200)
        else: self.send_error(404)
    def do_GET(self):
        if self.path.split('?')[0] == '/api/estado': self.send_json({'servidor': True, 'descarga': True}); return
        if self.path.split('?')[0] in ('/', '/index.html'):
            body = current_html()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8'); self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
        else:
            self.send_error(404)
    def log_message(self, *a): pass

if __name__ == '__main__':
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(('127.0.0.1', PORT), Handler) as srv:
        print(f'Dashboard en http://localhost:{PORT}  (Ctrl+C para parar). Suelta los PDF en <CIRCUITO>/<sesión>/ y pulsa F5.', file=sys.stderr)
        try: srv.serve_forever()
        except KeyboardInterrupt: pass
