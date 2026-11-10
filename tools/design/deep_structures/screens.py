import json, os, sys
import shell as S
R = os.path.abspath(sys.argv[1]); m = json.load(open(f'{R}/meta.json'))
def img(n): return f'file://{R}/{n}.png'
def num(x, d=2): return f'{x:.{d}f}'.replace('-', '−')
ax = m['axis']; cr = m['cross']; ssel = ax['s_sel']; HIPP = m['state'] == 'hipp'; NAME = ax['name']; STOPS = ax['stops']
PLANE = 'Oblique, across the hippocampal long axis' if HIPP else 'Coronal'

CSS = """
.key{display:flex;gap:18px;align-items:center;height:22px;padding:0 10px;background:var(--panel);border-bottom:1px solid var(--bs);font-size:11px;color:var(--t2)}
.key span{display:flex;gap:6px;align-items:center}
.lab{position:absolute;font-size:10px;line-height:12px;color:#e9eaec;text-shadow:0 0 2px #000,0 0 2px #000,0 0 3px #000,0 0 4px #000;white-space:nowrap}
.bar{position:absolute;height:0;border-top:1.5px solid #e9eaec;box-shadow:0 0 0 1px #000}
.ttl{height:18px;padding:0 6px;font-size:11px;line-height:18px;color:var(--t2);background:#000;white-space:nowrap;overflow:hidden}
"""
def cbar():
    return (f'<div class="cbar"><span>≤ −10</span><div class="cb" style="width:60px;background:{S.NEG}"></div><span>−3.1</span>'
            f'<div class="cb" style="width:16px;background:#555659"></div><span>3.1</span><div class="cb" style="width:60px;background:{S.POS}"></div><span>≥ 10</span><span style="font-family:var(--sans);font-style:italic;margin-left:2px">z</span></div>')
def glyph(axes, size=24):
    o = []
    for k, (dx, dy) in axes.items():
        if (dx * dx + dy * dy) ** .5 < 0.25: continue
        o.append(f'<line x1="32" y1="36" x2="{32 + dx * size:.1f}" y2="{36 + dy * size:.1f}" stroke="#e9eaec" stroke-width="1.2"/><text x="{32 + dx * (size + 8):.1f}" y="{36 + dy * (size + 8) + 3.5:.1f}" fill="#e9eaec" font-size="10" text-anchor="middle" font-family="IBM Plex Mono">{k}</text>')
    return f'<svg width="72" height="72" style="position:absolute;left:4px;bottom:2px;overflow:visible">{"".join(o)}</svg>'
def scalebar(ppmm, mm=20, right=10, bottom=10, extra=''):
    return f'<div class="bar" style="right:{right}px;bottom:{bottom}px;width:{ppmm * mm:.1f}px"></div><div class="lab mono" style="right:{right}px;bottom:{bottom + 4}px">{mm} mm{extra}</div>'

def hero(w, h):
    k = m['hero']; x, y = k['cross']; ih = w * k['size'][1] / k['size'][0]
    pts = [(a[0] * w, a[1] * ih) for a in k['axis']]
    line = f'<polyline points="{" ".join(f"{px:.1f},{py:.1f}" for px, py in pts)}" fill="none" stroke="#000" stroke-width="3"/><polyline points="{" ".join(f"{px:.1f},{py:.1f}" for px, py in pts)}" fill="none" stroke="#e9eaec" stroke-width="1"/>'
    tk = []
    for s, (px, py) in zip(STOPS, pts):
        sel = abs(s - ssel) < 0.1
        tk.append(f'<rect x="{px - (4 if sel else 2):.1f}" y="{py - (4 if sel else 2):.1f}" width="{8 if sel else 4}" height="{8 if sel else 4}" fill="{"#5fe0a0" if sel else "#e9eaec"}" stroke="#000" stroke-width="1"/>')
        if sel: tk.append(f'<text x="{px - 44:.1f}" y="{py + 20:.1f}" fill="#e9eaec" font-size="10" font-family="IBM Plex Mono" stroke="#000" stroke-width="2.5" paint-order="stroke">{num(s, 0)} mm</text>')
    names = ''.join(f'<div class="lab" style="left:{p[0] * w:.0f}px;top:{p[1] * ih:.0f}px;transform:translate(-50%,-50%)">{nm}</div>' for nm, p in k['names'].items())
    return f"""<div style="width:{w}px;height:{h}px;display:flex;flex-direction:column;background:#000">
<div class="ttl">Cortex cut, structures whole · {PLANE.lower()} · {num(ssel, 0)} mm from the {ax['origin']}</div>
<div class="canvas" style="flex:1;overflow:hidden"><img src="{img('hero')}" style="display:block;width:{w}px">
<svg style="position:absolute;left:0;top:0;width:{w}px;height:{ih:.0f}px">{line}{''.join(tk)}</svg>{names}
<div class="mark" style="left:{x * w:.0f}px;top:{y * ih:.0f}px"></div>
<div class="lab muted" style="right:10px;top:6px;color:var(--t3)">Outline: the removed half</div>
{glyph(k['axes'])}{scalebar(k['ppm'] * w / k['size'][0])}</div></div>"""

def face(w, LC=62):
    f = m['face']; h = w * f['h_mm'] / f['w_mm']; o = []
    want = ['5', '6', '4', '10', '9'] if HIPP else ['5', '6', '4', '9']
    items = sorted([f['labels'][l] for l in want if l in f['labels']], key=lambda q: q['y'])
    ys = []
    for q in items:
        yy = max(q['y'] * h, 16)
        if ys and yy < ys[-1] + 13: yy = ys[-1] + 13
        ys.append(yy)
    lead = []
    for q, yy in zip(items, ys):
        o.append(f'<div class="lab" style="right:{w + 6}px;top:{yy - 6:.0f}px">{q["name"]}</div>')
        x1 = -4
        lead.append(f'<line x1="{x1:.0f}" y1="{yy:.0f}" x2="{q["x"] * w:.0f}" y2="{q["y"] * h:.0f}" stroke="#000" stroke-width="2.4"/><line x1="{x1:.0f}" y1="{yy:.0f}" x2="{q["x"] * w:.0f}" y2="{q["y"] * h:.0f}" stroke="#bdbfc4" stroke-width="0.8"/><circle cx="{q["x"] * w:.0f}" cy="{q["y"] * h:.0f}" r="1.8" fill="#e9eaec" stroke="#000" stroke-width="0.8"/>')
    o.append(f'<svg style="position:absolute;left:0;top:0;width:{w}px;height:{h:.0f}px;overflow:visible">{"".join(lead)}</svg>')
    for hm in (('L', 'R') if HIPP else ('W',)):
        b = m[f'zoom_{hm}']['box']
        o.append(f'<div style="position:absolute;left:{b[0] * 100:.2f}%;top:{b[1] * 100:.2f}%;width:{b[2] * 100:.2f}%;height:{b[3] * 100:.2f}%;border:1px solid #9a9da3;box-shadow:0 0 0 1px rgba(0,0,0,.8)"></div>')
    fx, fy = cr['face']
    html = f"""<div style="width:{w + LC}px"><div class="ttl">The face · {'top: anterior-superior' if HIPP else 'coronal'} · left on the left</div>
<div class="canvas" style="width:{w}px;height:{h:.0f}px;margin-left:{LC}px"><img src="{img('face')}" style="display:block;width:{w}px">
{''.join(o)}<div class="mark" style="left:{fx * 100:.1f}%;top:{fy * 100:.1f}%"></div><div class="bar" style="right:6px;top:16px;width:{w / f['w_mm'] * 20:.1f}px"></div><div class="lab mono" style="right:6px;top:3px">20 mm</div></div></div>"""
    return html, h + 18

def zoomW(w, h):
    k = m['zoom_W']
    return f"""<div class="canvas" style="width:{w}px;height:{h}px;overflow:hidden;outline:1px solid #9a9da3;outline-offset:-1px"><img src="{img('zoom_W')}" style="display:block;width:{w}px">
<div class="lab" style="left:6px;top:5px">Both thalami · ×{w / 88.0 / (FWPX / 152.0):.1f} · 2 mm voxels</div>
<div style="position:absolute;left:50%;top:0;bottom:0;border-left:1px dashed rgba(233,234,236,.5)"></div>
<div class="lab" style="left:{k['L'][0] * 100:.0f}%;top:22px;transform:translateX(-50%)">Left thalamus</div><div class="lab" style="left:{k['R'][0] * 100:.0f}%;top:22px;transform:translateX(-50%)">Right thalamus</div>
<div class="mark" style="left:{k['cross'][0] * 100:.1f}%;top:{k['cross'][1] * 100:.1f}%"></div>
<div class="lab mono" style="left:6px;bottom:5px">L</div><div class="lab mono" style="right:62px;bottom:5px">R</div>{scalebar(w / 88.0, 10, 6, 6)}</div>"""

def zoom(hm, w, h):
    k = m[f'zoom_{hm}']
    mk = f'<div class="mark" style="left:{cr["zoom"][0] * 100:.1f}%;top:{cr["zoom"][1] * 100:.1f}%"></div>' if hm == 'L' else ''
    labs = ''.join(f'<div class="lab" style="left:{p[0] * 100:.0f}%;top:{p[1] * 100:.0f}%;transform:translate(-50%,-190%)">{nm}</div>' for nm, p in k['labels'].items() if nm in (NAME, 'Amygdala', 'Thalamus', 'Putamen', 'Caudate', 'Hippocampus', 'Pallidum', 'Brainstem') and 0.08 < p[0] < 0.92 and 0.12 < p[1] < 0.9)
    lat, med = ('Lateral', 'Medial') if hm == 'L' else ('Medial', 'Lateral')
    return f"""<div class="canvas" style="width:{w}px;height:{h}px;overflow:hidden;outline:1px solid #9a9da3;outline-offset:-1px"><img src="{img('zoom_' + hm)}" style="display:block;width:{w}px">
<div class="lab" style="left:6px;top:5px">{'Left' if hm == 'L' else 'Right'} · ×{w / 44.0 / (FWPX / 152.0):.1f} · 2 mm voxels</div>{labs}{mk}
<div class="lab" style="left:6px;bottom:5px;color:#bdbfc4">{lat}</div><div class="lab" style="right:62px;bottom:5px;color:#bdbfc4">{med}</div>{scalebar(w / 44.0, 10, 6, 6)}</div>"""

def lat(hm, w, h):
    k = m[f'lat_{hm}']; iw = h * 190 / 136; x0 = (w - iw) / 2; o = []
    for s, t in k['traces'].items():
        sel = abs(float(s) - ssel) < 0.1
        if sel:
            o.append(f'<line x1="{t[0] * iw:.1f}" y1="{t[1] * h:.1f}" x2="{t[2] * iw:.1f}" y2="{t[3] * h:.1f}" stroke="#000" stroke-width="3.4"/><line x1="{t[0] * iw:.1f}" y1="{t[1] * h:.1f}" x2="{t[2] * iw:.1f}" y2="{t[3] * h:.1f}" stroke="#5fe0a0" stroke-width="1.4"/><rect x="{t[2] * iw - 3:.1f}" y="{t[3] * h - 3:.1f}" width="6" height="6" fill="#5fe0a0" stroke="#000"/>')
        else:
            x1, y1 = t[2] + (t[0] - t[2]) * 0.09, t[3] + (t[1] - t[3]) * 0.09
            o.append(f'<line x1="{x1 * iw:.1f}" y1="{y1 * h:.1f}" x2="{t[2] * iw:.1f}" y2="{t[3] * h:.1f}" stroke="#000" stroke-width="2.6"/><line x1="{x1 * iw:.1f}" y1="{y1 * h:.1f}" x2="{t[2] * iw:.1f}" y2="{t[3] * h:.1f}" stroke="#e9eaec" stroke-width="1"/>')
    a, p = ('A', 'P') if hm == 'L' else ('P', 'A')
    return f"""<div class="canvas" style="width:{w}px;height:{h}px;overflow:hidden"><img src="{img('lat_' + hm)}" style="display:block;height:{h}px;margin-left:{x0:.0f}px">
<svg style="position:absolute;left:{x0:.0f}px;top:0;width:{iw:.0f}px;height:{h}px">{''.join(o)}</svg>
<div class="lab" style="left:5px;top:3px;color:#bdbfc4">{'Left' if hm == 'L' else 'Right'}, uncut</div>
<div class="lab mono" style="left:5px;bottom:3px">{a}</div><div class="lab mono" style="right:5px;bottom:3px">{p}</div></div>"""

def prof_svg(own, other, key, x0, x1, cut, brush, dot=None):
    allv = [q['q3'] for q in own + other] + [q['q1'] for q in own + other] + [m['cross']['z']] * (0 if HIPP else 1)
    ZT, ZB = max(3.0, max(allv) + 1.5), min(-4.5, min(allv) - 1.5)
    def Y(z): return (ZT - z) / (ZT - ZB) * 100
    def Xc(v): return (v - x0) / (x1 - x0) * 1000
    def line(p, k='mean'): return ' '.join(f"{Xc(q[key]):.0f},{Y(q[k]):.1f}" for q in p)
    s = ['<svg viewBox="0 0 1000 100" preserveAspectRatio="none" style="display:block;width:100%;height:100%;overflow:visible">',
         f'<rect x="{Xc(brush[0]):.0f}" y="0" width="{Xc(brush[1]) - Xc(brush[0]):.0f}" height="100" fill="rgba(255,255,255,.09)"/>',
         f'<rect x="{Xc(cut[0]):.0f}" y="0" width="{max(Xc(cut[1]) - Xc(cut[0]), 3):.0f}" height="100" fill="rgba(95,224,160,.22)"/>',
         f'<line x1="0" x2="1000" y1="{Y(0):.1f}" y2="{Y(0):.1f}" stroke="rgba(233,234,236,.72)" vector-effect="non-scaling-stroke"/>',
         f'<line x1="0" x2="1000" y1="{Y(-3.1):.1f}" y2="{Y(-3.1):.1f}" stroke="rgba(255,255,255,.3)" stroke-dasharray="2 3" vector-effect="non-scaling-stroke"/>',
         f'<line x1="0" x2="1000" y1="{Y(3.1):.1f}" y2="{Y(3.1):.1f}" stroke="rgba(255,255,255,{0.3 if ZT > 4.2 else 0})" stroke-dasharray="2 3" vector-effect="non-scaling-stroke"/>',
         f'<polyline points="{line(own, "q1")}" fill="none" stroke="rgba(233,234,236,.4)" stroke-width="1" vector-effect="non-scaling-stroke"/>',
         f'<polyline points="{line(own, "q3")}" fill="none" stroke="rgba(233,234,236,.4)" stroke-width="1" vector-effect="non-scaling-stroke"/>',
         f'<polyline points="{line(other)}" fill="none" stroke="#8d9096" stroke-width="1.5" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>',
         f'<polyline points="{line(own)}" fill="none" stroke="#e9eaec" stroke-width="2" vector-effect="non-scaling-stroke"/>',
         f'<line x1="{Xc(cut[0]):.0f}" x2="{max(Xc(cut[1]), Xc(cut[0]) + 3):.0f}" y1="1.5" y2="1.5" stroke="#5fe0a0" stroke-width="3" vector-effect="non-scaling-stroke"/></svg>']
    if dot is not None:
        s.append(f'<div style="position:absolute;left:{Xc(dot[0]) / 10:.1f}%;top:{Y(max(dot[1], ZB + 0.4)):.1f}%;width:7px;height:7px;margin:-4px 0 0 -4px;border-radius:50%;border:1.5px solid var(--cross);background:#000"></div>')
    ticks = ''.join(f'<div class="mono" style="position:absolute;left:-30px;width:26px;text-align:right;top:{Y(z):.1f}%;margin-top:-7px;font-size:10px;line-height:14px;color:var(--t2)">{lab}</div>' for z, lab in ((0, '0'), (-3.1, '−3.1'), (3.1, '3.1'), (-10, '−10'), (8, '8')) if ZB + 1 < z < ZT - 1)
    ends = ''
    return ''.join(s) + ticks + ends

def sheet(hm, w=316):
    k = m[f'sheet_{hm}']; ot = m[f'sheet_{"R" if hm == "L" else "L"}']; h = w * k['pd_mm'] / k['ap_mm']; g = k['grat']
    side = 'Left' if hm == 'L' else 'Right'
    # crops above the sheet, each tied to its graticule line
    cw, ch = 52, 42; n = len(STOPS); gap = (w - n * cw) / (n - 1); tiles, leads = [], []
    for i, s in enumerate(STOPS):
        x = i * (cw + gap); sel = abs(s - ssel) < 0.1
        tiles.append(f'<div style="position:absolute;left:{x:.0f}px;top:0;width:{cw}px;height:{ch}px;background:#000;outline:1px solid {"var(--cross)" if sel else "rgba(255,255,255,.28)"}"><img src="{img(f"crop_{hm}_{i}")}" style="display:block;width:{cw}px;height:{ch}px"><div class="lab mono" style="left:2px;top:1px">{num(s, 0)}</div></div>')
        if str(s) in g: leads.append(f'<line x1="{x + cw / 2:.0f}" y1="{ch}" x2="{g[str(s)]["top"] * w:.0f}" y2="{ch + 10}" stroke="{"#5fe0a0" if sel else "#8d9096"}" stroke-width="1"/>')
    rl = ''.join(f'<div style="position:absolute;right:{w + 5}px;top:{r["pd"] * 100:.1f}%;margin-top:-7px;font-size:10px;line-height:14px;color:var(--t2)">{r["name"] if r["name"] != "Subiculum" else "Sub"}</div>' for r in k['row'][:4])
    # subfield dot plot, shared axis -10..0, this side filled, other hollow
    DW = 54
    def dx(v): return (v + 8) / 8 * DW
    dots = [f'<div style="position:absolute;left:{w + 12}px;top:0;bottom:0;width:{DW}px;border-left:1px solid rgba(255,255,255,.16);border-right:1px solid rgba(233,234,236,.72)"></div>',
            f'<div style="position:absolute;left:{w + 12 + dx(-3.1):.0f}px;top:0;bottom:0;border-left:1px dashed rgba(255,255,255,.3)"></div>'] + [f'<div class="mono" style="position:absolute;left:{w + 12 + dx(v):.0f}px;top:100%;transform:translateX(-50%);font-size:10px;line-height:13px;color:var(--t2)">{lb}</div>' for v, lb in ((-8, '−8'), (-3.1, '−3.1'), (0, '0'))]
    for r, r2 in zip(k['row'][:4], ot['row'][:4]):
        for v, own in ((r2['mean'], False), (r['mean'], True)):
            col = '#e9eaec' if abs(v) >= 3.1 else '#76797f'
            dots.append(f'<div style="position:absolute;left:{w + 12 + dx(v):.0f}px;top:{r["pd"] * 100:.1f}%;width:7px;height:7px;margin:-4px 0 0 -4px;border-radius:50%;border:1.5px solid {col};background:{col if own else "var(--panel)"}"></div>')
        dots.append(f'<div class="mono" style="position:absolute;left:{w + 12 + DW + 5}px;top:{r["pd"] * 100:.1f}%;margin-top:-7px;font-size:10px;line-height:14px;color:{"var(--t2)" if abs(r["mean"]) >= 3.1 else "var(--tf)"}">{num(r["mean"], 2)}</div>')
    sel = g[str(int(ssel))]; b = k['brush']; b0, b1 = b['t0'], b['t1']
    glab = ''.join(f'<div class="lab mono" style="left:{v["top"] * 100:.1f}%;top:2px;transform:translateX(-50%);color:{"#5fe0a0" if abs(float(sg) - ssel) < 0.1 else "#e9eaec"}">{sg}</div>' for sg, v in g.items() if float(sg) >= ssel)
    mmt = ''.join(f'<div class="mono" style="position:absolute;left:{v["tmed"] * 100:.1f}%;top:0;transform:translateX(-50%);font-size:10px;line-height:12px;color:{"var(--cross)" if abs(float(s) - ssel) < 0.1 else "var(--t2)"}"><div style="width:0;height:4px;border-left:1px solid currentColor;margin:0 auto"></div>{s}</div>' for s, v in g.items())
    return f"""<div style="flex:1;padding:5px 0 0 38px;min-width:0">
<div style="width:{w + 104}px;display:flex;justify-content:space-between;align-items:baseline;white-space:nowrap"><span><span style="font-weight:600">{side} hippocampus, unfolded</span> <span class="muted" style="font-size:11px">ribbon mean {num(k['mean'])}</span></span><span class="muted" style="font-size:10px">subfield mean, <i>z</i></span></div>
<div style="position:relative;width:{w}px;height:{ch + 10}px;margin-top:3px">{''.join(tiles)}<svg style="position:absolute;left:0;top:0;width:{w}px;height:{ch + 10}px">{''.join(leads)}</svg></div>
<div style="position:relative;width:{w}px;height:{h:.0f}px;background:#000"><img src="{img('sheet_' + hm)}" style="display:block;width:{w}px;height:{h:.0f}px">{rl}{''.join(dots)}{glab}</div>
<div style="position:relative;width:{w}px;height:62px;margin-top:2px">{prof_svg(k['col'], ot['col'], 't', 0, 1, (sel['t0'], sel['t1']), (b0, b1))}</div>
<div style="position:relative;width:{w}px;height:18px">{mmt}<div class="muted" style="position:absolute;left:{w + 4}px;top:3px;font-size:10px;line-height:12px;white-space:nowrap">mm, straight axis</div></div>
<div style="display:flex;justify-content:space-between;width:{w}px;font-size:10px;line-height:13px" class="muted"><span>0% head</span><span class="mono" style="color:var(--t2)">{b['t0'] * 100:.0f}–{b['t1'] * 100:.0f}%: mean {num(b['mean'])}, {b['n']} vertices</span><span>tail 100%</span></div></div>"""

def longsec(hm, w=312):
    k = m[f'long_{hm}']; ot = m[f'long_{"R" if hm == "L" else "L"}']; a0, a1 = k['ax']; h = w * k['h_mm'] / (a1 - a0)
    side = 'Left' if hm == 'L' else 'Right'; b = k['brush']
    def xp(s): return (s - a0) / (a1 - a0) * 100
    tk = ''.join(f'<div style="position:absolute;left:{xp(s):.1f}%;top:0;bottom:0;border-left:1px {"solid var(--cross)" if abs(s - ssel) < 0.1 else "dashed rgba(233,234,236,.55)"}"></div>' for s in STOPS)
    mmt = ''.join(f'<div class="mono" style="position:absolute;left:{xp(s):.1f}%;top:0;transform:translateX(-50%);font-size:10px;line-height:12px;color:{"var(--cross)" if abs(s - ssel) < 0.1 else "var(--t2)"}"><div style="width:0;height:4px;border-left:1px solid currentColor;margin:0 auto"></div>{s}</div>' for s in STOPS)
    dot = (ssel, cr['z']) if hm == 'L' else None
    return f"""<div style="flex:1;padding:5px 0 0 38px;min-width:0">
<div style="white-space:nowrap"><span style="font-weight:600">{side} {NAME.lower()}, long-axis section</span> <span class="muted" style="font-size:11px">sagittal x {num(k['x_mm'], 0)} · mean {num(k['mean'])}</span></div>
<div style="position:relative;width:{w}px;height:{h:.0f}px;background:#000;margin-top:4px"><img src="{img('long_' + hm)}" style="display:block;width:{w}px;height:{h:.0f}px">{tk}
<div class="lab mono" style="left:4px;top:3px">A</div><div class="lab mono" style="right:4px;top:3px">P</div><div class="lab mono" style="right:4px;bottom:3px">10 mm</div><div class="bar" style="right:4px;bottom:16px;width:{10 / (a1 - a0) * w:.0f}px"></div></div>
<div style="position:relative;width:{w}px;height:84px;margin-top:2px">{prof_svg(k['profile'], ot['profile'], 's', a0, a1, (ssel - 0.4, ssel + 0.4), (b['s0'], b['s1']), dot)}</div>
<div style="position:relative;width:{w}px;height:18px">{mmt}<div class="muted" style="position:absolute;left:{w + 4}px;top:3px;font-size:10px;line-height:12px;white-space:nowrap">mm</div></div>
<div style="width:{w}px;text-align:center;font-size:10px;line-height:13px;color:var(--t2)" class="mono">{num(b['s0'], 0)}–{num(b['s1'], 0)} mm from the {ax['origin']}: mean {num(b['mean'])}, {b['n'] / 1000:.1f} cm³</div></div>"""

def spark(row):
    W, H = 60, 16
    def pts(v): return ' '.join(f'{i * W / 15:.1f},{H / 2 - max(-8, min(8, x)) / 8 * (H / 2 - 1):.1f}' for i, x in enumerate(v) if x is not None)
    y31 = 3.1 / 8 * (H / 2 - 1)
    return (f'<svg width="{W}" height="{H}" style="flex:none"><line x1="0" x2="{W}" y1="{H / 2}" y2="{H / 2}" stroke="rgba(255,255,255,.34)"/>'
            f'<line x1="0" x2="{W}" y1="{H / 2 - y31:.1f}" y2="{H / 2 - y31:.1f}" stroke="rgba(255,255,255,.12)"/><line x1="0" x2="{W}" y1="{H / 2 + y31:.1f}" y2="{H / 2 + y31:.1f}" stroke="rgba(255,255,255,.12)"/>'
            f'<polyline points="{pts(row["R"]["spark"])}" fill="none" stroke="#8d9096" stroke-width="1.2"/><polyline points="{pts(row["L"]["spark"])}" fill="none" stroke="#e9eaec" stroke-width="1.3"/></svg>')

def pbar(row):
    neg = (row['L']['neg'] + row['R']['neg']) / 2; pos = (row['L']['pos'] + row['R']['pos']) / 2
    return (f'<svg width="36" height="12" style="flex:none"><rect x="{18 - neg * 18:.1f}" y="3" width="{neg * 18:.1f}" height="6" fill="rgb(96,170,235)"/><rect x="18" y="3" width="{pos * 18:.1f}" height="6" fill="rgb(232,130,50)"/>'
            f'<line x1="18" x2="18" y1="0" y2="12" stroke="#e9eaec"/><line x1="0.5" x2="0.5" y1="4" y2="8" stroke="#76797f"/><line x1="35.5" x2="35.5" y1="4" y2="8" stroke="#76797f"/></svg>')

def table():
    rows = []
    for nm, row in m['table'].items():
        sel = nm == NAME; L, Rr = row['L'], row['R']
        mean = f'{num(L["mean"])} {num(Rr["mean"])}' if nm != 'Brainstem' else num(L['mean'])
        rows.append(f'<div class="row{" sel" if sel else ""}" style="margin:0 -12px;padding:0 12px;gap:5px"><span style="flex:1;min-width:0">{nm}</span>{spark(row)}{pbar(row)}<span class="mono" style="font-size:11px;width:76px;flex:none;text-align:right">{mean}</span></div>')
        if sel:
            rows.append(f'<div style="margin:0 -12px;padding:2px 12px 5px;background:var(--active);box-shadow:inset 2px 0 0 var(--amber);font-size:10px;line-height:14px;color:var(--t2)" class="mono">volume {L["n"] / 1000:.1f} · {Rr["n"] / 1000:.1f} cm³ · about {L["n"] / 8:.0f} · {Rr["n"] / 8:.0f} map voxels<br>above 3.1: {L["pos"] * 100:.0f}% · {Rr["pos"] * 100:.0f}% &nbsp; below −3.1: {L["neg"] * 100:.0f}% · {Rr["neg"] * 100:.0f}%</div>')
    return f"""<div class="sec"><div class="h" style="margin-bottom:4px">Deep structures</div>
<div class="kv"><span>Labels</span><span>Harvard-Oxford th25, atlas</span></div>
<div class="kv"><span>Template</span><span>MNI152NLin6Asym <span class="pill" style="color:var(--ok);background:rgba(108,197,150,.14)">Matches</span></span></div>
<div style="display:flex;font-size:10px;line-height:14px;margin:8px 0 2px;gap:8px" class="muted"><span style="flex:1">Profile −8 to 8 (L white) · share beyond ±3.1</span><span style="white-space:nowrap">mean <i>z</i>, L R</span></div>{''.join(rows)}</div>
<div class="sec"><div class="h" style="margin-bottom:4px">Cut</div>
<div class="kv"><span>Plane</span><span>{'Across hippocampal long axis' if HIPP else 'Coronal'}</span></div>
<div class="kv"><span>Position</span><span class="mono">{num(ssel, 0)} mm · tilt {ax['tilt_deg']:.0f}°</span></div>
<div class="kv"><span>Grids</span><span>Map 2 mm, nearest · labels 1 mm</span></div>
<div class="kv"><span>Surfaces</span><span>{'Ribbon mean; nuclei 2 mm inside' if HIPP else 'Mask meshes, 2 mm inside'}</span></div></div>"""

HH = 380; LC = 62; FWPX = 234; fw = FWPX; fhtml, fh = face(fw, LC); zw = 221; zh = int(zw * 34 / 44); lw = 442 - fw - LC - 1; lh = int((fh - 1) / 2)
fy0 = 18; fhi = fh - 18; zy = HH - zh
def bc(b): return (LC + (b[0] + b[2] / 2) * fw, fy0 + (b[1] + b[3]) * fhi)
if HIPP:
    pairs = ((bc(m['zoom_L']['box']), (zw / 2, zy)), (bc(m['zoom_R']['box']), (zw + 1 + zw / 2, zy)))
    zooms = zoom('L', zw, zh) + zoom('R', zw, zh)
else:
    pairs = ((bc(m['zoom_W']['box']), (221, zy)),)
    zooms = zoomW(442, zh)
leads = ''.join(f'<line x1="{x1:.0f}" y1="{y1:.0f}" x2="{x2:.0f}" y2="{y2:.0f}" stroke="#000" stroke-width="2.6"/><line x1="{x1:.0f}" y1="{y1:.0f}" x2="{x2:.0f}" y2="{y2:.0f}" stroke="#9a9da3" stroke-width="1"/>' for (x1, y1), (x2, y2) in pairs)
dock = (sheet('L') + sheet('R')) if HIPP else (longsec('L') + longsec('R'))
note = 'White: this side, with quartiles · dashed: other side · CA4 and dentate not shown · unfolded template units' if HIPP else 'White: this side, with quartiles · dashed: other side · no template surfaces: sections and mask means'
centre = f"""<div class="tabs"><span class="on">Deep</span><span style="margin-left:auto;padding-right:10px">{cbar()}</span></div>
<div class="key"><span><span style="width:26px;height:3px;background:{S.POS}"></span>Cortex: surface value on the midthickness contour</span>
<span><span style="width:12px;height:10px;background:{S.NEG};outline:1px solid #bbb"></span>Deep: voxels inside atlas outlines</span>
<span><span style="width:14px;height:9px;border:1px solid rgb(158,77,41);border-radius:5px"></span>Threshold contour in unlabelled tissue</span></div>
<div style="display:flex;gap:1px;background:#000;height:{HH}px">{hero(487, HH)}
<div style="width:442px;position:relative;background:#000">
<div style="display:flex;gap:1px">{fhtml}<div style="display:flex;flex-direction:column;gap:1px">{lat('L', lw, lh)}{lat('R', lw, lh)}</div></div>
<div style="position:absolute;left:0;top:{zy}px;display:flex;gap:1px">{zooms}</div>
<svg style="position:absolute;left:0;top:0;width:442px;height:{HH}px;pointer-events:none">{leads}</svg></div></div>
<div class="dock" style="flex:1;border-top:1px solid var(--b)"><div class="tabs"><span>Activity</span><span class="on">Plot</span><span>Clusters</span><span>Log</span>
<span style="margin-left:auto;font-size:11px;padding-right:12px">{note}</span></div>
<div style="display:flex">{dock}</div></div>"""
w = cr['world']
status = (f'<span>Coordinate system <b>RAS</b></span><span>Crosshair <b style="color:var(--cross)">({num(w[0], 1)}, {num(w[1], 1)}, {num(w[2], 1)})</b></span>'
          f'<span>Layer <b>WM_2BK-0BK_zstat1.nii.gz</b></span><span>Voxel <b>z = {num(cr["z"])}</b>{" beyond colour range" if abs(cr["z"]) > 10 else ""}</span>'
          f'<span>Left {NAME.lower()}, {num(ssel, 0)} mm from {ax["origin"]}</span><span style="margin-left:auto">MNI152NLin6Asym</span>')
open(f'{R}/h.html', 'w').write(S.page(centre, S.inspector(table()), status, css=CSS))
print('html ok')
