"""Bake the Maleda physics into sims.bin.

Runs the page once with ?bake in headless Chrome (the page runs the hero drop, bowl tip and jar landing simulations
live and exposes the encoded recordings), gzips them and writes sims.bin next to index.html. Re-run whenever the
berries, bowl, jar or physics change; a stale sims.bin is detected by its signature and the page then simulates live.

  python tools/bake.py [http://localhost:8765/]
"""
import sys, base64, gzip, pathlib, time
from playwright.sync_api import sync_playwright
url = (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8765/').rstrip('/') + '/?bake'
out = pathlib.Path(__file__).resolve().parent.parent / 'sims.bin'
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width': 1400, 'height': 900})
    pg.on('console', lambda m: print('console:', m.text) if m.type in ('error', 'warning') else None)
    t = time.time(); pg.goto(url)
    pg.wait_for_function('window.__bake', timeout=240000, polling=500)
    raw = base64.b64decode(pg.evaluate('''()=>{const a=window.__bake;let s='';for(let i=0;i<a.length;i+=32768)s+=String.fromCharCode.apply(null,a.subarray(i,i+32768));return btoa(s);}'''))
    b.close()
gz = gzip.compress(raw, compresslevel=9, mtime=0)
out.write_bytes(gz)
print(f'baked in {time.time()-t:.1f}s: {len(raw)} bytes raw, {len(gz)} bytes gzip -> {out}')
