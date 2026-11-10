"""Static mock of the Brainflow shell, modelled on e2e/harness/__screenshots__/darwin/integrated-1280x800.png."""
import os
# Folder holding the IBM Plex woff2 files (see README.md).
FONTS = os.environ['BF_DEEP_FONTS']

CSS = """
@font-face{font-family:'IBM Plex Sans';font-weight:400;src:url('file://%(F)s/ibm-plex-sans-latin-400-normal.woff2')}
@font-face{font-family:'IBM Plex Sans';font-weight:400;font-style:italic;src:url('file://%(F)s/ibm-plex-sans-latin-400-italic.woff2')}
@font-face{font-family:'IBM Plex Sans';font-weight:500;src:url('file://%(F)s/ibm-plex-sans-latin-500-normal.woff2')}
@font-face{font-family:'IBM Plex Sans';font-weight:600;src:url('file://%(F)s/ibm-plex-sans-latin-600-normal.woff2')}
@font-face{font-family:'IBM Plex Mono';font-weight:400;src:url('file://%(F)s/ibm-plex-mono-latin-400-normal.woff2')}
@font-face{font-family:'IBM Plex Mono';font-weight:500;src:url('file://%(F)s/ibm-plex-mono-latin-500-normal.woff2')}
:root{--app:#1b1c1f;--panel:#222326;--raised:#2a2b2f;--sunken:#151619;--hover:#2e2f33;--active:#36383d;
--bs:rgba(255,255,255,.08);--b:rgba(255,255,255,.16);--bstrong:rgba(255,255,255,.28);--bfield:rgba(255,255,255,.38);
--t1:#e9eaec;--t2:#bdbfc4;--t3:#a4a7ad;--tf:#76797f;--amber:#d4a556;--primary:hsl(220,9%%,86%%);--pfg:hsl(225,8%%,9%%);
--cross:#5fe0a0;--ok:#6cc596;--warn:#f28a5a;--plot:#7fb2e5;--vol:#9fb7d8;--surf:#93c9b0;
--sans:'IBM Plex Sans',system-ui,sans-serif;--mono:'IBM Plex Mono',monospace}
*{box-sizing:border-box}
html,body{margin:0;background:var(--app);color:var(--t1);font:12px/18px var(--sans);-webkit-font-smoothing:antialiased}
.app{width:100vw;height:100vh;display:flex;flex-direction:column;overflow:hidden}
.top{height:40px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:0 14px;background:var(--panel);border-bottom:1px solid var(--bs)}
.brand{width:240px;font:600 13px/20px var(--sans);display:flex;gap:8px;align-items:center}
.seg{display:flex;border:1px solid var(--b);border-radius:2px}
.seg span{padding:0 12px;height:26px;display:flex;align-items:center;color:var(--t2);border-right:1px solid var(--bs)}
.seg span:last-child{border-right:0}
.seg .on{background:var(--active);color:var(--t1);font-weight:500;box-shadow:inset 0 -2px 0 var(--amber)}
.seg.sm span{height:22px;padding:0 9px;font-size:11px}
.seg.sm .on{background:var(--primary);color:var(--pfg);box-shadow:none}
.main{flex:1 1 0;min-height:0;display:flex}
.side{flex:none;background:var(--panel);display:flex;flex-direction:column;min-height:0}
.left{width:220px;border-right:1px solid var(--b)}
.right{width:290px;border-left:1px solid var(--b)}
.tabs{height:28px;flex:none;display:flex;align-items:stretch;border-bottom:1px solid var(--bs);background:var(--panel)}
.tabs span{display:flex;align-items:center;padding:0 12px;color:var(--t3)}
.tabs .on{color:var(--t1);font-weight:600;box-shadow:inset 0 -2px 0 var(--amber)}
.row{height:24px;display:flex;align-items:center;gap:6px;padding:0 10px;white-space:nowrap;overflow:hidden;color:var(--t2)}
.row.sel{background:var(--active);color:var(--t1);box-shadow:inset 2px 0 0 var(--amber)}
.tag{font:10px/14px var(--mono);border:1px solid var(--b);border-radius:2px;padding:0 3px}
.centre{flex:1 1 0;min-width:0;display:flex;flex-direction:column;background:var(--app)}
.canvas{background:#000;position:relative}
.ov{position:absolute;font-size:11px;line-height:16px;color:var(--t2);text-shadow:0 0 3px #000,0 0 3px #000}
.mono{font-family:var(--mono)}
.muted{color:var(--t3)}.faint{color:var(--tf)}
.h{font:600 13px/20px var(--sans)}
.sec{padding:10px 12px 8px;border-bottom:1px solid var(--bs)}
.kv{display:flex;justify-content:space-between;gap:8px;line-height:20px}.kv span:first-child{color:var(--t2)}
.status{height:26px;flex:none;display:flex;align-items:center;gap:18px;padding:0 14px;background:var(--panel);border-top:1px solid var(--bs);color:var(--t2);font-size:11px}
.status b{font-weight:500;color:var(--t1);font-family:var(--mono)}
.dock{flex:none;background:var(--panel);border-top:1px solid var(--b);display:flex;flex-direction:column}
.mark{position:absolute;width:11px;height:11px;margin:-6px 0 0 -6px;border:1.5px solid var(--cross);border-radius:50%%;box-shadow:0 0 0 1.5px #000,inset 0 0 0 1.5px #000}
.cbar{display:flex;align-items:center;gap:6px;font:11px/16px var(--mono);color:var(--t2)}
.cbar i{font-family:var(--sans)}
.cb{height:8px}
.pill{font-size:11px;line-height:16px;padding:0 8px;border-radius:999px}
.btn{height:24px;display:inline-flex;align-items:center;padding:0 10px;border:1px solid var(--b);border-radius:2px;color:var(--t1)}
""" % {'F': FONTS}

NEG = 'linear-gradient(90deg, rgb(140,235,255), rgb(26,71,184))'
POS = 'linear-gradient(90deg, rgb(184,41,20), rgb(255,237,89))'


def cbar(w=64):
    return (f'<div class="cbar"><span><i>z</i> −10</span><div class="cb" style="width:{w}px;background:{NEG}"></div>'
            f'<span>−3.1</span><div class="cb" style="width:18px;background:#77787c"></div><span>3.1</span>'
            f'<div class="cb" style="width:{w}px;background:{POS}"></div><span>10</span></div>')


def files():
    rows = [('', 'study', 10, 0), ('', 'anat', 22, 0), ('NII', 'MNI152NLin6Asym_T1w', 34, 0), ('', 'stats', 22, 0),
            ('NII', 'WM_2BK-0BK_zstat1', 34, 1), ('', 'atlas', 22, 0), ('NII', 'HOSPA_th25_dseg', 34, 0),
            ('', 'surf', 22, 0), ('GII', 'fsLR_32k_L_midthickness', 34, 0), ('GII', 'fsLR_32k_R_midthickness', 34, 0)]
    out = ['<div class="tabs"><span class="on">Files</span><span>Subjects</span></div>',
           '<div style="padding:8px 10px;display:flex;justify-content:space-between;border-bottom:1px solid var(--bs)"><span>study</span><span class="muted">Local</span></div>',
           '<div class="tabs" style="height:26px"><span class="on" style="font-weight:500">Tree</span><span>BIDS</span><span>Images</span><span>Loaded</span></div><div style="padding:6px 0">']
    for tag, name, pad, sel in rows:
        t = f'<span class="tag" style="color:{"var(--surf)" if tag == "GII" else "var(--vol)"}">{tag}</span>' if tag else '<span class="muted" style="width:10px">›</span>'
        out.append(f'<div class="row{" sel" if sel else ""}" style="padding-left:{pad}px">{t}<span style="overflow:hidden;text-overflow:ellipsis">{name}</span></div>')
    out.append('</div>')
    return ''.join(out)


def page(centre, inspector, status, layout='Deep', css=''):
    segs = ''.join(f'<span class="{"on" if s == layout else ""}">{s}</span>' for s in ['Orthogonal', 'Integrated', 'Deep', 'Mosaic', 'Compare'])
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Brainflow</title><style>{CSS}{css}</style></head><body>
<div class="app">
<div class="top"><div class="brand"><span style="width:13px;height:13px;border:1.5px solid var(--t2);border-radius:2px"></span>Brainflow</div>
<div class="seg">{segs}</div><div style="width:240px;text-align:right;color:var(--t2)">Workspace</div></div>
<div class="main"><div class="side left">{files()}</div>
<div class="centre">{centre}</div>
<div class="side right">{inspector}</div></div>
<div class="status">{status}</div></div></body></html>"""


def profile_svg(pl, pr, sel=None, zmin=-9.5, zmax=1.5, brush=None):
    def Y(z): return (zmax - z) / (zmax - zmin) * 100
    def line(p): return ' '.join(f"{q['t'] * 1000:.0f},{Y(q['mean']):.1f}" for q in p)
    def band(p): return ' '.join([f"{q['t'] * 1000:.0f},{Y(q['q3']):.1f}" for q in p] + [f"{q['t'] * 1000:.0f},{Y(q['q1']):.1f}" for q in p[::-1]])
    s = [f'<svg viewBox="0 0 1000 100" preserveAspectRatio="none" style="display:block;width:100%;height:100%">']
    if brush: s.append(f'<rect x="{brush[0] * 1000}" y="0" width="{(brush[1] - brush[0]) * 1000}" height="100" fill="rgba(255,255,255,.07)"/>')
    s.append(f'<line x1="0" x2="1000" y1="{Y(0):.1f}" y2="{Y(0):.1f}" stroke="rgba(233,234,236,.72)" vector-effect="non-scaling-stroke"/>')
    s.append(f'<line x1="0" x2="1000" y1="{Y(-3.1):.1f}" y2="{Y(-3.1):.1f}" stroke="rgba(255,255,255,.3)" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>')
    s.append(f'<polygon points="{band(pl)}" fill="rgba(127,178,229,.16)"/><polygon points="{band(pr)}" fill="rgba(233,234,236,.09)"/>')
    s.append(f'<polyline points="{line(pl)}" fill="none" stroke="#7fb2e5" stroke-width="2" vector-effect="non-scaling-stroke"/>')
    s.append(f'<polyline points="{line(pr)}" fill="none" stroke="#e9eaec" stroke-width="2" stroke-dasharray="6 4" vector-effect="non-scaling-stroke"/>')
    if sel is not None:
        s.append(f'<line x1="{sel * 1000}" x2="{sel * 1000}" y1="0" y2="100" stroke="#000" stroke-width="4" vector-effect="non-scaling-stroke"/>'
                 f'<line x1="{sel * 1000}" x2="{sel * 1000}" y1="0" y2="100" stroke="#5fe0a0" stroke-width="1.5" vector-effect="non-scaling-stroke"/>')
    s.append('</svg>')
    ticks = ''.join(f'<div class="mono" style="position:absolute;left:-34px;width:28px;text-align:right;top:{Y(z):.1f}%;margin-top:-8px;font-size:10px;line-height:14px;color:var(--t2)">{lab}</div>'
                    for z, lab in ((0, '0'), (-3.1, '−3.1'), (-8, '−8')))
    return ''.join(s) + ticks


def inspector(extra=''):
    return f"""<div class="tabs"><span class="on">Inspector</span></div>
<div class="sec"><div class="h" style="margin-bottom:4px">Scene</div>
<div class="row sel" style="height:auto;display:block;padding:4px 10px;margin:0 -12px"><div>WM_2BK-0BK_zstat1.nii.gz</div><div class="muted" style="font-size:11px">map · source of every value</div></div>
<div style="padding:4px 0"><div class="muted" style="color:var(--t2)">MNI152NLin6Asym_T1w.nii.gz</div><div class="muted" style="font-size:11px">base volume</div></div>
<div style="padding:4px 0"><div style="color:var(--t2)">HOSPA_th25_dseg.nii.gz</div><div class="muted" style="font-size:11px">labels · define the structures</div></div>
<div style="padding:4px 0"><div style="color:var(--t2)">fsLR 32k midthickness, L and R</div></div></div>
<div class="sec"><div class="h" style="margin-bottom:4px">Display</div>
<div class="kv"><span>Colormap</span><span>Blue and orange · all views</span></div>
<div class="kv"><span>Range</span><span class="mono">−10 to 10</span></div>
<div class="kv"><span>Threshold</span><span class="mono">|z| ≥ 3.1</span></div>
</div>{extra}"""


STATUS = ('<span>Coordinate system <b>RAS</b></span><span>Crosshair <b style="color:var(--cross)">(−25.0, −19.3, −16.6)</b></span>'
          '<span>Layer <b>WM_2BK-0BK_zstat1.nii.gz</b></span><span>Value <b>z = −11.45</b></span>'
          '<span>Left hippocampus, 39% from head</span><span style="margin-left:auto">MNI152NLin6Asym</span>')
