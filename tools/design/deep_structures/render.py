"""Round 2+: cut the cortex, keep the structures. Usage: r2.py <outdir> <state: hipp|thal>"""
import sys, json, os
import numpy as np, nibabel as nib
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter
from scipy.spatial import cKDTree
import bfr as B

OUT, STATE = sys.argv[1], sys.argv[2]; os.makedirs(OUT, exist_ok=True)
X = np.array([1.0, 0, 0]); meta = {'state': STATE}
NAMES = {4: 'Thalamus', 15: 'Thalamus', 5: 'Caudate', 16: 'Caudate', 6: 'Putamen', 17: 'Putamen', 7: 'Pallidum', 18: 'Pallidum',
         9: 'Hippocampus', 19: 'Hippocampus', 10: 'Amygdala', 20: 'Amygdala', 11: 'Accumbens', 21: 'Accumbens', 8: 'Brainstem'}
PAIRS = [('Hippocampus', 9, 19), ('Amygdala', 10, 20), ('Thalamus', 4, 15), ('Caudate', 5, 16), ('Putamen', 6, 17), ('Pallidum', 7, 18), ('Accumbens', 11, 21)]
DEEP = list(NAMES); deepvol = np.isin(B.lab, DEEP).astype(np.float32)
B.bm = gaussian_filter(B.bm, 1.2)
CTREE = cKDTree(np.r_[B.cortex('L')['v'], B.cortex('R')['v']])
LL, LR = (9, 19) if STATE == 'hipp' else (4, 15)
fL, fR = B.frame(LL), B.frame(LR)
if STATE == 'hipp':
    e = fL['e1'] + fR['e1']; e[0] = 0; E1 = e / np.linalg.norm(e); S_SEL = 18.0
    STOPS = [-2, 8, 18, 28, 38, 48]; ORIGIN = 'head'
else:
    E1 = np.array([0, -1.0, 0]); S_SEL = 16.0; STOPS = [0, 8, 16, 24, 32]; ORIGIN = 'anterior pole'
UP = np.cross(E1, X)
allw = np.r_[fL['w'], fR['w']]; S0 = (allw @ E1).min(); LEN = (allw @ E1).max() - S0
D = S0 + S_SEL
meta['axis'] = dict(tilt_deg=float(np.degrees(np.arccos(np.clip(-E1[1], -1, 1)))), length_mm=float(LEN), s_sel=S_SEL, origin=ORIGIN,
                    name=NAMES[LL], stops=STOPS)

def face_rgb(pts, t1gain=0.50, iso=True):
    rgb = B.gray(pts, t1gain)
    z = B.samp(B.zm, B.ZM.affine, pts, order=0); c, m = B.cmap(z)
    inlab = B.samp(deepvol, B.LAB.affine, pts, order=1) > 0.5
    mm = m & inlab; rgb[mm] = c[mm]
    inb = B.samp(B.bm, B.BM.affine, pts) > 0.5; rgb[~inb] = 0
    if iso:   # signed threshold contours in unlabelled tissue away from cortex
        zl = B.samp(B.zm, B.ZM.affine, pts, order=1)
        far = np.zeros(z.shape, bool); cand = (np.abs(zl) >= B.THR * 0.8) & ~inlab & inb
        idx = np.nonzero(cand)
        if len(idx[0]): far[idx] = CTREE.query(pts[idx])[0] > 4.5
        for sign, col in ((1, (0.62, 0.30, 0.16)), (-1, (0.22, 0.42, 0.72))):
            reg = (sign * zl >= B.THR) & far
            e = B.edges(reg, 1) & far & ~inlab
            rgb[e] = np.array(col, np.float32)
    li = B.samp(B.lab.astype(np.float32), B.LAB.affine, pts, order=0); li = np.where(np.isin(li, DEEP), li, 0)
    e = np.zeros(li.shape, bool); e[1:, :] |= li[1:, :] != li[:-1, :]; e[:, 1:] |= li[:, 1:] != li[:, :-1]
    halo = e.copy()
    for sh in ((1, 0), (-1, 0), (0, 1), (0, -1)): halo |= np.roll(e, sh, (0, 1))
    rgb[halo & ~e] *= 0.25; rgb[e] = 0.74
    return rgb

def contour_lines(n, d, to_xy):
    out = []
    for hemi in 'LR':
        S = B.cortex(hemi); v = S['v']
        for seg in B.plane_contour(v, S['f'], n, d):
            P, zs, kp = [], [], True
            for a, b, t in seg:
                P.append(to_xy(v[a] + (v[b] - v[a]) * t)); zs.append(S['z'][a] + (S['z'][b] - S['z'][a]) * t)
                kp &= bool(S['keep'][a] and S['keep'][b])
            if not kp: continue
            cc, mm = B.cmap(np.array([np.mean(zs)]))
            out.append((P, tuple(int(x * 255) for x in cc[0]) if mm[0] else (128, 129, 133), bool(mm[0])))
    return out

def draw_contours(im, lines, w_on, w_off):
    d = ImageDraw.Draw(im)
    for P, col, on in lines: d.line(P, fill=(0, 0, 0), width=(w_on if on else w_off) + 2)
    for P, col, on in lines:
        if not on: d.line(P, fill=col, width=w_off)
    for P, col, on in lines:
        if on: d.line(P, fill=col, width=w_on)

# ---- flat face
g = B.plane_pts(E1 * D, X, UP, 220.0, 260.0, 2.0); mk = B.samp(B.bm, B.BM.affine, g) > 0.5
ys = np.nonzero(mk.any(1))[0]; VC = 130.0 - (ys.min() + ys.max() + 1) / 2 * 2.0
FW, FH = 152.0, 124.0; O = E1 * D + UP * VC
im = B.to_img(face_rgb(B.plane_pts(O, X, UP, FW, FH, 0.25)))
draw_contours(im, contour_lines(E1, D, lambda p: ((p @ X + FW / 2) / 0.25, (FH / 2 - ((p - O) @ UP)) / 0.25)), 6, 3)
im.save(f'{OUT}/face.png')
pts1 = B.plane_pts(O, X, UP, FW, FH, 1.0); li = B.samp(B.lab.astype(np.float32), B.LAB.affine, pts1, order=0)
labs = {}
for l, nm in NAMES.items():
    yy, xx = np.nonzero(li == l)
    if len(xx) > 12:
        k = np.argmin((xx - xx.mean()) ** 2 + (yy - yy.mean()) ** 2)
        labs[str(l)] = dict(name=nm, x=float((xx[k] + .5) / li.shape[1]), y=float((yy[k] + .5) / li.shape[0]), n=int(len(xx)))
meta['face'] = dict(labels=labs, w_mm=FW, h_mm=FH)

# ---- zooms
ZW, ZH, ZPX = 44.0, 34.0, 0.0625
cens = {}
for hemi, fr in (('L', fL), ('R', fR)):
    w = fr['w']; near = w[np.abs(w @ E1 - D) < 1.5]; cen = near.mean(0); cen = cen - E1 * (cen @ E1 - D); cens[hemi] = cen
    im = B.to_img(face_rgb(B.plane_pts(cen, X, UP, ZW, ZH, ZPX), t1gain=0.55))
    draw_contours(im, contour_lines(E1, D, lambda q, cen=cen: (((q - cen) @ X + ZW / 2) / ZPX, (ZH / 2 - ((q - cen) @ UP)) / ZPX)), 8, 4)
    im.resize((int(ZW * 10), int(ZH * 10)), Image.LANCZOS).save(f'{OUT}/zoom_{hemi}.png')
    p1 = B.plane_pts(cen, X, UP, ZW, ZH, 0.5); l1 = B.samp(B.lab.astype(np.float32), B.LAB.affine, p1, order=0); zl = {}
    for l, nm in NAMES.items():
        yy, xx = np.nonzero(l1 == l)
        if len(xx) > 30:
            k = np.argmin((xx - xx.mean()) ** 2 + (yy - yy.mean()) ** 2); zl[nm] = [float((xx[k] + .5) / l1.shape[1]), float((yy[k] + .5) / l1.shape[0])]
    meta[f'zoom_{hemi}'] = dict(cen=[float(x) for x in cen], box=[float(((cen - O) @ X + FW / 2 - ZW / 2) / FW), float((FH / 2 - (cen - O) @ UP - ZH / 2) / FH), ZW / FW, ZH / FH], labels=zl)
w = fL['w']; near = w[np.abs(w @ E1 - D) < 1.0]
if STATE != 'hipp': near = near[np.abs(near[:, 0] - fL['c'][0]) < 1.5]
zv = B.samp(B.zm, B.ZM.affine, near, order=0)
pk = near[np.argmax(np.abs(zv))]; pk = pk - E1 * (pk @ E1 - D); zpk = float(zv[np.argmax(np.abs(zv))])
meta['cross'] = dict(world=[float(x) for x in pk], z=zpk, face=[float((pk @ X + FW / 2) / FW), float((FH / 2 - (pk - O) @ UP) / FH)],
                     zoom=[float(((pk - cens['L']) @ X + ZW / 2) / ZW), float((ZH / 2 - (pk - cens['L']) @ UP) / ZH)])

if STATE != 'hipp':
    cen = (cens['L'] + cens['R']) / 2; WW, WH = 88.0, 34.0
    im = B.to_img(face_rgb(B.plane_pts(cen, X, UP, WW, WH, ZPX), t1gain=0.55))
    draw_contours(im, contour_lines(E1, D, lambda q, cen=cen: (((q - cen) @ X + WW / 2) / ZPX, (WH / 2 - ((q - cen) @ UP)) / ZPX)), 8, 4)
    im.resize((int(WW * 10), int(WH * 10)), Image.LANCZOS).save(f'{OUT}/zoom_W.png')
    meta['zoom_W'] = dict(box=[float(((cen - O) @ X + FW / 2 - WW / 2) / FW), float((FH / 2 - (cen - O) @ UP - WH / 2) / FH), WW / FW, WH / FH],
                          cross=[float(((pk - cen) @ X + WW / 2) / WW), float((WH / 2 - (pk - cen) @ UP) / WH)],
                          L=[float(((cens['L'] - cen) @ X + WW / 2) / WW), 0.5], R=[float(((cens['R'] - cen) @ X + WW / 2) / WW), 0.5])
# ---- hippocampal surfaces (for the object and the sheet)
HS = {}
uv, uf = B.geom(f'{B.D}/tpl-avg_space-unfold_den-1mm_midthickness.surf.gii')
for hemi in 'LR':
    hv, hf = B.geom(f'{B.D}/tpl-MNI152NLin6Asym_hemi-{hemi}_space-T1w_den-1mm_label-hipp_midthickness.surf.gii')
    hi_, _ = B.geom(f'{B.D}/tpl-MNI152NLin6Asym_hemi-{hemi}_space-T1w_den-1mm_label-hipp_inner.surf.gii')
    ho_, _ = B.geom(f'{B.D}/tpl-MNI152NLin6Asym_hemi-{hemi}_space-T1w_den-1mm_label-hipp_outer.surf.gii')
    rib = np.mean([B.samp(B.zm, B.ZM.affine, hi_ + (ho_ - hi_) * dd, order=1) for dd in np.linspace(0, 1, 7)], 0)
    sub = nib.load(f'{B.D}/hemi-{hemi}_den-1mm_label-hipp_subfields.label.gii').darrays[0].data.astype(float)
    HS[hemi] = dict(v=hv, f=hf, rib=rib, sub=sub)

def iso_segments(P, f, field, level, valid=None):
    out = []
    for tri in f:
        if valid is not None and not valid[tri].all(): continue
        pp = []
        for a_, b_ in ((0, 1), (1, 2), (2, 0)):
            fa, fb = field[tri[a_]] - level, field[tri[b_]] - level
            if (fa < 0) != (fb < 0): pp.append(P[tri[a_]] + (P[tri[b_]] - P[tri[a_]]) * (fa / (fa - fb)))
        if len(pp) == 2: out.append((pp[0], pp[1]))
    return out

# ---- the object: cortex cut, structures whole
def hero(fname, w=150.0, h=116.0, ppm=6.4):
    cam = B.camera([-0.78, -0.30, 0.55]) if STATE == 'hipp' else B.camera([-0.72, -0.58, 0.38])
    ctr = np.array([-10, 2.0, -2.0]) if STATE == 'hipp' else np.array([-10, 4.0, 6.0])
    sc = B.Scene(cam, ctr, w, h, ppm)
    ghost = B.Scene(cam, ctr, w, h, ppm, ss=1)
    for hemi in 'LR':
        S = B.cortex(hemi); v, f = S['v'], S['f']
        sc.mesh(v, f, B.lit(v, f, cam, 0.50, S['z']), back=np.array([0.05, 0.05, 0.06], np.float32), clips=[v @ E1 - D])
        ghost.mesh(v, f, np.ones((len(v), 3), np.float32))
    sc.cap(E1, D, lambda pts: face_rgb(pts, iso=False))
    im = B.to_img(sc.img); draw_contours(im, contour_lines(E1, D, lambda p: tuple(float(x) for x in sc.xy(p))), 5, 2)
    sc.img = np.asarray(im).astype(np.float32) / 255
    segs = []
    def vis(p):   # depth test for a line midpoint
        x, y = sc.xy(p); xi, yi = int(x), int(y)
        return 0 <= xi < sc.W and 0 <= yi < sc.H and (p @ sc.c) >= sc.zb[yi, xi] - 0.9
    for key in ('thal', 'caud', 'put') + (() if STATE == 'thal' else ()):
        for hemi in 'LR':
            l = B.STRUCT[key][0 if hemi == 'L' else 1]; mv, mf = B.mask_mesh(l)
            sc.mesh(mv, mf, B.lit(mv, mf, cam, 0.62, B.samp(B.zm, B.ZM.affine, mv - 2.0 * B.vnormals(mv, mf)), amb=0.80))
            if STATE == 'thal' and key == 'thal': segs += [(a, b, (95, 224, 160), 4) for a, b in iso_segments(mv, mf, mv @ E1, D)]
    for hemi in 'LR':
        H = HS[hemi]; col = B.lit(H['v'], H['f'], cam, 0.66, H['rib'], amb=0.5)
        f2 = B.outward(H['v'], H['f'])
        for ff in (f2, f2[:, ::-1]): sc.mesh(H['v'], ff, B.lit(H['v'], ff, cam, 0.62, H['rib'], amb=0.80))
        if STATE == 'hipp':
            for lev in (1.5, 2.5, 3.5): segs += [(a, b, (30, 31, 34), 3) for a, b in iso_segments(H['v'], H['f'], H['sub'], lev, H['sub'] >= 1)]
            segs += [(a, b, (95, 224, 160), 4) for a, b in iso_segments(H['v'], H['f'], H['v'] @ E1, D)]
    im = B.to_img(sc.img); dr = ImageDraw.Draw(im)
    for a, b, col, wd in segs:
        if vis((a + b) / 2 + sc.c * 0.0):
            if wd > 2: dr.line([tuple(map(float, sc.xy(a))), tuple(map(float, sc.xy(b)))], fill=(0, 0, 0), width=wd + 3)
    for a, b, col, wd in segs:
        if vis((a + b) / 2): dr.line([tuple(map(float, sc.xy(a))), tuple(map(float, sc.xy(b)))], fill=col, width=wd)
    im = im.resize((sc.W // sc.ss, sc.H // sc.ss), Image.LANCZOS)
    # faint outline of the removed half
    cov = ghost.zb > -1e8; own = np.asarray(im).sum(2) > 0
    e = B.edges(cov, 1) & ~own
    arr = np.asarray(im).copy(); arr[e] = (92, 93, 97); im = Image.fromarray(arr); im.save(f'{OUT}/{fname}.png')
    ax = {k: [float(vv @ sc.right), float(-(vv @ sc.up))] for k, vv in (('R', X), ('A', np.array([0, 1., 0])), ('S', np.array([0, 0, 1.])))}
    mid = (fL['c'] + fR['c']) / 2; mid[0] = 0; base = mid - E1 * (mid @ E1)
    # the long axis as a drawn line (through the midline), with stop ticks
    axis = [list(sc.frac(base + E1 * (S0 + s))) for s in STOPS]
    meta[fname] = dict(size=list(im.size), ppm=ppm, axes=ax, cross=list(sc.frac(np.array(meta['cross']['world']))), axis=axis,
                       names={nm: list(sc.frac(B.frame(l)['c'] + E1 * 6)) for nm, l in (('Thalamus', 4), ('Caudate', 5), ('Putamen', 6))})
hero('hero')

# ---- uncut laterals: plane trace, stops, structure outline, removed side dimmed
for hemi in 'LR':
    S = B.cortex(hemi); v, f = S['v'], S['f']; cam = B.camera([-1.0 if hemi == 'L' else 1.0, 0, 0])
    ctr = np.array([v[:, 0].mean(), (v[:, 1].min() + v[:, 1].max()) / 2, (v[:, 2].min() + v[:, 2].max()) / 2])
    sc = B.Scene(cam, ctr, 190.0, 136.0, 3.0)
    sc.mesh(v, f, B.lit(v, f, cam, 0.50, S['z']))
    xs = (np.arange(sc.W) + .5) / sc.s - sc.w_mm / 2 + sc.cx; ysw = sc.h_mm / 2 - (np.arange(sc.H) + .5) / sc.s + sc.cy
    wp = xs[None, :, None] * sc.right + ysw[:, None, None] * sc.up
    sc.img[(wp @ E1) > D] *= 0.38
    m2 = B.Scene(cam, ctr, 190.0, 136.0, 3.0, ss=2); mv, mf = B.mask_mesh(LL if hemi == 'L' else LR); m2.mesh(mv, mf, np.ones((len(mv), 3), np.float32))
    e = B.edges(m2.zb > -1e8, 2); sc.img[e] = 0.93
    sc.image().save(f'{OUT}/lat_{hemi}.png')
    tr = {}
    for s in STOPS:
        p0 = E1 * (S0 + s) + UP * (VC - FH / 2 + 8) + X * ctr[0]; p1 = E1 * (S0 + s) + UP * (VC + FH / 2 - 8) + X * ctr[0]
        tr[str(s)] = [*sc.frac(p0), *sc.frac(p1)]
    meta[f'lat_{hemi}'] = dict(traces=tr, A=list(sc.frac(ctr + np.array([0, 86., -52]))), P=list(sc.frac(ctr + np.array([0, -86., -52]))), ppm=3.0)

# ---- dock
def spark(l):
    fr = B.frame(l); zv = B.samp(B.zm, B.ZM.affine, fr['w'], order=0); t = (fr['proj'] - fr['lo']) / (fr['hi'] - fr['lo'])
    b = np.minimum((t * 16).astype(int), 15); return [float(zv[b == k].mean()) if (b == k).sum() > 4 else None for k in range(16)]
tab = {}
for nm, l, r in PAIRS + [('Brainstem', 8, 8)]:
    row = {}
    for side, lb in (('L', l), ('R', r)):
        wv = nib.affines.apply_affine(B.LAB.affine, np.argwhere(B.lab == lb)); q = B.samp(B.zm, B.ZM.affine, wv, order=0)
        row[side] = dict(mean=float(q.mean()), pos=float((q >= B.THR).mean()), neg=float((q <= -B.THR).mean()), n=int(len(q)), spark=spark(lb))
    tab[nm] = row
meta['table'] = tab

if STATE == 'hipp':
    PD = uv[:, 1] - uv[:, 1].min(); PDMAX = PD.max(); AP = uv[:, 0].max() - uv[:, 0]; APMAX = AP.max()
    for hemi in 'LR':
        H = HS[hemi]; rib, sub = H['rib'], H['sub']; sx = H['v'] @ E1 - S0
        P3 = np.c_[AP, PD, np.zeros(len(AP))]; cam = (X, np.array([0, 1., 0]), np.array([0, 0, 1.]))
        us = B.Scene(cam, np.array([APMAX / 2, PDMAX / 2, 0]), APMAX, PDMAX, 18.0, ss=2)
        c3 = np.repeat(np.full(len(AP), 0.30, np.float32)[:, None], 3, 1); cr, m = B.cmap(rib); c3[m] = cr[m]
        us.mesh(P3, uf, c3); us.mesh(P3, uf[:, ::-1], c3)
        im = B.to_img(us.img); dr = ImageDraw.Draw(im)
        def L(segs, fill, width):
            for a, b in segs: dr.line([tuple(map(float, us.xy(a))), tuple(map(float, us.xy(b)))], fill=fill, width=width)
        T0, T1 = 0.25, 0.50
        band = (AP / APMAX >= T0) & (AP / APMAX <= T1)
        ov = Image.new('RGBA', im.size, (0, 0, 0, 0)); od = ImageDraw.Draw(ov)
        xa, _ = us.xy(np.array([T0 * APMAX, 0, 0])); xb, _ = us.xy(np.array([T1 * APMAX, 0, 0]))
        od.rectangle([float(xa), 0, float(xb), im.size[1]], fill=(255, 255, 255, 30))
        od.line([float(xa), 0, float(xa), im.size[1]], fill=(233, 234, 236, 200), width=2); od.line([float(xb), 0, float(xb), im.size[1]], fill=(233, 234, 236, 200), width=2)
        im = Image.alpha_composite(im.convert('RGBA'), ov).convert('RGB'); dr = ImageDraw.Draw(im)
        for lev in (1.5, 2.5, 3.5, 4.5):
            sg = iso_segments(P3, uf, sub, lev, sub >= 1); L(sg, (0, 0, 0), 4)
        for lev in (1.5, 2.5, 3.5, 4.5): L(iso_segments(P3, uf, sub, lev, sub >= 1), (178, 179, 183), 2)
        grat = {}
        for s in STOPS:
            sg = iso_segments(P3, uf, sx, float(s))
            if not sg: continue
            sel = abs(s - S_SEL) < 0.1
            if sel: L(sg, (0, 0, 0), 8); L(sg, (95, 224, 160), 3)
            else: L(sg[::2], (0, 0, 0), 5); L(sg[::2], (240, 241, 243), 2)
            xsg = np.array([p[0] for a in sg for p in a]) / APMAX; ytop = max(sg, key=lambda a: max(a[0][1], a[1][1]))
            grat[str(s)] = dict(t0=float(xsg.min()), t1=float(xsg.max()), tmed=float(np.median(xsg)),
                                top=float(max(ytop, key=lambda p: p[1])[0] / APMAX))
        im.resize((us.W // 2, us.H // 2), Image.LANCZOS).save(f'{OUT}/sheet_{hemi}.png')
        nb = 20; ab = np.minimum((AP / APMAX * nb).astype(int), nb - 1)
        colm = [dict(t=(k + .5) / nb, mean=float(rib[ab == k].mean()), q1=float(np.percentile(rib[ab == k], 25)), q3=float(np.percentile(rib[ab == k], 75))) for k in range(nb)]
        rowm = [dict(name=nmm, mean=float(rib[sub == k].mean()), n=int((sub == k).sum()), pd=float(1 - PD[sub == k].mean() / PDMAX)) for k, nmm in ((1, 'Subiculum'), (2, 'CA1'), (3, 'CA2'), (4, 'CA3'), (5, 'CA4'))]
        meta[f'sheet_{hemi}'] = dict(ap_mm=float(APMAX), pd_mm=float(PDMAX), col=colm, row=rowm, grat=grat, mean=float(rib.mean()), nvert=int(len(rib)),
                                     brush=dict(t0=T0, t1=T1, mean=float(rib[band].mean()), n=int(band.sum())))
        # structure crops at each stop, above the sheet
        fr = fL if hemi == 'L' else fR
        for i, s in enumerate(STOPS):
            near = fr['w'][np.abs(fr['w'] @ E1 - (S0 + s)) < 2.0]
            cen = near.mean(0) if len(near) > 5 else fr['c']; cen = cen - E1 * (cen @ E1 - (S0 + s))
            imc = B.to_img(face_rgb(B.plane_pts(cen, X, UP, 22.0, 17.6, 0.1), t1gain=0.55))
            draw_contours(imc, contour_lines(E1, S0 + s, lambda q, cen=cen: (((q - cen) @ X + 11.0) / 0.1, (8.8 - ((q - cen) @ UP)) / 0.1)), 5, 2)
            imc.save(f'{OUT}/crop_{hemi}_{i}.png')
else:
    # no template surfaces: long-axis section in millimetres with the mask-mean profile beneath it
    A0, A1 = -6.0, np.ceil(LEN / 2) * 2 + 6
    for hemi, fr, l in (('L', fL, LL), ('R', fR, LR)):
        cen = fr['c'] - E1 * (fr['c'] @ E1) + E1 * (S0 + (A0 + A1) / 2)
        hh = 34.0; pts = B.plane_pts(cen, E1, np.array([0, 0, 1.0]), A1 - A0, hh, 0.125)
        B.to_img(face_rgb(pts, t1gain=0.55)).save(f'{OUT}/long_{hemi}.png')
        zv = B.samp(B.zm, B.ZM.affine, fr['w'], order=0); sp = fr['w'] @ E1 - S0
        prof = []
        for a in np.arange(0, np.ceil(LEN / 2) * 2, 2.0):
            q = zv[(sp >= a) & (sp < a + 2)]
            if len(q) >= 8: prof.append(dict(s=float(a + 1), mean=float(q.mean()), q1=float(np.percentile(q, 25)), q3=float(np.percentile(q, 75)), n=int(len(q))))
        band = (sp >= 8) & (sp <= 24)
        meta[f'long_{hemi}'] = dict(ax=[float(A0), float(A1)], h_mm=hh, profile=prof, mean=float(zv.mean()), n=int(len(zv)),
                                    brush=dict(s0=8.0, s1=24.0, mean=float(zv[band].mean()), n=int(band.sum())), x_mm=float(fr['c'][0]))
json.dump(meta, open(f'{OUT}/meta.json', 'w'), indent=1)
print('ok', STATE, meta['axis'], meta['cross']['z'])
