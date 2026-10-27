"""Independent reference values for the neuro-inference crate (src/rft.rs,
src/resels.rs, src/distributions.rs).

Second implementation of SPM12's spm_P_RF / spm_ECdensity (D = 3, n = 1) in
numpy/scipy, with distribution tails from scipy.stats rather than the Rust
code's own erfc / incomplete beta. The formulas follow the SPM12 source
(spm_P_RF.m, $Id 5770; spm_ECdensity.m) and Worsley et al. (1996), Hum Brain
Mapp 4:58-73; Friston et al. (1994), Hum Brain Mapp 1:210-220.

    python3 rft_reference.py            # print the values pasted into rft::tests
    python3 rft_reference.py --simulate # Monte Carlo check of Ec and Ek

The simulation smooths white noise with a Gaussian kernel of known FWHM,
renormalises to unit variance, thresholds, and compares the mean number of
clusters and the mean cluster size (in resels) with the theory. It is a sanity
check of the theory and of the resel convention, not a unit test: agreement is
approximate (lattice and boundary effects, finite samples).
"""

import sys

import numpy as np
from scipy import ndimage, special, stats


def ec_densities(stat, u, df=None):
    a = 4 * np.log(2)
    if stat == "Z":
        b = np.exp(-u * u / 2)
        return np.array(
            [
                stats.norm.sf(u),
                a**0.5 / (2 * np.pi) * b,
                a / (2 * np.pi) ** 1.5 * b * u,
                a**1.5 / (2 * np.pi) ** 2 * b * (u * u - 1),
            ]
        )
    if stat == "F":
        k, v = df
        a = 4 * np.log(2) / (2 * np.pi)
        b = special.gammaln(v / 2) + special.gammaln(k / 2)
        x = k * u / v
        tail = (1 + x) ** (-(v + k - 2) / 2)
        return np.array(
            [
                stats.f.sf(u, k, v),
                a**0.5 * np.exp(special.gammaln((v + k - 1) / 2) - b) * 2**0.5 * x ** ((k - 1) / 2) * tail,
                a * np.exp(special.gammaln((v + k - 2) / 2) - b) * x ** ((k - 2) / 2) * tail * ((v - 1) * x - (k - 1)),
                a**1.5
                * np.exp(special.gammaln((v + k - 3) / 2) - b)
                * 2**-0.5
                * x ** ((k - 3) / 2)
                * tail
                * ((v - 1) * (v - 2) * x**2 - (2 * v * k - v - k - 1) * x + (k - 1) * (k - 2)),
            ]
        )
    v = df
    b = np.exp(special.gammaln((v + 1) / 2) - special.gammaln(v / 2))
    c = (1 + u * u / v) ** ((1 - v) / 2)
    return np.array(
        [
            stats.t.sf(u, v),
            a**0.5 / (2 * np.pi) * c,
            a / (2 * np.pi) ** 1.5 * c * u / (v / 2) ** 0.5 * b,
            a**1.5 / (2 * np.pi) ** 2 * c * ((v - 1) * u * u / v - 1),
        ]
    )


def p_rf(k, u, stat, resels, df=None):
    """[P, p, Ec, Ek] = spm_P_RF(1, k, u, [1 df], STAT, R, 1) for 3D."""
    eps = np.finfo(float).eps
    ec = np.maximum(ec_densities(stat, u, df), eps)
    resels = np.asarray(resels, dtype=float)
    Ec = float(np.sum(resels * ec))
    Ek = float(ec[0] / ec[3])
    beta = (special.gamma(2.5) / Ek) ** (2 / 3)
    p = float(np.exp(-beta * k ** (2 / 3))) if k > 0 else 1.0
    P = 1 - np.exp(-(Ec + eps) * p)
    return P, p, Ec, Ek


def lattice_resels(mask, voxel_fwhm):
    m = mask.astype(bool)
    pad = np.zeros(np.array(m.shape) + 1, dtype=bool)
    pad[: m.shape[0], : m.shape[1], : m.shape[2]] = m
    m = pad
    s = lambda di, dj, dk: m[
        di : di + m.shape[0] - 1, dj : dj + m.shape[1] - 1, dk : dk + m.shape[2] - 1
    ]
    o = s(0, 0, 0)
    x, y, z = o & s(1, 0, 0), o & s(0, 1, 0), o & s(0, 0, 1)
    xy = x & y & s(1, 1, 0)
    xz = x & z & s(1, 0, 1)
    yz = y & z & s(0, 1, 1)
    c = xy & xz & yz & s(1, 1, 1)
    P, Ex, Ey, Ez = o.sum(), x.sum(), y.sum(), z.sum()
    Fxy, Fxz, Fyz, C = xy.sum(), xz.sum(), yz.sum(), c.sum()
    rx, ry, rz = voxel_fwhm
    return np.array(
        [
            P - (Ex + Ey + Ez) + (Fxy + Fxz + Fyz) - C,
            (Ex - Fxy - Fxz + C) * rx
            + (Ey - Fxy - Fyz + C) * ry
            + (Ez - Fxz - Fyz + C) * rz,
            (Fxy - C) * rx * ry + (Fxz - C) * rx * rz + (Fyz - C) * ry * rz,
            C * rx * ry * rz,
        ],
        dtype=float,
    )


CASES = [
    ("Z", 3.1, None, [1, 30, 300, 1000], 1.0),
    ("Z", 2.3, None, [2, 45.5, 610.25, 1873], 12.5),
    ("T", 3.5, 20, [1, 30, 300, 1000], 0.5),
    ("T", 3.0, 12, [1, 12, 80, 200], 2.0),
    ("F", 9.0, (3, 30), [1, 30, 300, 1000], 1.0),
    ("F", 6.0, (2, 40), [1, 12, 80, 200], 0.5),
]


def print_reference():
    print(f"normal_sf(3.1) = {stats.norm.sf(3.1):.15e}")
    print(f"normal_sf(2.3) = {stats.norm.sf(2.3):.15e}")
    for t, v in [(3.1, 20), (4.5, 12), (2.0, 5)]:
        print(f"t_sf({t}, {v}) = {stats.t.sf(t, v):.15e}")
    for f, k, v in [(4.2, 3, 30), (2.5, 2, 40), (0.7, 5, 12)]:
        print(f"f_sf({f}, {k}, {v}) = {stats.f.sf(f, k, v):.15e}")
    for stat, u, df, R, k in CASES:
        P, p, Ec, Ek = p_rf(k, u, stat, R, df)
        print(f"{stat} u={u} df={df} k={k}: [{P:.15e}, {p:.15e}, {Ec:.15e}, {Ek:.15e}]")


def simulate(n_fields=200, shape=(64, 64, 64), fwhm_vox=4.0, u=3.0, seed=1):
    rng = np.random.default_rng(seed)
    sigma = fwhm_vox / np.sqrt(8 * np.log(2))
    pad = int(np.ceil(4 * sigma))
    counts, sizes = [], []
    for _ in range(n_fields):
        noise = rng.standard_normal(tuple(s + 2 * pad for s in shape))
        field = ndimage.gaussian_filter(noise, sigma, mode="constant")
        field = field[pad:-pad, pad:-pad, pad:-pad]
        field /= field.std()
        labels, n = ndimage.label(field > u, structure=np.ones((3, 3, 3)))
        counts.append(n)
        if n:
            sizes.extend(np.bincount(labels.ravel())[1:])
    resels = lattice_resels(np.ones(shape, bool), [1 / fwhm_vox] * 3)
    _, _, Ec, Ek = p_rf(0, u, "Z", resels)
    k_resels = np.array(sizes) / fwhm_vox**3
    print(f"resels = {resels}")
    print(f"simulated mean clusters = {np.mean(counts):.3f}, theory Ec = {Ec:.3f}")
    print(
        f"simulated mean resels/cluster = {k_resels.mean():.4f}, theory Ek = {Ek:.4f}"
    )
    # Uncorrected P(n >= k) for the median simulated size.
    k = float(np.median(k_resels))
    beta = (special.gamma(2.5) / Ek) ** (2 / 3)
    print(
        f"P(n >= median {k:.4f} resels): simulated {np.mean(k_resels >= k):.3f}, "
        f"theory {np.exp(-beta * k ** (2 / 3)):.3f}"
    )


if __name__ == "__main__":
    if "--simulate" in sys.argv:
        simulate()
    else:
        print_reference()
