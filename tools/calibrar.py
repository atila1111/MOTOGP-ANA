"""Banco de pruebas para recalibrar el modelo de ritmo de carrera con las carreras REALES del repositorio (herramienta de mantenimiento, no la usa el panel).

    python tools/calibrar.py                 usa todos los circuitos con Carrera real (p. ej. MALASYA y QATAR)
    python tools/calibrar.py malasya qatar   solo esos

Necesita Node.js. Construye los datos de cada circuito, los pasa a tools/calibrar.js y enseña que variante (tanda elegida, peso de la Sprint, offset de tanda corta,
prior del Mundial) acierta mas. No cambia nada: la decision de aplicar un cambio es tuya.
"""
import json, shutil, subprocess, sys, tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pipeline

def main(argv):
    ids = argv or [c['id'] for c in pipeline.CIRCUITS]
    tmp = Path(tempfile.mkdtemp(prefix='calibrar_')); files = []
    for cid in ids:
        data = pipeline.build_data(cid)
        if not data or 'RAC' not in data['meta']['real']:
            print(f'· {cid}: sin Carrera real, se omite'); continue
        f = tmp / f'{cid}.json'; f.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf8'); files.append(str(f))
        print(f'· {cid}: Carrera real incluida')
    if not files: print('No hay ninguna Carrera real que contrastar.'); return 1
    node = shutil.which('node')
    if not node: print('Hace falta Node.js (https://nodejs.org) para ejecutar tools/calibrar.js'); return 1
    r = subprocess.run([node, str(Path(__file__).resolve().parent / 'calibrar.js')] + files)
    shutil.rmtree(tmp, ignore_errors=True)
    return r.returncode

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
