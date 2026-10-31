"""Servidor local: cada F5 reescanea las carpetas de circuito (MALASYA/, MANDALIKA/, PORTIMAO/, QATAR/, VALENCIA/) y reconstruye el dashboard si hay PDFs nuevos (o cambios en tools/).

    python tools/servidor.py          ->  http://localhost:8000
"""
import http.server, importlib, socketserver, sys, threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pipeline

import os
PORT = int(os.environ.get("PORT", 8000))
LOCK = threading.Lock()
CACHE = {'sig': None, 'html': b'', 'error': None}

def signature():
    files = pipeline.all_pdfs() + [pipeline.TOOLS / n for n in ('engine.js', 'ui.jsx', 'shell.jsx', 'template.html', 'pipeline.py')] + list(pipeline.PHOTO_DIR.glob('*.webp'))
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

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
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
