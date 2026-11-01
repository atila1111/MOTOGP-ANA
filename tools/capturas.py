"""Genera las capturas de pantalla de docs/capturas/ que enseña el README (herramienta opcional para quien mantiene el repositorio).

    pip install playwright            (usa el Edge o Chrome ya instalado, no descarga navegadores)
    python tools/servidor.py          en otra terminal
    python tools/capturas.py [url]    por defecto http://localhost:8000/
"""
import re, sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'docs' / 'capturas'
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8000/'

def main():
    from playwright.sync_api import sync_playwright
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        try: browser = pw.chromium.launch(channel='msedge')
        except Exception: browser = pw.chromium.launch(channel='chrome')
        page = browser.new_page(viewport={'width': 1480, 'height': 900})
        def go(circuit='malasya'):
            page.goto(URL + '#' + circuit); page.reload(); page.wait_for_selector('header', timeout=120000); page.wait_for_timeout(1500)
        def click(label):
            page.get_by_role('button', name=re.compile(label)).first.click(); page.wait_for_timeout(900)
        def shot(name, scroll=0, element=None):
            page.evaluate(f'window.scrollTo(0, {scroll})'); page.wait_for_timeout(600)
            (element or page).screenshot(path=str(OUT / f'{name}.png')); print('·', name)

        go()
        click('Post-Carrera'); click('Resumen'); shot('01-resumen')
        page.evaluate("document.querySelectorAll('section').forEach(s => { if (/Histórico del circuito/i.test(s.innerText)) s.scrollIntoView({block: 'start'}); }); window.scrollBy(0, -190)"); page.wait_for_timeout(600)
        page.screenshot(path=str(OUT / '02-historico-circuito.png')); print('· 02-historico-circuito')
        page.evaluate("document.querySelectorAll('section').forEach(s => { if (/Palmarés en este circuito/i.test(s.innerText)) s.scrollIntoView({block: 'start'}); }); window.scrollBy(0, -190)"); page.wait_for_timeout(600)
        page.screenshot(path=str(OUT / '03-palmares-y-forma.png')); print('· 03-palmares-y-forma')
        click('Telemetría'); shot('04-telemetria-carrera')
        click('Post-Sprint'); click('Ritmo'); shot('05-ritmo-y-simulacion')
        click('Post-Q2|post-Q2|Sábado . post-Q2'); click('Simulador de carrera'); shot('06-simulador-de-carrera')
        click('Post-Carrera'); click('Predicción vs Realidad'); shot('07-prediccion-vs-realidad')
        go('qatar'); shot('08-circuito-pendiente-con-historico')
        browser.close()

if __name__ == '__main__':
    main()
