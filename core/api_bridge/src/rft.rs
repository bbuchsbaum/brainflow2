//! Gaussian random field theory for cluster-extent inference.
//!
//! A direct port of SPM12's `spm_P_RF.m` / `spm_ECdensity` (Friston et al.
//! 1994, Hum Brain Mapp 1:210-220; Worsley et al. 1996, Hum Brain Mapp
//! 4:58-73) for 3D Z and T fields, plus the lattice resel count of SPM's
//! `spm_resels_vol` (Worsley et al. 1996, eq. 7 / Table 2). With `n = 1`
//! component SPM, `spm_P_RF` reduces to:
//!
//! - `EC_d(u)`: Euler characteristic densities, d = 0..3 (floored at `eps`);
//! - `Ec = Σ_d R_d · EC_d(u)`: expected number of clusters (maxima);
//! - `Ek = EC_0(u) / EC_3(u)`: expected resels per cluster;
//! - `p(n ≥ k) = exp(-β k^(2/3))` with `β = (Γ(5/2) / Ek)^(2/3)`: uncorrected
//!   extent p for a cluster of `k` resels;
//! - `P = 1 - exp(-(Ec + eps) · p)`: FWE-corrected extent p (Poisson clumping).
//!
//! Smoothness is never estimated here: the FWHM is supplied by the user and
//! assumed stationary. Tests compare against an independent numpy/scipy
//! implementation of the same SPM formulas with scipy.stats tails
//! (`tests/fixtures/rft_reference/rft_reference.py`), and the resel count
//! against Worsley's closed form for boxes. SPM itself was not executed.

/// Field type of the thresholded statistic image.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum FieldStatistic {
    Z,
    /// Student t with `df` error degrees of freedom.
    T {
        df: f64,
    },
}

/// Natural log of the gamma function.
fn ln_gamma(x: f64) -> f64 {
    libm::lgamma(x)
}

/// Upper tail of the standard normal, `1 - Φ(u)`.
pub(crate) fn normal_sf(u: f64) -> f64 {
    0.5 * libm::erfc(u / std::f64::consts::SQRT_2)
}

/// Continued fraction for the regularized incomplete beta (modified Lentz).
fn beta_continued_fraction(a: f64, b: f64, x: f64) -> f64 {
    const TINY: f64 = 1e-300;
    const EPS: f64 = 1e-15;
    let qab = a + b;
    let qap = a + 1.0;
    let qam = a - 1.0;
    let mut c = 1.0;
    let mut d = 1.0 - qab * x / qap;
    if d.abs() < TINY {
        d = TINY;
    }
    d = 1.0 / d;
    let mut h = d;
    for m in 1..=500 {
        let m = m as f64;
        let m2 = 2.0 * m;
        let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
        d = 1.0 + aa * d;
        if d.abs() < TINY {
            d = TINY;
        }
        c = 1.0 + aa / c;
        if c.abs() < TINY {
            c = TINY;
        }
        d = 1.0 / d;
        h *= d * c;
        let aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
        d = 1.0 + aa * d;
        if d.abs() < TINY {
            d = TINY;
        }
        c = 1.0 + aa / c;
        if c.abs() < TINY {
            c = TINY;
        }
        d = 1.0 / d;
        let delta = d * c;
        h *= delta;
        if (delta - 1.0).abs() < EPS {
            break;
        }
    }
    h
}

/// Regularized incomplete beta function `I_x(a, b)`.
pub(crate) fn incomplete_beta(a: f64, b: f64, x: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    if x >= 1.0 {
        return 1.0;
    }
    let front =
        (ln_gamma(a + b) - ln_gamma(a) - ln_gamma(b) + a * x.ln() + b * (1.0 - x).ln()).exp();
    if x < (a + 1.0) / (a + b + 2.0) {
        front * beta_continued_fraction(a, b, x) / a
    } else {
        1.0 - front * beta_continued_fraction(b, a, 1.0 - x) / b
    }
}

/// Upper tail of Student's t with `df` degrees of freedom, `P(T > t)`.
pub(crate) fn t_sf(t: f64, df: f64) -> f64 {
    let tail = 0.5 * incomplete_beta(df / 2.0, 0.5, df / (df + t * t));
    if t >= 0.0 {
        tail
    } else {
        1.0 - tail
    }
}

/// Euler characteristic densities `EC_0..EC_3` at threshold `u`
/// (`spm_ECdensity`, rows 1-4), per resel.
pub(crate) fn ec_densities(stat: FieldStatistic, u: f64) -> [f64; 4] {
    let a = 4.0 * std::f64::consts::LN_2;
    let two_pi = 2.0 * std::f64::consts::PI;
    match stat {
        FieldStatistic::Z => {
            let b = (-u * u / 2.0).exp();
            [
                normal_sf(u),
                a.sqrt() / two_pi * b,
                a / two_pi.powf(1.5) * b * u,
                a.powf(1.5) / two_pi.powi(2) * b * (u * u - 1.0),
            ]
        }
        FieldStatistic::T { df: v } => {
            let b = (ln_gamma((v + 1.0) / 2.0) - ln_gamma(v / 2.0)).exp();
            let c = (1.0 + u * u / v).powf((1.0 - v) / 2.0);
            [
                t_sf(u, v),
                a.sqrt() / two_pi * c,
                a / two_pi.powf(1.5) * c * u / (v / 2.0).sqrt() * b,
                a.powf(1.5) / two_pi.powi(2) * c * ((v - 1.0) * u * u / v - 1.0),
            ]
        }
    }
}

/// Resel counts `[R0, R1, R2, R3]` of a binary search mask on a lattice with
/// voxel sizes `voxel_fwhm` given in FWHM units (voxel size / FWHM per axis),
/// counting points, edges, faces and cubes as `spm_resels_vol` does. For an
/// `a × b × c` box (in FWHM units, voxel-centre extents) this gives
/// `[1, a+b+c, ab+bc+ca, abc]`.
pub(crate) fn lattice_resels(mask: &[bool], dims: [usize; 3], voxel_fwhm: [f64; 3]) -> [f64; 4] {
    let [nx, ny, nz] = dims;
    let at = |i: usize, j: usize, k: usize| -> bool {
        i < nx && j < ny && k < nz && mask[i + nx * (j + ny * k)]
    };
    let (mut p, mut ex, mut ey, mut ez) = (0u64, 0u64, 0u64, 0u64);
    let (mut fxy, mut fxz, mut fyz, mut cubes) = (0u64, 0u64, 0u64, 0u64);
    for k in 0..nz {
        for j in 0..ny {
            for i in 0..nx {
                if !at(i, j, k) {
                    continue;
                }
                p += 1;
                let x = at(i + 1, j, k);
                let y = at(i, j + 1, k);
                let z = at(i, j, k + 1);
                let xy = x && y && at(i + 1, j + 1, k);
                let xz = x && z && at(i + 1, j, k + 1);
                let yz = y && z && at(i, j + 1, k + 1);
                ex += u64::from(x);
                ey += u64::from(y);
                ez += u64::from(z);
                fxy += u64::from(xy);
                fxz += u64::from(xz);
                fyz += u64::from(yz);
                cubes += u64::from(xy && xz && yz && at(i + 1, j + 1, k + 1));
            }
        }
    }
    let [rx, ry, rz] = voxel_fwhm;
    let f = |n: u64| n as f64;
    let c = f(cubes);
    [
        f(p) - (f(ex) + f(ey) + f(ez)) + (f(fxy) + f(fxz) + f(fyz)) - c,
        (f(ex) - f(fxy) - f(fxz) + c) * rx
            + (f(ey) - f(fxy) - f(fyz) + c) * ry
            + (f(ez) - f(fxz) - f(fyz) + c) * rz,
        (f(fxy) - c) * rx * ry + (f(fxz) - c) * rx * rz + (f(fyz) - c) * ry * rz,
        c * rx * ry * rz,
    ]
}

/// Cluster-extent model at one cluster-forming threshold.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ExtentModel {
    /// Expected number of clusters `Ec` (SPM's `<c>` before the extent term).
    pub expected_clusters: f64,
    /// Expected resels per cluster `Ek`.
    pub expected_resels_per_cluster: f64,
    beta: f64,
}

impl ExtentModel {
    /// `spm_P_RF(1, k, u, df, STAT, R, 1)` for `D = 3`; `resels` must have
    /// `R3 > 0`.
    pub(crate) fn new(stat: FieldStatistic, u: f64, resels: [f64; 4]) -> Self {
        let ec = ec_densities(stat, u).map(|d| d.max(f64::EPSILON));
        let expected_clusters = resels.iter().zip(ec).map(|(r, d)| r * d).sum();
        let expected_resels_per_cluster = ec[0] / ec[3];
        // D = 3: beta = (Γ(D/2 + 1) / Ek)^(2/D).
        let beta = (ln_gamma(2.5).exp() / expected_resels_per_cluster).powf(2.0 / 3.0);
        Self {
            expected_clusters,
            expected_resels_per_cluster,
            beta,
        }
    }

    /// Uncorrected `P(n ≥ k)` for one cluster of `k_resels`.
    pub(crate) fn p_uncorrected(&self, k_resels: f64) -> f64 {
        if k_resels <= 0.0 {
            return 1.0;
        }
        (-self.beta * k_resels.powf(2.0 / 3.0)).exp()
    }

    /// FWE-corrected extent p: probability of one or more clusters of at
    /// least `k_resels` anywhere in the search volume.
    pub(crate) fn p_fwe(&self, k_resels: f64) -> f64 {
        1.0 - (-(self.expected_clusters + f64::EPSILON) * self.p_uncorrected(k_resels)).exp()
    }
}

#[cfg(test)]
// Reference values are pasted with full printed precision.
#[allow(clippy::excessive_precision)]
mod tests {
    use super::*;

    fn close(actual: f64, expected: f64, rel: f64) {
        let err = (actual - expected).abs() / expected.abs().max(1e-300);
        assert!(
            err <= rel,
            "actual {actual:e} vs expected {expected:e} (rel err {err:e})"
        );
    }

    /// Distribution tails against scipy.stats (`rft_reference.py`).
    #[test]
    fn tails_match_scipy() {
        close(normal_sf(3.1), 9.676032132183562e-04, 1e-12);
        close(normal_sf(2.3), 1.072411002167581e-02, 1e-12);
        close(t_sf(3.1, 20.0), 2.822438469562088e-03, 1e-10);
        close(t_sf(4.5, 12.0), 3.633264607018460e-04, 1e-10);
        close(t_sf(2.0, 5.0), 5.096973941492915e-02, 1e-10);
        close(1.0 - t_sf(-2.0, 5.0), 5.096973941492915e-02, 1e-10);
    }

    #[test]
    fn box_resels_match_worsley_closed_form() {
        // 10 x 6 x 4 voxels of 2 mm with 4 mm FWHM: voxel size 0.5 FWHM.
        // Voxel-centre extents a, b, c = (n - 1) * 0.5 = 4.5, 2.5, 1.5.
        let dims = [10, 6, 4];
        let mask = vec![true; 240];
        let r = lattice_resels(&mask, dims, [0.5; 3]);
        let (a, b, c) = (4.5, 2.5, 1.5);
        let expected = [1.0, a + b + c, a * b + b * c + c * a, a * b * c];
        for (got, want) in r.iter().zip(expected) {
            close(*got, want, 1e-12);
        }
        // Anisotropic voxels scale each axis separately.
        let r = lattice_resels(&mask, dims, [0.5, 1.0, 0.25]);
        let (a, b, c) = (4.5, 5.0, 0.75);
        close(r[1], a + b + c, 1e-12);
        close(r[2], a * b + b * c + c * a, 1e-12);
        close(r[3], a * b * c, 1e-12);
    }

    #[test]
    fn hollow_and_split_masks_have_expected_euler_characteristic() {
        // Two separate boxes: R0 = 2.
        let dims = [9, 3, 3];
        let mut mask = vec![true; 81];
        for k in 0..3 {
            for j in 0..3 {
                mask[4 + 9 * (j + 3 * k)] = false;
            }
        }
        close(lattice_resels(&mask, dims, [1.0; 3])[0], 2.0, 1e-12);
        // A 3x3x3 shell with a hollow centre: sphere-like, R0 = 2.
        let mut shell = vec![true; 27];
        shell[13] = false;
        close(lattice_resels(&shell, [3, 3, 3], [1.0; 3])[0], 2.0, 1e-12);
    }

    /// `[P, p, Ec, Ek]` as `spm_P_RF(1, k, u, [1 df], STAT, R, 1)` returns
    /// them, from the independent implementation in `rft_reference.py`.
    #[test]
    fn extent_p_matches_independent_reference() {
        struct Case {
            stat: FieldStatistic,
            u: f64,
            resels: [f64; 4],
            k: f64,
            reference: [f64; 4],
        }
        let cases = [
            Case {
                stat: FieldStatistic::Z,
                u: 3.1,
                resels: [1.0, 30.0, 300.0, 1000.0],
                k: 1.0,
                reference: [
                    6.035273930827079e-02,
                    6.449758039338495e-03,
                    9.651637836224776e+00,
                    1.173574580448900e-01,
                ],
            },
            Case {
                stat: FieldStatistic::Z,
                u: 2.3,
                resels: [2.0, 45.5, 610.25, 1873.0],
                k: 12.5,
                reference: [
                    4.308402828023805e-05,
                    5.060366731788741e-07,
                    8.514196442130687e+01,
                    3.010540205104457e-01,
                ],
            },
            Case {
                stat: FieldStatistic::T { df: 20.0 },
                u: 3.5,
                resels: [1.0, 30.0, 300.0, 1000.0],
                k: 0.5,
                reference: [
                    2.567230578817410e-01,
                    1.935636513128601e-02,
                    1.532759723649940e+01,
                    8.483589084713153e-02,
                ],
            },
            Case {
                stat: FieldStatistic::T { df: 12.0 },
                u: 3.0,
                resels: [1.0, 12.0, 80.0, 200.0],
                k: 2.0,
                reference: [
                    8.431867294701356e-03,
                    8.581421405494380e-04,
                    9.867382319289790e+00,
                    1.417068327992826e-01,
                ],
            },
        ];
        for case in cases {
            let model = ExtentModel::new(case.stat, case.u, case.resels);
            close(model.p_fwe(case.k), case.reference[0], 1e-9);
            close(model.p_uncorrected(case.k), case.reference[1], 1e-9);
            close(model.expected_clusters, case.reference[2], 1e-9);
            close(model.expected_resels_per_cluster, case.reference[3], 1e-9);
        }
    }

    #[test]
    fn larger_clusters_are_less_likely() {
        let model = ExtentModel::new(FieldStatistic::Z, 3.1, [1.0, 30.0, 300.0, 1000.0]);
        assert!(model.p_fwe(0.5) > model.p_fwe(2.0));
        assert!(model.p_fwe(2.0) > model.p_fwe(8.0));
        assert_eq!(model.p_uncorrected(0.0), 1.0);
    }
}
