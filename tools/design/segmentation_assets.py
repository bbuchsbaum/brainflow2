#!/usr/bin/env python3
"""Generate design-exploration assets for the segmentation module (round 0).

Renders real MNI152NLin2009cAsym 1 mm slices (T2w, T1w and a view-only
unsharp-masked T2w) to 8-bit grayscale PNGs and writes mock hippocampal
subfield labels as sparse JSON aligned to the same voxel grid.

The labels are MOCK: a geometric partition of the Harvard-Oxford left
hippocampus (TemplateFlow atlas-HOSPA, label 9) into CA1, CA2/3, DG, SRLM and
subiculum, plus an ERC strip taken from the adjacent cortex. They only need to
be anatomically plausible for screenshots; they are not a protocol.

Inputs (pass paths; nothing is downloaded here):
  --t1   tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii
         (git show HEAD:test-data/unit/... ; the working-tree copy is truncated)
  --t2   tpl-MNI152NLin2009cAsym_res-01_T2w.nii.gz        (TemplateFlow)
  --dseg tpl-MNI152NLin2009cAsym_res-01_atlas-HOSPA_desc-th25_dseg.nii.gz
  --out  ui2/src/modules/segmentation/__design__/assets

Run with an isolated interpreter that has nibabel, numpy, scipy and Pillow:
  python3 -I tools/design/segmentation_assets.py --t1 ... --t2 ... --dseg ... --out ...
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import nibabel as nib
import numpy as np
from PIL import Image
from scipy import ndimage

# Label ids (shared with ui2/src/modules/segmentation/components/shared/mockData.ts).
CA1, CA23, DG, SUB, ERC, SRLM = 1, 2, 3, 4, 5, 6
HIPPO_L, CORTEX_L = 9, 2

# Voxel indices of the slices we render (1 mm grid, origin -96, -132, -78).
CORONAL_J = [100, 104, 106, 108, 110, 112, 114, 116]
PRIMARY_J = 110  # y = -22 mm, hippocampal body
AXIAL_K = 62  # z = -16 mm
SAGITTAL_I = 70  # x = -26 mm
TRACED_J = range(100, 117)  # rater A has traced y = -32 .. -16 mm so far
ORIGIN = np.array([-96.0, -132.0, -78.0])


def load(path: Path) -> tuple[np.ndarray, np.ndarray]:
    img = nib.load(str(path))
    return np.asanyarray(img.dataobj).astype(np.float32), img.affine


def window(vol: np.ndarray, lo_pct: float, hi_pct: float) -> tuple[float, float]:
    nz = vol[vol > 0]
    return float(np.percentile(nz, lo_pct)), float(np.percentile(nz, hi_pct))


def to_u8(a: np.ndarray, lo: float, hi: float, gamma: float = 1.0) -> np.ndarray:
    x = np.clip((a - lo) / (hi - lo), 0, 1) ** gamma
    return (x * 255 + 0.5).astype(np.uint8)


# Slice extraction: display rows top->bottom, columns left->right.
#   coronal  cols = i (patient left on screen left), rows = k descending (superior up)
#   axial    cols = i,                               rows = j descending (anterior up)
#   sagittal cols = j descending (anterior left),    rows = k descending
def coronal(v: np.ndarray, j: int) -> np.ndarray:
    return v[:, j, ::-1].T


def axial(v: np.ndarray, k: int) -> np.ndarray:
    return v[:, ::-1, k].T


def sagittal(v: np.ndarray, i: int) -> np.ndarray:
    return v[i, ::-1, ::-1].T


def partition_slice(hip: np.ndarray, cortex: np.ndarray, j: int) -> np.ndarray:
    """Mock subfields for one coronal slice; arrays are (i, k)."""
    out = np.zeros(hip.shape, np.uint8)
    if hip.sum() < 6:
        return out
    ii, kk = np.nonzero(hip)
    ci, ck = ii.mean(), kk.mean()
    hw = max(ii.max() - ii.min(), 4) / 2.0
    hh = max(kk.max() - kk.min(), 4) / 2.0
    gi, gk = np.meshgrid(np.arange(hip.shape[0]), np.arange(hip.shape[1]), indexing='ij')
    u = (gi - ci) / hw  # + = medial for the left hemisphere
    v = (gk - ck) / hh  # + = superior
    dg = hip & (((u - 0.18) / 0.42) ** 2 + ((v - 0.05) / 0.42) ** 2 < 1.0)
    ring = ndimage.binary_dilation(dg) & hip & ~dg
    srlm = ring & (u < 0.45) & (v > -0.55)
    rest = hip & ~dg & ~srlm
    ca23 = rest & (v > 0.2) & (u > 0.05)
    sub = rest & ~ca23 & (v < -0.05) & (u > 0.3)
    ca1 = rest & ~ca23 & ~sub
    out[ca1] = CA1
    out[ca23] = CA23
    out[dg] = DG
    out[srlm] = SRLM
    out[sub] = SUB
    if 104 <= j <= 120:
        box = (u > 0.55) & (u < 2.4) & (v < -0.35) & (v > -2.2)
        erc = cortex & box & ~hip
        erc &= ndimage.binary_dilation(sub | hip, iterations=5)
        out[erc] = ERC
    return out


def rater_b(a: np.ndarray, hip: np.ndarray) -> np.ndarray:
    """A second rater's slice: subiculum traced smaller (its medial part left
    unlabelled), DG wider (into the SRLM above it), CA1 drawn one voxel into
    the white matter on its lateral edge. Rater B did not trace ERC."""
    b = a.copy()
    b[b == ERC] = 0
    if hip.sum() < 6:
        return b
    ii, kk = np.nonzero(hip)
    ci = ii.mean()
    hw = max(ii.max() - ii.min(), 4) / 2.0
    gi = np.arange(a.shape[0])[:, None] * np.ones((1, a.shape[1]))
    u = (gi - ci) / hw
    b[(a == SUB) & (u < 0.55)] = 0
    b[(a == SRLM) & ndimage.binary_dilation(a == DG) & (np.arange(a.shape[1])[None, :] > kk.mean())] = DG
    lateral = ndimage.binary_dilation(a == CA1) & (a == 0) & (u < -0.55)
    b[lateral] = CA1
    return b


def hd95(a: np.ndarray, b: np.ndarray) -> float | None:
    """95th percentile symmetric surface distance (mm, 1 mm grid)."""
    if not a.any() or not b.any():
        return None
    sa = a & ~ndimage.binary_erosion(a)
    sb = b & ~ndimage.binary_erosion(b)
    da = ndimage.distance_transform_edt(~a)
    db = ndimage.distance_transform_edt(~b)
    d = np.concatenate([db[sa], da[sb]])
    return round(float(np.percentile(d, 95)), 2)


def review_stats(labels: np.ndarray, hip: np.ndarray, j_range: range) -> dict:
    """Rater A (the full mock labels) against rater B (rater_b on every
    coronal slice): per-label volumes, Dice, HD95 and disagreement by slice,
    plus the number of 2D disagreement regions (the review's navigation)."""
    b = np.zeros_like(labels)
    for j in j_range:
        b[:, j, :] = rater_b(labels[:, j, :], hip[:, j, :])
    out: dict = {'labels': {}, 'regions': 0, 'regionsBySlice': {}}
    for l in (CA1, CA23, DG, SUB, ERC, SRLM):
        ma, mb = labels == l, b == l
        va, vb = int(ma.sum()), int(mb.sum())
        dice = None if va == 0 or vb == 0 else round(2 * int((ma & mb).sum()) / (va + vb), 3)
        by_slice = [int(((ma ^ mb)[:, j, :]).sum()) for j in j_range]
        out['labels'][str(l)] = {'volA': va, 'volB': vb, 'dice': dice, 'hd95': hd95(ma, mb), 'disagreeBySlice': by_slice}
    # Navigation regions: 2D groups of at least 3 disagreeing voxels; ERC is
    # not compared because rater B did not trace it.
    for j in j_range:
        diff = (labels[:, j, :] != b[:, j, :]) & (labels[:, j, :] != ERC)
        lab, n_all = ndimage.label(diff)
        sizes = ndimage.sum(diff, lab, range(1, n_all + 1)) if n_all else []
        n = int(sum(1 for s in sizes if s >= 3))
        out['regionsBySlice'][str(j)] = n
        out['regions'] += n
    return out


def sparse(lbl2d: np.ndarray) -> list[list[int]]:
    rr, cc = np.nonzero(lbl2d)
    return [[int(c), int(r), int(lbl2d[r, c])] for r, c in zip(rr, cc)]


def save_png(arr: np.ndarray, path: Path) -> None:
    Image.fromarray(arr, mode='L').save(path, optimize=True)


def stroke_points(lbl2d: np.ndarray, label: int, side: str) -> list[list[float]]:
    """A smooth polyline through one side of a label's voxels (display coords)."""
    rr, cc = np.nonzero(lbl2d == label)
    if len(rr) == 0:
        return []
    cy, cx = rr.mean(), cc.mean()
    ang = np.arctan2(rr + 0.5 - cy, cc + 0.5 - cx)
    if side == 'lateral':  # screen left / lower-left arc of CA1
        sel = (cc + 0.5 < cx + 1)
    else:
        sel = np.ones_like(rr, bool)
    pts = sorted(zip(ang[sel], cc[sel] + 0.5, rr[sel] + 0.5))
    xs = np.array([p[1] for p in pts])
    ys = np.array([p[2] for p in pts])
    n = max(len(xs) // 3, 2)
    idx = np.linspace(0, len(xs) - 1, n).round().astype(int)
    return [[round(float(xs[k]), 2), round(float(ys[k]), 2)] for k in idx]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--t1', type=Path, required=True)
    ap.add_argument('--t2', type=Path, required=True)
    ap.add_argument('--dseg', type=Path, required=True)
    ap.add_argument('--out', type=Path, required=True)
    ap.add_argument('--preview', type=Path, help='optional directory for an alignment preview PNG')
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    t1, a1 = load(args.t1)
    t2, a2 = load(args.t2)
    dseg, a3 = load(args.dseg)
    dseg = dseg.astype(np.int16)
    for a in (a1, a2, a3):
        assert np.allclose(a[:3, 3], ORIGIN) and np.allclose(np.diag(a)[:3], 1.0), a
    assert t1.shape == t2.shape == dseg.shape

    # The template's padded background sits near 300; start the window above it.
    t2_lo, t2_hi = window(t2, 33.0, 99.7)
    t1_lo, t1_hi = window(t1, 0.5, 99.8)
    blur = ndimage.gaussian_filter(t2, 1.5)
    t2u = t2 + 1.2 * (t2 - blur)  # view-only unsharp mask, sigma 1.5 mm, amount 1.2

    hip = dseg == HIPPO_L
    cortex = dseg == CORTEX_L
    labels = np.zeros(t2.shape, np.uint8)
    for j in range(t2.shape[1]):
        labels[:, j, :] = partition_slice(hip[:, j, :], cortex[:, j, :], j)
    traced = np.zeros_like(labels)
    for j in TRACED_J:
        traced[:, j, :] = labels[:, j, :]

    images: dict[str, dict] = {}

    def emit(name: str, arr: np.ndarray, plane: str, index: int, contrast: str) -> None:
        save_png(arr, args.out / f'{name}.png')
        images[name] = {
            'file': f'{name}.png',
            'plane': plane,
            'index': index,
            'contrast': contrast,
            'cols': int(arr.shape[1]),
            'rows': int(arr.shape[0]),
        }

    for j in CORONAL_J:
        emit(f'cor{j}_t2', to_u8(coronal(t2, j), t2_lo, t2_hi), 'coronal', j, 't2')
    emit(f'cor{PRIMARY_J}_t1', to_u8(coronal(t1, PRIMARY_J), t1_lo, t1_hi), 'coronal', PRIMARY_J, 't1')
    emit(
        f'cor{PRIMARY_J}_t2u',
        to_u8(coronal(t2u, PRIMARY_J), t2_lo, t2_hi),
        'coronal',
        PRIMARY_J,
        't2-unsharp',
    )
    emit(f'ax{AXIAL_K:03d}_t2', to_u8(axial(t2, AXIAL_K), t2_lo, t2_hi), 'axial', AXIAL_K, 't2')
    emit(f'ax{AXIAL_K:03d}_t1', to_u8(axial(t1, AXIAL_K), t1_lo, t1_hi), 'axial', AXIAL_K, 't1')
    emit(f'sag{SAGITTAL_I:03d}_t2', to_u8(sagittal(t2, SAGITTAL_I), t2_lo, t2_hi), 'sagittal', SAGITTAL_I, 't2')
    emit(f'sag{SAGITTAL_I:03d}_t1', to_u8(sagittal(t1, SAGITTAL_I), t1_lo, t1_hi), 'sagittal', SAGITTAL_I, 't1')

    label_slices: dict[str, dict] = {}
    for j in CORONAL_J:
        label_slices[f'cor{j}'] = {'plane': 'coronal', 'index': j, 'voxels': sparse(coronal(labels, j))}
        label_slices[f'cor{j}_traced'] = {
            'plane': 'coronal',
            'index': j,
            'voxels': sparse(coronal(traced, j)),
        }
    b = rater_b(labels[:, PRIMARY_J, :], hip[:, PRIMARY_J, :])
    label_slices[f'cor{PRIMARY_J}_raterB'] = {'plane': 'coronal', 'index': PRIMARY_J, 'voxels': sparse(b[:, ::-1].T)}
    label_slices[f'ax{AXIAL_K:03d}_traced'] = {'plane': 'axial', 'index': AXIAL_K, 'voxels': sparse(axial(traced, AXIAL_K))}
    label_slices[f'sag{SAGITTAL_I:03d}_traced'] = {
        'plane': 'sagittal',
        'index': SAGITTAL_I,
        'voxels': sparse(sagittal(traced, SAGITTAL_I)),
    }
    label_slices[f'ax{AXIAL_K:03d}_all'] = {'plane': 'axial', 'index': AXIAL_K, 'voxels': sparse(axial(labels, AXIAL_K))}
    label_slices[f'sag{SAGITTAL_I:03d}_all'] = {
        'plane': 'sagittal',
        'index': SAGITTAL_I,
        'voxels': sparse(sagittal(labels, SAGITTAL_I)),
    }

    prim = coronal(labels, PRIMARY_J)
    counts = {str(l): int((traced == l).sum()) for l in (CA1, CA23, DG, SUB, ERC, SRLM)}
    hip_rows, hip_cols = np.nonzero(coronal(hip.astype(np.uint8), PRIMARY_J))
    rows_any = np.nonzero(labels.any(axis=(0, 2)))[0]
    j_all = range(int(rows_any.min()), int(rows_any.max()) + 1)
    area_by_slice = {
        'j': [j_all.start, j_all.stop - 1],
        'traced': {str(l): [int((traced[:, j, :] == l).sum()) for j in j_all] for l in (CA1, CA23, DG, SUB, ERC, SRLM)},
        'all': {str(l): [int((labels[:, j, :] == l).sum()) for j in j_all] for l in (CA1, CA23, DG, SUB, ERC, SRLM)},
    }
    meta = {
        'source': {
            't2': 'TemplateFlow tpl-MNI152NLin2009cAsym_res-01_T2w (real template)',
            't1': 'tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w (real template, test-data via git)',
            'labels': 'MOCK subfields: geometric partition of HOSPA left hippocampus (label 9)',
            't2-unsharp': 'T2w + 1.2 x (T2w - gaussian(1.5 mm)); view-only lens',
        },
        'grid': {'dims': list(t2.shape), 'spacing': [1.0, 1.0, 1.0], 'origin': ORIGIN.tolist()},
        'primary': {'j': PRIMARY_J, 'axialK': AXIAL_K, 'sagittalI': SAGITTAL_I},
        'hippocampusCentre': [round(float(hip_cols.mean()) + 0.5, 2), round(float(hip_rows.mean()) + 0.5, 2)],
        'hippocampusRangeJ': [int(rows_any.min()), int(rows_any.max())],
        'tracedJ': [TRACED_J.start, TRACED_J.stop - 1],
        'counts': counts,
        'areaBySlice': area_by_slice,
        'review': {'j': [j_all.start, j_all.stop - 1], **review_stats(labels, hip, j_all)},
        'strokeCa1': stroke_points(prim, CA1, 'lateral'),
        'strokeDg': stroke_points(prim, DG, 'all'),
        'images': images,
        'labels': label_slices,
    }
    (args.out / 'slices.json').write_text(json.dumps(meta, separators=(',', ':')))

    print(json.dumps({'counts': counts, 'hipC': meta['hippocampusCentre'], 'images': len(images)}))
    if not args.preview:
        return
    # Composite preview for checking alignment (not shipped).
    prev = args.preview
    prev.mkdir(parents=True, exist_ok=True)
    pal = {CA1: (224, 106, 90), CA23: (91, 176, 216), DG: (227, 197, 82), SUB: (138, 122, 224), ERC: (217, 138, 208), SRLM: (192, 138, 90)}
    g = to_u8(coronal(t2, PRIMARY_J), t2_lo, t2_hi)
    rgb = np.stack([g] * 3, -1).astype(np.float32)
    for l, c in pal.items():
        m = prim == l
        rgb[m] = 0.45 * rgb[m] + 0.55 * np.array(c)
    Image.fromarray(rgb.astype(np.uint8)).resize((193 * 4, 193 * 4), Image.NEAREST).save(prev / 'cor_primary_labels.png')


if __name__ == '__main__':
    main()
