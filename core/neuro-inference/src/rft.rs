//! Gaussian random field theory for cluster extent (SPM's `spm_P_RF`).
//!
//! A port of SPM12 `spm_P_RF.m` and `spm_ECdensity` for 3D fields and one
//! component SPM (`n = 1`), after Friston et al. (1994), Hum Brain Mapp
//! 1:210-220, and Worsley et al. (1996), Hum Brain Mapp 4:58-73:
//!
//! - `EC_d(u)`: Euler characteristic densities, d = 0..3 (floored at `eps`);
//! - `Ec = Σ_d R_d · EC_d(u)`: expected number of clusters;
//! - `Ek = EC_0(u) / EC_3(u)`: expected resels per cluster;
//! - `p(n ≥ k) = exp(-β k^(2/3))`, `β = (Γ(5/2) / Ek)^(2/3)`: uncorrected
//!   extent p for a cluster of `k` resels;
//! - `P = 1 - exp(-(Ec + eps) · p)`: FWE-corrected extent p (Poisson clumping).

use crate::distributions::{f_sf, ln_gamma, normal_sf, t_sf};
use crate::field::FieldKind;

/// Euler characteristic densities `EC_0..EC_3` at threshold `u`
/// (`spm_ECdensity`, rows 1-4), per resel.
pub fn ec_densities(kind: FieldKind, u: f64) -> [f64; 4] {
    let a = 4.0 * std::f64::consts::LN_2;
    let two_pi = 2.0 * std::f64::consts::PI;
    match kind {
        FieldKind::Z => {
            let b = (-u * u / 2.0).exp();
            [
                normal_sf(u),
                a.sqrt() / two_pi * b,
                a / two_pi.powf(1.5) * b * u,
                a.powf(1.5) / two_pi.powi(2) * b * (u * u - 1.0),
            ]
        }
        FieldKind::F { df1: k, df2: v } => {
            // spm_ECdensity 'F' (a here is 4 ln2 / 2π).
            let a = 4.0 * std::f64::consts::LN_2 / two_pi;
            let b = ln_gamma(v / 2.0) + ln_gamma(k / 2.0);
            let x = k * u / v;
            let tail = (1.0 + x).powf(-(v + k - 2.0) / 2.0);
            [
                f_sf(u, k, v),
                a.sqrt()
                    * (ln_gamma((v + k - 1.0) / 2.0) - b).exp()
                    * std::f64::consts::SQRT_2
                    * x.powf((k - 1.0) / 2.0)
                    * tail,
                a * (ln_gamma((v + k - 2.0) / 2.0) - b).exp()
                    * x.powf((k - 2.0) / 2.0)
                    * tail
                    * ((v - 1.0) * x - (k - 1.0)),
                a.powf(1.5)
                    * (ln_gamma((v + k - 3.0) / 2.0) - b).exp()
                    * std::f64::consts::FRAC_1_SQRT_2
                    * x.powf((k - 3.0) / 2.0)
                    * tail
                    * ((v - 1.0) * (v - 2.0) * x * x - (2.0 * v * k - v - k - 1.0) * x
                        + (k - 1.0) * (k - 2.0)),
            ]
        }
        FieldKind::T { df: v } => {
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

/// Cluster-extent model at one cluster-forming threshold.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ExtentModel {
    /// Expected number of clusters `Ec` (SPM's `<c>` before the extent term).
    pub expected_clusters: f64,
    /// Expected resels per cluster `Ek`.
    pub expected_resels_per_cluster: f64,
    beta: f64,
}

impl ExtentModel {
    /// `spm_P_RF(1, k, u, df, STAT, R, 1)` for `D = 3`; `resels` must have
    /// `R3 > 0`.
    pub fn new(kind: FieldKind, u: f64, resels: [f64; 4]) -> Self {
        let ec = ec_densities(kind, u).map(|d| d.max(f64::EPSILON));
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
    pub fn p_uncorrected(&self, k_resels: f64) -> f64 {
        if k_resels <= 0.0 {
            return 1.0;
        }
        (-self.beta * k_resels.powf(2.0 / 3.0)).exp()
    }

    /// FWE-corrected extent p: probability of one or more clusters of at
    /// least `k_resels` anywhere in the search volume.
    pub fn p_fwe(&self, k_resels: f64) -> f64 {
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

    /// Distribution tails against scipy.stats (`tests/fixtures/rft_reference.py`).
    #[test]
    fn tails_match_scipy() {
        close(normal_sf(3.1), 9.676032132183562e-04, 1e-12);
        close(normal_sf(2.3), 1.072411002167581e-02, 1e-12);
        close(t_sf(3.1, 20.0), 2.822438469562088e-03, 1e-10);
        close(t_sf(4.5, 12.0), 3.633264607018460e-04, 1e-10);
        close(t_sf(2.0, 5.0), 5.096973941492915e-02, 1e-10);
        close(1.0 - t_sf(-2.0, 5.0), 5.096973941492915e-02, 1e-10);
        close(f_sf(4.2, 3.0, 30.0), 1.354128416352148e-02, 1e-10);
        close(f_sf(2.5, 2.0, 40.0), 9.483082985705708e-02, 1e-10);
        close(f_sf(0.7, 5.0, 12.0), 6.339620939846790e-01, 1e-10);
    }

    /// `[P, p, Ec, Ek]` as `spm_P_RF(1, k, u, [1 df], STAT, R, 1)` returns
    /// them, from the independent implementation in
    /// `tests/fixtures/rft_reference.py`.
    #[test]
    fn extent_p_matches_independent_reference() {
        struct Case {
            kind: FieldKind,
            u: f64,
            resels: [f64; 4],
            k: f64,
            reference: [f64; 4],
        }
        let cases = [
            Case {
                kind: FieldKind::Z,
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
                kind: FieldKind::Z,
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
                kind: FieldKind::T { df: 20.0 },
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
                kind: FieldKind::T { df: 12.0 },
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
            Case {
                kind: FieldKind::F {
                    df1: 3.0,
                    df2: 30.0,
                },
                u: 9.0,
                resels: [1.0, 30.0, 300.0, 1000.0],
                k: 1.0,
                reference: [
                    9.103181996306109e-05,
                    1.389329804731445e-05,
                    6.552509224279161e+00,
                    3.554138969581392e-02,
                ],
            },
            Case {
                kind: FieldKind::F {
                    df1: 2.0,
                    df2: 40.0,
                },
                u: 6.0,
                resels: [1.0, 12.0, 80.0, 200.0],
                k: 0.5,
                reference: [
                    3.726124849010091e-01,
                    4.216086877885142e-02,
                    1.105743065439904e+01,
                    1.179738555157769e-01,
                ],
            },
        ];
        for case in cases {
            let model = ExtentModel::new(case.kind, case.u, case.resels);
            close(model.p_fwe(case.k), case.reference[0], 1e-9);
            close(model.p_uncorrected(case.k), case.reference[1], 1e-9);
            close(model.expected_clusters, case.reference[2], 1e-9);
            close(model.expected_resels_per_cluster, case.reference[3], 1e-9);
        }
    }

    #[test]
    fn larger_clusters_are_less_likely() {
        let model = ExtentModel::new(FieldKind::Z, 3.1, [1.0, 30.0, 300.0, 1000.0]);
        assert!(model.p_fwe(0.5) > model.p_fwe(2.0));
        assert!(model.p_fwe(2.0) > model.p_fwe(8.0));
        assert_eq!(model.p_uncorrected(0.0), 1.0);
    }
}
