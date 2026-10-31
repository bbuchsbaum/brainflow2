#!/usr/bin/env python3
"""Generate the MOCK FLAIR and white-matter-lesion assets for the segmentation
design (round 5, direction H, state `lesion`).

There is no FLAIR template in the repository, so this derives a FLAIR-like
image from the 1 mm MNI152NLin2009cAsym T1w (the same template the other
design assets use): a non-monotonic intensity map (CSF dark, grey matter
brightest, white matter mid-grey, as on a T2 FLAIR), a light blur and a fixed
noise field, plus SYNTHETIC hyperintense lesions: smooth irregular blobs
capping the frontal horns and atria, along the ventricle bodies, one deep and
one juxtacortical. Each lesion has a continuous partial-volume membership; a
voxel belongs to the reference lesion mask when more than half of it is
lesion (the WMH challenge rule). Nothing here is a real patient or a real
FLAIR: the images are labelled "mock" wherever they are shown.

Outputs (in --out):
  ax096_flair.png, cor{J}_flair.png, sag{I}_flair.png   8-bit grayscale slices
  lesions.json   lesion components (26-connected, 3D) with volume, slice
                 span, location and voxels on the rendered slices; per-slice
                 lesion counts; a 64-bin FLAIR histogram; an intensity crop
                 around the brush for the range-brush preview

Needs only numpy and Pillow; run with an isolated interpreter:
  git show HEAD:test-data/unit/tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii > /tmp/t1.nii
  python3 -I tools/design/segmentation_flair_assets.py --t1 /tmp/t1.nii \
      --out ui2/src/modules/segmentation/__design__/assets
"""

from __future__ import annotations

import argparse
import json
import struct
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

ORIGIN = np.array([-96.0, -132.0, -78.0])
AXIAL_K = 96  # z = +18 mm: lateral ventricle bodies


def load_nifti_f32(path: Path) -> np.ndarray:
    raw = path.read_bytes()
    dims = struct.unpack('<8h', raw[40:56])
    dtype = struct.unpack('<h', raw[70:72])[0]
    if dtype != 16:
        raise SystemExit(f'expected float32 NIfTI, got datatype {dtype}')
    off = int(struct.unpack('<f', raw[108:112])[0])
    nx, ny, nz = dims[1], dims[2], dims[3]
    v = np.frombuffer(raw, dtype='<f4', offset=off, count=nx * ny * nz)
    return v.reshape(nz, ny, nx).transpose(2, 1, 0).astype(np.float32)


def blur(v: np.ndarray, sigma: float) -> np.ndarray:
    r = int(np.ceil(3 * sigma))
    x = np.arange(-r, r + 1, dtype=np.float32)
    k = np.exp(-0.5 * (x / sigma) ** 2)
    k /= k.sum()
    out = v
    for axis in range(v.ndim):
        out = np.apply_along_axis(lambda m: np.convolve(m, k, mode='same'), axis, out)
    return out


def dilate(mask: np.ndarray, n: int) -> np.ndarray:
    m = mask.copy()
    for _ in range(n):
        g = m.copy()
        for axis in range(3):
            g |= np.roll(m, 1, axis) | np.roll(m, -1, axis)
        m = g
    return m


def components26(mask: np.ndarray) -> list[np.ndarray]:
    """3D connected components (26-connectivity) as arrays of (i, j, k)."""
    seen = np.zeros_like(mask, dtype=bool)
    out: list[np.ndarray] = []
    offsets = [(a, b, c) for a in (-1, 0, 1) for b in (-1, 0, 1) for c in (-1, 0, 1) if (a, b, c) != (0, 0, 0)]
    for start in zip(*np.nonzero(mask)):
        if seen[start]:
            continue
        seen[start] = True
        q = deque([start])
        comp = []
        while q:
            p = q.popleft()
            comp.append(p)
            for d in offsets:
                n = (p[0] + d[0], p[1] + d[1], p[2] + d[2])
                if all(0 <= n[t] < mask.shape[t] for t in range(3)) and mask[n] and not seen[n]:
                    seen[n] = True
                    q.append(n)
        out.append(np.array(comp))
    return out


def axial(v: np.ndarray, k: int) -> np.ndarray:
    return v[:, ::-1, k].T


def coronal(v: np.ndarray, j: int) -> np.ndarray:
    return v[:, j, ::-1].T


def sagittal(v: np.ndarray, i: int) -> np.ndarray:
    return v[i, ::-1, ::-1].T


def to_u8(a: np.ndarray) -> np.ndarray:
    return (np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--t1', type=Path, required=True)
    ap.add_argument('--out', type=Path, required=True)
    args = ap.parse_args()

    t1 = load_nifti_f32(args.t1)
    brain = t1 > 0
    t = t1 / np.percentile(t1[brain], 99.0)
    shape = t.shape
    ii, jj, kk = np.meshgrid(*[np.arange(n) for n in shape], indexing='ij')
    world = [ii + ORIGIN[0], jj + ORIGIN[1], kk + ORIGIN[2]]

    # FLAIR-like contrast: CSF dark, GM bright, WM mid-grey.
    flair = np.interp(t, [0.0, 0.2, 0.42, 0.62, 0.74, 0.88, 1.2], [0.0, 0.05, 0.22, 0.62, 0.6, 0.46, 0.44])
    flair = np.where(brain, flair, 0.0).astype(np.float32)

    # Lateral ventricles: dark T1, central box, z 0..36 mm.
    vent = brain & (t < 0.5) & (np.abs(world[0]) < 28) & (world[1] > -50) & (world[1] < 32) & (world[2] > 0) & (world[2] < 36)
    near_vent = dilate(vent, 4) & ~vent

    # Synthetic lesions: each a few overlapping ellipsoids (centre mm, radii mm).
    rng = np.random.default_rng(7)
    lesion_defs: list[list[tuple[tuple[float, float, float], tuple[float, float, float]]]] = []
    for side in (-1, 1):
        vs = np.argwhere(vent & (side * world[0] > 9) & (np.abs(world[2] - 18) < 4))
        wy = vs[:, 1] + ORIGIN[1]
        front = vs[np.argmax(wy)] + ORIGIN
        back = vs[np.argmin(wy)] + ORIGIN
        lateral = vs[np.argmax(np.abs(vs[:, 0] + ORIGIN[0]))] + ORIGIN
        # Frontal cap and posterior cap (periventricular, larger behind).
        lesion_defs.append([((front[0] + 2 * side, front[1] + 4, front[2] + 1), (4.0, 3.5, 4.5)), ((front[0] + 4 * side, front[1] + 2, front[2] - 2), (3.0, 3.0, 3.0))])
        lesion_defs.append([((back[0] + 2 * side, back[1] - 4, back[2]), (5.0, 5.5, 6.0)), ((back[0] + 6 * side, back[1] - 1, back[2] + 3), (3.5, 4.0, 4.0))])
        # Band along the body.
        lesion_defs.append([((lateral[0] + 4 * side, lateral[1] + 6, lateral[2] + 2), (2.5, 7.0, 3.0))])
    # A deep white-matter lesion (right centrum) and a juxtacortical one (left frontal).
    lesion_defs.append([((24.0, -8.0, 30.0), (2.5, 3.0, 2.5))])
    lesion_defs.append([((-30.0, 30.0, 22.0), (2.0, 2.0, 2.5))])

    member = np.zeros(shape, dtype=np.float32)
    for parts in lesion_defs:
        d = np.full(shape, np.inf, dtype=np.float32)
        for c, r in parts:
            jitter = 1 + 0.12 * rng.standard_normal(3)
            q = sum(((world[a] - c[a]) / (r[a] * jitter[a])) ** 2 for a in range(3))
            d = np.minimum(d, np.sqrt(q))
        # Smooth membership: 1 inside, falling across about one voxel at the edge.
        member = np.maximum(member, 1 / (1 + np.exp(np.clip((d - 1) / 0.12, -50, 50))))
    member = np.where(brain & ~vent, member, 0).astype(np.float32)

    lesion = member > 0.5  # a voxel counts when more than half of it is lesion
    flair = flair * (1 - member) + 0.97 * member
    flair = blur(flair, 0.6)
    noise = rng.standard_normal(shape).astype(np.float32) * 0.025
    flair = np.where(brain, np.clip(flair + noise, 0, 1), 0)

    comps = sorted(components26(lesion), key=lambda c: -len(c))
    vent_d = dilate(vent, 3)
    cortex = brain & (t < 0.7) & (t > 0.35) & ~dilate(vent, 3)
    cortex_near = dilate(cortex, 3)
    rows = []
    label = np.zeros(shape, dtype=np.int16)
    for n, c in enumerate(comps, start=1):
        label[tuple(c.T)] = n
        cen = c.mean(axis=0) + ORIGIN
        touches_v = bool(vent_d[tuple(c.T)].any())
        loc = 'periventricular' if touches_v else ('juxtacortical' if cortex_near[tuple(c.T)].mean() > 0.35 else 'deep')
        rows.append({
            'id': n,
            'voxels': int(len(c)),
            'k': [int(c[:, 2].min()), int(c[:, 2].max())],
            'centre': [round(float(x), 1) for x in cen],
            'location': loc,
            'side': 'L' if cen[0] < 0 else 'R',
            'seed': [int(x) for x in c[0]],
        })

    args.out.mkdir(parents=True, exist_ok=True)

    def emit(name: str, arr: np.ndarray) -> dict:
        Image.fromarray(to_u8(arr)).save(args.out / name)
        return {'file': name, 'cols': int(arr.shape[1]), 'rows': int(arr.shape[0])}

    def sparse(lbl: np.ndarray) -> list[list[int]]:
        r, c = np.nonzero(lbl)
        return [[int(cc), int(rr), int(lbl[rr, cc])] for rr, cc in zip(r, c)]

    # Current lesion: the largest periventricular lesion crossing the primary slice.
    on_k = [r for r in rows if r['k'][0] <= AXIAL_K <= r['k'][1]]
    cur = next(r for r in on_k if r['location'] == 'periventricular')
    ci, cj, _ = (np.array(cur['centre']) - ORIGIN).round().astype(int)

    images = {
        'ax_flair': {**emit(f'ax{AXIAL_K:03d}_flair.png', axial(flair, AXIAL_K)), 'plane': 'axial', 'index': AXIAL_K},
        'cor_flair': {**emit(f'cor{cj:03d}_flair.png', coronal(flair, cj)), 'plane': 'coronal', 'index': int(cj)},
        'sag_flair': {**emit(f'sag{ci:03d}_flair.png', sagittal(flair, ci)), 'plane': 'sagittal', 'index': int(ci)},
    }

    # Intensity crop (display coords of the axial slice) for the range-brush preview.
    ax = to_u8(axial(flair, AXIAL_K))
    ax_lbl = axial(label, AXIAL_K)
    rr, cc = np.nonzero(ax_lbl == cur['id'])
    c0, r0 = int(cc.mean()) - 32, int(rr.mean()) - 32
    crop = ax[r0:r0 + 64, c0:c0 + 64]

    hist, edges = np.histogram((flair[brain] * 255), bins=64, range=(0, 256))
    per_k = {int(k): int(len({int(label[i, j, k]) for i, j in zip(*np.nonzero(label[:, :, k]))})) for k in range(shape[2]) if label[:, :, k].any()}

    data = {
        'source': 'MOCK FLAIR derived from tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w (non-monotonic intensity map, blur 0.6 mm, noise); lesions are synthetic',
        'grid': {'dims': list(shape), 'spacing': [1.0, 1.0, 1.0], 'origin': ORIGIN.tolist()},
        'axialK': AXIAL_K,
        'coronalJ': int(cj),
        'sagittalI': int(ci),
        'images': images,
        'rule': 'a voxel is lesion when more than half of it is inside (membership > 0.5)',
        'lesions': rows,
        'current': cur['id'],
        'lesionsPerK': per_k,
        'labels': {
            'ax': sparse(ax_lbl),
            'cor': sparse(coronal(label, cj)),
            'sag': sparse(sagittal(label, ci)),
        },
        'crop': {'c0': c0, 'r0': r0, 'size': 64, 'values': crop.astype(int).flatten().tolist()},
        'histogram': {'bins': hist.astype(int).tolist(), 'max': 256},
        # The lesion mask (grid i, j, k): the UI derives one row per 26-connected component from it.
        'mask3d': np.argwhere(lesion).astype(int).tolist(),
    }
    (args.out / 'lesions.json').write_text(json.dumps(data, separators=(',', ':')))
    for r in rows:
        print(r)
    print('current', cur['id'], 'crop', c0, r0, 'cor j', cj, 'sag i', ci)


if __name__ == '__main__':
    main()
