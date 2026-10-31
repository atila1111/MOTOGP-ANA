"""Descarga la foto oficial de cada piloto de MotoGP (API publica de motogp.com) a tools/fotos/<numero>.webp.

    python tools/fotos.py              descarga las que falten
    python tools/fotos.py --forzar     vuelve a descargar todas
    python tools/fotos.py 2026         temporada (por defecto 2026)

La API devuelve a los pilotos oficiales y sustitutos de la categoria MotoGP con su numero y su foto de perfil. Las imagenes
se reducen a 220 px de ancho (WebP, ~15 KB) y pipeline.py las incrusta en index.html. Son propiedad de MotoGP / Dorna:
uso privado, igual que los PDF.
"""
import io, json, sys, urllib.request
from pathlib import Path

from PIL import Image

OUT = Path(__file__).resolve().parent / 'fotos'
CAT = '737ab122-76e1-4081-bedb-334caaa18c70'               # categoria MotoGP
UA = {'User-Agent': 'Mozilla/5.0 (motogp-ana photo fetch)'}

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r: return r.read()

def main():
    force = '--forzar' in sys.argv
    year = next((a for a in sys.argv[1:] if a.isdigit()), '2026')
    OUT.mkdir(exist_ok=True)
    riders = json.loads(get(f'https://api.pulselive.motogp.com/motogp/v1/riders?categoryUuid={CAT}&seasonYear={year}'))
    n_ok = n_skip = 0
    for r in riders:
        cs = r.get('current_career_step') or {}
        if (cs.get('category') or {}).get('name') != 'MotoGP' or not cs.get('number'): continue
        num, pic = cs['number'], ((cs.get('pictures') or {}).get('profile') or {}).get('main')
        name = f"{r['name']} {r['surname']}"
        dest = OUT / f'{num}.webp'
        if not pic: print(f'  ! #{num} {name}: sin foto'); continue
        if dest.exists() and not force: n_skip += 1; continue
        try:
            im = Image.open(io.BytesIO(get(pic))).convert('RGBA')
            im.thumbnail((220, 330))
            im.save(dest, 'WEBP', quality=82, method=6)
            n_ok += 1; print(f'  #{num:<3} {name:<24} {dest.stat().st_size // 1024} KB')
        except Exception as e:
            print(f'  ! #{num} {name}: {e}')
    print(f'Fotos: {n_ok} descargadas, {n_skip} ya existian -> {OUT}')

if __name__ == '__main__':
    main()
