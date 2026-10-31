"""Reconstruye index.html a partir de los PDFs de todos los circuitos (MALASYA/, MANDALIKA/, ...) sin servidor.

    python tools/actualizar.py              reconstruye index.html
    python tools/actualizar.py --carpetas   solo prepara las carpetas <CIRCUITO>/<sesion>/ vacias (no lee PDFs)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pipeline

if __name__ == '__main__':
    if '--carpetas' in sys.argv:
        pipeline.ensure_folders()
        pipeline.log('Carpetas preparadas para: ' + ', '.join(c['folder'] for c in pipeline.CIRCUITS))
    else:
        pipeline.write_index()
