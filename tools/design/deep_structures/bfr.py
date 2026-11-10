"""Shared offline rendering for the deep-structure hill climb (real public data)."""
import numpy as np, nibabel as nib
from scipy.ndimage import map_coordinates, gaussian_filter
from skimage.measure import marching_cubes
from PIL import Image

import os
# Folder holding the public inputs listed in README.md.
D = os.environ['BF_DEEP_DATA']
T1 = nib.load(f'{D}/tpl-MNI152NLin6Asym_res-01_T1w.nii.gz')
LAB = nib.load(f'{D}/tpl-MNI152NLin6Asym_res-01_atlas-HOSPA_desc-th25_dseg.nii.gz')
ZM = nib.load(f'{D}/tfMRI_WM_2BK-0BK_zstat1.nii.gz')
BM = nib.load(f'{D}/tpl-MNI152NLin6Asym_res-01_desc-brain_mask.nii.gz')
t1 = T1.get_fdata(dtype=np.float32); lab = np.asarray(LAB.dataobj).astype(np.int16)
zm = ZM.get_fdata(dtype=np.float32); bm = BM.get_fdata(dtype=np.float32)
VMAX, THR = 10.0, 3.1
_b = t1[lab > 0]; T1LO, T1HI = np.percentile(_b, 2) * 0.55, np.percentile(_b, 99.5) * 1.02
STRUCT = {'hipp': (9, 19, 'Hippocampus'), 'thal': (4, 15, 'Thalamus'),
          'caud': (5, 16, 'Caudate'), 'put': (6, 17, 'Putamen')}


def samp(vol, aff, pts, order=1):
    ijk = nib.affines.apply_affine(np.linalg.inv(aff), pts.reshape(-1, 3)).T
    return map_coordinates(vol, ijk, order=order, mode='constant', cval=0).reshape(pts.shape[:-1])


# Diverging map, perceptually ordered in lightness on both arms (dark near threshold,
# light at the extreme) so magnitude reads without hue: blue arm and orange arm.
def cmap(z, thr=None, vmax=None):
    thr = THR if thr is None else thr; vmax = VMAX if vmax is None else vmax
    a = np.clip((np.abs(z) - thr) / (vmax - thr), 0, 1)[..., None]
    neg0, neg1 = np.array([0.10, 0.28, 0.72]), np.array([0.55, 0.92, 1.00])
    pos0, pos1 = np.array([0.72, 0.16, 0.08]), np.array([1.00, 0.93, 0.35])
    rgb = np.where((z > 0)[..., None], pos0 + (pos1 - pos0) * a, neg0 + (neg1 - neg0) * a)
    return rgb.astype(np.float32), np.abs(z) >= thr


def gray(pts, gain=0.92):
    g = np.clip((samp(t1, T1.affine, pts) - T1LO) / (T1HI - T1LO), 0, 1)
    return np.repeat(g[..., None], 3, -1) * gain


def edges(mask, width=2):
    e = np.zeros_like(mask)
    e[1:, :] |= mask[1:, :] != mask[:-1, :]; e[:, 1:] |= mask[:, 1:] != mask[:, :-1]
    for _ in range(width - 1):
        e2 = e.copy(); e2[:-1, :] |= e[1:, :]; e2[:, :-1] |= e[:, 1:]; e = e2
    return e


def labmask(pts, labels):
    m = np.zeros(pts.shape[:-1], bool)
    for l in labels:
        m |= samp((lab == l).astype(np.float32), LAB.affine, pts) > 0.5
    return m


def section_rgb(pts, outline=(), overlay=True, nearest=False, t1gain=0.92, only=None, ow=2,
                outline_rgb=(0.95, 0.95, 0.96)):
    """Colour a grid of world points as a section: T1, thresholded map, label outlines.
    only: labels to restrict the overlay to (values outside are not drawn)."""
    rgb = gray(pts, t1gain)
    if overlay:
        z = samp(zm, ZM.affine, pts, order=0 if nearest else 1)
        c, m = cmap(z)
        if only is not None: m &= labmask(pts, only)
        rgb[m] = c[m]
    for l in outline:
        e = edges(labmask(pts, [l]), ow)
        rgb[e] = np.array(outline_rgb, np.float32)
    return rgb


def plane_pts(origin, u, v, w_mm, h_mm, px):
    nx, ny = int(round(w_mm / px)), int(round(h_mm / px))
    xs = (np.arange(nx) + .5) * px - w_mm / 2
    ys = h_mm / 2 - (np.arange(ny) + .5) * px
    return origin + xs[None, :, None] * u + ys[:, None, None] * v


def to_img(rgb):
    return Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8))


def frame(label):
    ijk = np.argwhere(lab == label)
    w = nib.affines.apply_affine(LAB.affine, ijk).astype(np.float64)
    c = w.mean(0)
    _, _, vt = np.linalg.svd(w - c, full_matrices=False)
    e1 = vt[0]
    if e1[1] > 0: e1 = -e1
    proj = (w - c) @ e1
    up = np.array([0, 0, 1.0]); up = up - (up @ e1) * e1; up /= np.linalg.norm(up)
    right = np.cross(up, e1) if np.cross(up, e1)[0] > 0 else -np.cross(up, e1)
    return dict(c=c, e1=e1, up=up, right=right, lo=proj.min(), hi=proj.max(), w=w, proj=proj)


def profile(label, nb=24):
    fr = frame(label); zv = samp(zm, ZM.affine, fr['w'])
    t = (fr['proj'] - fr['lo']) / (fr['hi'] - fr['lo'])
    b = np.minimum((t * nb).astype(int), nb - 1); out = []
    for k in range(nb):
        s = zv[b == k]
        out.append(dict(t=(k + .5) / nb, mean=float(s.mean()), q1=float(np.percentile(s, 25)),
                        q3=float(np.percentile(s, 75)), n=int(len(s))))
    return out


def geom(path):
    g = nib.load(path)
    v = [a.data for a in g.darrays if a.data.dtype.kind == 'f' and a.data.ndim == 2][0]
    f = [a.data for a in g.darrays if a.data.dtype.kind in 'iu' and a.data.ndim == 2][0]
    return v.astype(np.float64), f.astype(np.int64)


def outward(v, f):
    fn = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
    return f if ((v[f[:, 0]] - v.mean(0)) * fn).sum() > 0 else f[:, ::-1]


def vnormals(v, f):
    fn = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
    n = np.zeros_like(v)
    for k in range(3): np.add.at(n, f[:, k], fn)
    return n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-9)


def mask_mesh(label, sigma=0.8):
    m = gaussian_filter((lab == label).astype(np.float32), sigma)
    v, f, _, _ = marching_cubes(m, 0.5)
    v = nib.affines.apply_affine(LAB.affine, v)
    return v, outward(v, f.astype(np.int64))


_surf = {}
def cortex(hemi, kind='midthickness'):
    k = (hemi, kind)
    if k not in _surf:
        v, f = geom(f'{D}/tpl-fsLR_den-32k_hemi-{hemi}_{kind}.surf.gii'); f = outward(v, f)
        keep = nib.load(f'{D}/tpl-fsLR_hemi-{hemi}_den-32k_desc-nomedialwall_dparc.label.gii').darrays[0].data > 0.5
        va, _ = geom(f'{D}/tpl-fsLR_den-32k_hemi-{hemi}_midthickness.surf.gii')
        z = samp(zm, ZM.affine, va); z[~keep] = 0
        _surf[k] = dict(v=v, f=f, keep=keep, z=z, anat=va)
    return _surf[k]


def camera(c):
    c = np.asarray(c, float); c /= np.linalg.norm(c)
    right = np.cross([0, 0, 1.0], c); right /= np.linalg.norm(right)
    return right, np.cross(c, right), c


def lit(v, f, cam, base=0.5, z=None, amb=0.42, col=None):
    right, up, c = cam
    n = vnormals(v, f)
    key = c + 0.45 * up + 0.25 * right; key /= np.linalg.norm(key)
    sh = amb + (1 - amb) * np.clip(n @ key, 0, 1)
    if col is None:
        col = np.repeat(np.full(len(v), base, np.float32)[:, None], 3, 1)
        if z is not None:
            crgb, m = cmap(z); col[m] = crgb[m]
    return col * sh[:, None]


class Scene:
    def __init__(self, cam, center, w_mm, h_mm, ppm, ss=2, bg=(0, 0, 0)):
        self.right, self.up, self.c = cam
        self.cx, self.cy = center @ self.right, center @ self.up
        self.w_mm, self.h_mm, self.s, self.ss = w_mm, h_mm, ppm * ss, ss
        self.W, self.H = int(round(w_mm * ppm)) * ss, int(round(h_mm * ppm)) * ss
        self.img = np.zeros((self.H, self.W, 3), np.float32) + np.array(bg, np.float32)
        self.zb = np.full((self.H, self.W), -1e9, np.float32)

    def xy(self, p):
        p = np.asarray(p)
        return ((p @ self.right) - self.cx + self.w_mm / 2) * self.s, (self.h_mm / 2 - ((p @ self.up) - self.cy)) * self.s

    def frac(self, p):
        x, y = self.xy(p); return float(x / self.W), float(y / self.H)

    def mesh(self, v, f, col, back=None, clips=None):
        """clips: list of per-vertex signed arrays; a fragment is discarded when all are > 0."""
        W, H = self.W, self.H
        X, Y = self.xy(v); Zd = v @ self.c
        x0, x1, x2 = X[f[:, 0]], X[f[:, 1]], X[f[:, 2]]; y0, y1, y2 = Y[f[:, 0]], Y[f[:, 1]], Y[f[:, 2]]
        area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
        ok = np.abs(area) > 1e-9
        if clips:
            allpos = np.ones(len(f), bool)
            for s in clips: allpos &= (s[f] > 0).all(1)
            ok &= ~allpos
        for i in np.nonzero(ok)[0]:
            a = area[i]; front = a < 0
            if not front and back is None: continue
            xa, xb, xc = x0[i], x1[i], x2[i]; ya, yb, yc = y0[i], y1[i], y2[i]
            mnx = max(int(min(xa, xb, xc)), 0); mxx = min(int(max(xa, xb, xc)) + 1, W - 1)
            mny = max(int(min(ya, yb, yc)), 0); mxy = min(int(max(ya, yb, yc)) + 1, H - 1)
            if mnx > mxx or mny > mxy: continue
            px = np.arange(mnx, mxx + 1) + .5; py = (np.arange(mny, mxy + 1) + .5)[:, None]
            w1 = ((px - xa) * (yc - ya) - (xc - xa) * (py - ya)) / a
            w2 = ((xb - xa) * (py - ya) - (px - xa) * (yb - ya)) / a
            w0 = 1 - w1 - w2
            m = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
            if not m.any(): continue
            fi = f[i]
            if clips:
                d = np.ones_like(m)
                for s in clips: d &= (w0 * s[fi[0]] + w1 * s[fi[1]] + w2 * s[fi[2]]) > 0
                m &= ~d
            zz = w0 * Zd[fi[0]] + w1 * Zd[fi[1]] + w2 * Zd[fi[2]]
            sub = self.zb[mny:mxy + 1, mnx:mxx + 1]
            m &= zz > sub
            if not m.any(): continue
            sub[m] = zz[m]
            tgt = self.img[mny:mxy + 1, mnx:mxx + 1]
            if front:
                cc = w0[..., None] * col[fi[0]] + w1[..., None] * col[fi[1]] + w2[..., None] * col[fi[2]]
                tgt[m] = cc[m]
            else:
                tgt[m] = back

    def cap(self, n, d, colorfn, conds=(), inside=None, zbias=0.0):
        """Draw the plane n.p = d where it faces the camera. conds: functions(pts)->bool."""
        n = np.asarray(n, float); nc = n @ self.c
        if abs(nc) < 1e-6: return None
        xs = (np.arange(self.W) + .5) / self.s - self.w_mm / 2 + self.cx
        ys = self.h_mm / 2 - (np.arange(self.H) + .5) / self.s + self.cy
        base = xs[None, :, None] * self.right + ys[:, None, None] * self.up
        t = (d - base @ n) / nc
        pts = base + t[..., None] * self.c
        m = (t + zbias) > self.zb
        if inside is None:
            m &= samp(bm, BM.affine, pts) > 0.5
        else:
            m &= inside(pts)
        for cf in conds: m &= cf(pts)
        rgb = colorfn(pts)
        self.img[m] = rgb[m]; self.zb[m] = t[m]
        return m

    def image(self):
        im = to_img(self.img)
        return im.resize((self.W // self.ss, self.H // self.ss), Image.LANCZOS)


def plane_contour(v, f, n, d):
    """Segments where a mesh crosses plane n.p = d. Returns (P0, P1, t0, t1 interpolation info)."""
    s = v @ n - d
    segs = []
    sf = s[f]
    cross = (sf.min(1) < 0) & (sf.max(1) >= 0)
    for tri, st in zip(f[cross], sf[cross]):
        pts = []
        for a, b in ((0, 1), (1, 2), (2, 0)):
            sa, sb = st[a], st[b]
            if (sa < 0) != (sb < 0):
                w = sa / (sa - sb)
                pts.append((tri[a], tri[b], w))
        if len(pts) == 2: segs.append(pts)
    return segs
