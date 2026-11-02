"""Inline CSS, data model and brain thumbnails into one standalone mockup page.

usage: python3 -I tools/build.py <round> [out_dir]
  round    r1 | r2 | r3
  out_dir  defaults to <repo>/cruft/bids-design (git-ignored)
Run tools/make_assets.py first; it writes assets.json into out_dir.
"""
import json, pathlib, sys

here = pathlib.Path(__file__).resolve().parent.parent
repo = here.parents[2]
rnd = sys.argv[1]
out_dir = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else repo / 'cruft' / 'bids-design'
assets = json.loads((out_dir / 'assets.json').read_text())
html = (here / 'src' / f'{rnd}.html').read_text()
html = html.replace('/*CSS*/', (here / 'src' / 'base.css').read_text())
html = html.replace('/*ASSETS*/', 'const A = ' + json.dumps(assets) + ';')
html = html.replace('/*DATA*/', (here / 'src' / 'data.js').read_text())
out = out_dir / f'{rnd}.html'
out.write_text(html)
print(out)
