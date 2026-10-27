//! Cluster-level inference: p values for suprathreshold clusters.
//!
//! A method implements [`ClusterInference`]: given the field, the clusters
//! formed at one threshold and that threshold, it returns a p value per
//! cluster plus a [`MethodSummary`] (assumptions, parameters, diagnostics).
//! Methods are addressed by a stable string id ([`ClusterMethodId`]), so a
//! request can carry `{ method: "rft-extent", ... }` and new methods plug in
//! without changing callers.
//!
//! Implemented: [`RftClusterExtent`] (`"rft-extent"`). Reserved ids, not
//! implemented, because they need data a single statistic image lacks:
//! - `"permutation-max-cluster"`: max-cluster-size null from sign flips or
//!   permutations of subject-level images;
//! - `"tfce"`: threshold-free cluster enhancement with a permutation null;
//! - `"cluster-mass"`: cluster mass (sum of suprathreshold height) with a
//!   permutation null.
//!
//! To add a method: implement [`ClusterInference`], add an id to
//! [`ClusterMethodId`] and a variant to [`ClusterMethod`].
use crate::error::{invalid, InferenceError, Result};
use crate::field::{FieldKind, StatField};
use crate::rft::ExtentModel;
use crate::smoothness::Smoothness;
use std::fmt;
use std::str::FromStr;

/// One suprathreshold cluster as a method sees it.
#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[non_exhaustive]
pub struct ClusterExtent {
    pub voxel_count: u64,
}

impl ClusterExtent {
    pub fn new(voxel_count: u64) -> Self {
        Self { voxel_count }
    }
}

/// p values for one cluster, in input order.
#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ClusterP {
    /// Family-wise-error corrected p over the search volume.
    pub p_corrected: f64,
    /// Uncorrected p for a single cluster, when the method defines one.
    pub p_uncorrected: Option<f64>,
}

/// Which tails of the statistic were searched for clusters.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "lowercase"))]
pub enum Tails {
    /// One sign only (positive, or negative clusters of a symmetric field).
    One,
    /// Positive and negative clusters of a symmetric (Z or T) field.
    Two,
}

impl Tails {
    pub fn count(self) -> u8 {
        match self {
            Tails::One => 1,
            Tails::Two => 2,
        }
    }
}

/// Family-wise p over the searched tails from a one-tail family-wise p:
/// `1 - (1 - p)^tails` (Šidák; the tails of a symmetric field are treated as
/// independent searches). For random field theory, where
/// `p = 1 - exp(-E[m] · P(n ≥ k))`, this equals `1 - exp(-tails · E[m] ·
/// P(n ≥ k))`: the expected cluster count doubles when both tails are searched.
/// Every cluster method applies this convention.
pub fn familywise_over_tails(p_one_tail: f64, tails: Tails) -> f64 {
    1.0 - (1.0 - p_one_tail).powi(i32::from(tails.count()))
}

/// How clusters were formed: the threshold and the tails searched.
#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ClusterSearch {
    /// Cluster-forming threshold (absolute; `v > u` and, for two tails, `v < -u`).
    pub forming_threshold: f64,
    pub tails: Tails,
}

impl ClusterSearch {
    pub fn one_tailed(forming_threshold: f64) -> Self {
        Self {
            forming_threshold,
            tails: Tails::One,
        }
    }

    pub fn two_tailed(forming_threshold: f64) -> Self {
        Self {
            forming_threshold,
            tails: Tails::Two,
        }
    }
}

/// Random-field diagnostics of [`RftClusterExtent`].
#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct RftDiagnostics {
    pub search_voxels: u64,
    /// `[R0, R1, R2, R3]` of the search volume.
    pub resels: [f64; 4],
    pub resels_per_voxel: f64,
    /// FWHM in voxels per axis (when smoothness was given as an FWHM).
    pub fwhm_voxels: Option<[f64; 3]>,
    /// Expected number of clusters per tail at the forming threshold (`E[m]`);
    /// with two tails the family-wise expectation is twice this.
    pub expected_clusters: f64,
    /// Expected voxels per cluster at the forming threshold.
    pub expected_voxels_per_cluster: f64,
}

/// Method-specific diagnostics.
#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[non_exhaustive]
pub enum Diagnostics {
    Rft(RftDiagnostics),
}

/// What a method did and under which assumptions.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct MethodSummary {
    pub method: ClusterMethodId,
    pub field: FieldKind,
    pub forming_threshold: f64,
    /// Tails searched; `p_corrected` is family-wise over these tails.
    pub tails: Tails,
    /// Human-readable assumptions; every p value depends on them.
    pub assumptions: Vec<String>,
    pub diagnostics: Diagnostics,
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ClusterInferenceResult {
    pub clusters: Vec<ClusterP>,
    pub summary: MethodSummary,
}

/// A cluster-level inference method.
pub trait ClusterInference {
    fn method(&self) -> ClusterMethodId;

    /// p values for `clusters`, all formed by `search` on `field`. With two
    /// tails, `p_corrected` is family-wise over both tails
    /// ([`familywise_over_tails`]); uncorrected p stays per cluster.
    fn infer(
        &self,
        field: &StatField,
        clusters: &[ClusterExtent],
        search: &ClusterSearch,
    ) -> Result<ClusterInferenceResult>;
}

/// Stable identifiers for cluster-level methods.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum ClusterMethodId {
    /// `"rft-extent"`: Gaussian random field cluster extent (SPM).
    #[cfg_attr(feature = "serde", serde(rename = "rft-extent"))]
    RftExtent,
    /// `"permutation-max-cluster"`: reserved.
    #[cfg_attr(feature = "serde", serde(rename = "permutation-max-cluster"))]
    PermutationMaxCluster,
    /// `"tfce"`: reserved.
    #[cfg_attr(feature = "serde", serde(rename = "tfce"))]
    Tfce,
    /// `"cluster-mass"`: reserved.
    #[cfg_attr(feature = "serde", serde(rename = "cluster-mass"))]
    ClusterMass,
}

impl ClusterMethodId {
    pub const ALL: [ClusterMethodId; 4] = [
        Self::RftExtent,
        Self::PermutationMaxCluster,
        Self::Tfce,
        Self::ClusterMass,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::RftExtent => "rft-extent",
            Self::PermutationMaxCluster => "permutation-max-cluster",
            Self::Tfce => "tfce",
            Self::ClusterMass => "cluster-mass",
        }
    }

    pub fn is_implemented(self) -> bool {
        matches!(self, Self::RftExtent)
    }
}

impl fmt::Display for ClusterMethodId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for ClusterMethodId {
    type Err = InferenceError;
    fn from_str(s: &str) -> Result<Self> {
        Self::ALL
            .into_iter()
            .find(|m| m.as_str() == s)
            .ok_or_else(|| invalid(format!("unknown cluster method {s:?}")))
    }
}

/// A configured cluster method (closed set; dispatches [`ClusterInference`]).
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub enum ClusterMethod {
    RftExtent(RftClusterExtent),
}

impl ClusterInference for ClusterMethod {
    fn method(&self) -> ClusterMethodId {
        match self {
            ClusterMethod::RftExtent(m) => m.method(),
        }
    }

    fn infer(
        &self,
        field: &StatField,
        clusters: &[ClusterExtent],
        search: &ClusterSearch,
    ) -> Result<ClusterInferenceResult> {
        match self {
            ClusterMethod::RftExtent(m) => m.infer(field, clusters, search),
        }
    }
}

/// Below this FWHM (in voxels, on any axis) the lattice is too coarse for the
/// continuous-field theory.
pub const RFT_MIN_SMOOTH_FWHM_VOXELS: f64 = 3.0;

/// Cluster-extent p values from Gaussian random field theory, as SPM's
/// `spm_P_RF(1, k, u, df, STAT, R, 1)` (Friston et al. 1994; Worsley et al.
/// 1996). Smoothness is taken as given and assumed stationary.
#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct RftClusterExtent {
    pub smoothness: Smoothness,
}

impl RftClusterExtent {
    pub fn new(smoothness: Smoothness) -> Self {
        Self { smoothness }
    }

    fn assumptions(
        &self,
        fwhm_voxels: Option<[f64; 3]>,
        search: &ClusterSearch,
        diagnostics: &RftDiagnostics,
    ) -> Vec<String> {
        let tails = match search.tails {
            Tails::One => "One tail searched; p(FWE) covers that tail.".to_string(),
            Tails::Two => "Both tails searched; p(FWE) is corrected over both tails \
                           (1 - (1 - p)^2, i.e. twice the expected cluster count)."
                .to_string(),
        };
        let search_volume = format!(
            "Search volume: {} voxels, {:.1} resels; {:.2} clusters expected per tail.",
            diagnostics.search_voxels, diagnostics.resels[3], diagnostics.expected_clusters
        );
        let mut out = vec![
            format!(
                "Assumes stationary smoothness of {} (user-supplied).",
                self.smoothness.describe()
            ),
            "Gaussian random field theory (SPM spm_P_RF); approximate unless the \
             cluster-forming threshold is high (e.g. z >= 3.1) and the image is smooth \
             relative to the voxel size."
                .to_string(),
            tails,
            search_volume,
        ];
        if let Some(fwhm) = fwhm_voxels {
            let min = fwhm.iter().copied().fold(f64::INFINITY, f64::min);
            if min < RFT_MIN_SMOOTH_FWHM_VOXELS {
                out.push(format!(
                    "Smoothness is only {min:.1} voxels FWHM: p values are likely conservative \
                     and unstable (RFT assumes smooth fields)."
                ));
            }
        }
        out
    }
}

impl ClusterInference for RftClusterExtent {
    fn method(&self) -> ClusterMethodId {
        ClusterMethodId::RftExtent
    }

    fn infer(
        &self,
        field: &StatField,
        clusters: &[ClusterExtent],
        search: &ClusterSearch,
    ) -> Result<ClusterInferenceResult> {
        field.kind.validate()?;
        let forming_threshold = search.forming_threshold;
        if search.tails == Tails::Two && matches!(field.kind, FieldKind::F { .. }) {
            return Err(invalid(
                "F fields are one-tailed; search positive clusters only",
            ));
        }
        if !forming_threshold.is_finite() || forming_threshold <= 0.0 {
            return Err(invalid(
                "the cluster-forming threshold must be finite and > 0",
            ));
        }
        let resels = self.smoothness.resel_counts(field)?;
        let model = ExtentModel::new(field.kind, forming_threshold, resels.counts);
        let clusters = clusters
            .iter()
            .map(|c| {
                let k = c.voxel_count as f64 * resels.resels_per_voxel;
                ClusterP {
                    p_corrected: familywise_over_tails(model.p_fwe(k), search.tails),
                    p_uncorrected: Some(model.p_uncorrected(k)),
                }
            })
            .collect();
        let fwhm_voxels = self.smoothness.fwhm_voxels(field);
        let diagnostics = RftDiagnostics {
            search_voxels: field.search_voxels(),
            resels: resels.counts,
            resels_per_voxel: resels.resels_per_voxel,
            fwhm_voxels,
            expected_clusters: model.expected_clusters,
            expected_voxels_per_cluster: model.expected_resels_per_cluster
                / resels.resels_per_voxel,
        };
        Ok(ClusterInferenceResult {
            clusters,
            summary: MethodSummary {
                method: self.method(),
                field: field.kind,
                forming_threshold,
                tails: search.tails,
                assumptions: self.assumptions(fwhm_voxels, search, &diagnostics),
                diagnostics: Diagnostics::Rft(diagnostics),
            },
        })
    }
}

#[cfg(test)]
// Reference values are pasted with full printed precision.
#[allow(clippy::excessive_precision)]
mod tests {
    use super::*;
    use crate::smoothness::ReselCounts;

    fn close(actual: f64, expected: f64) {
        assert!(
            ((actual - expected) / expected).abs() < 1e-9,
            "{actual:e} vs {expected:e}"
        );
    }

    fn one(u: f64) -> ClusterSearch {
        ClusterSearch::one_tailed(u)
    }

    fn rft(fwhm: f64) -> RftClusterExtent {
        RftClusterExtent::new(Smoothness::isotropic_fwhm_mm(fwhm))
    }

    /// 20^3 voxels of 2 mm, FWHM 4 mm: R = [1, 28.5, 270.75, 857.375] and
    /// 0.125 resels per voxel. Values from `tests/fixtures/rft_reference.py`
    /// (`p_rf`) at u = 3.1 for clusters of 27 and 8 voxels.
    #[test]
    fn rft_extent_matches_independent_reference() {
        let mask = vec![true; 8000];
        let field = StatField::new(FieldKind::Z, [20; 3], [2.0; 3], &mask).unwrap();
        let clusters = [ClusterExtent::new(27), ClusterExtent::new(8)];
        let result = rft(4.0).infer(&field, &clusters, &one(3.1)).unwrap();
        close(result.clusters[0].p_corrected, 9.833494450128821e-05);
        close(
            result.clusters[0].p_uncorrected.unwrap(),
            1.178888417124667e-05,
        );
        close(result.clusters[1].p_corrected, 5.238046330599067e-02);
        let Diagnostics::Rft(d) = result.summary.diagnostics;
        assert_eq!(d.resels, [1.0, 28.5, 270.75, 857.375]);
        assert_eq!((d.resels_per_voxel, d.search_voxels), (0.125, 8000));
        assert_eq!(d.fwhm_voxels, Some([2.0; 3]));
        close(d.expected_clusters, 8.341737714144005e+00);
        close(d.expected_voxels_per_cluster, 9.388596643591203e-01);
        assert_eq!(result.summary.method, ClusterMethodId::RftExtent);
        // 2 voxels FWHM: the low-smoothness caveat is attached.
        assert!(result.summary.assumptions[0].contains("4 mm FWHM (user-supplied)"));
        assert!(result.summary.assumptions[4].contains("only 2.0 voxels FWHM"));
        assert!(result.summary.assumptions[2].starts_with("One tail searched"));
        assert!(result.summary.assumptions[3]
            .contains("8000 voxels, 857.4 resels; 8.34 clusters expected per tail"));
        // Smooth enough: no caveat.
        let smooth = rft(8.0).infer(&field, &clusters, &one(3.1)).unwrap();
        assert_eq!(smooth.summary.assumptions.len(), 4);
    }

    #[test]
    fn supplied_resels_match_fwhm_route() {
        let mask = vec![true; 8000];
        let field = StatField::new(FieldKind::T { df: 20.0 }, [20; 3], [2.0; 3], &mask).unwrap();
        let clusters = [ClusterExtent::new(27)];
        let via_fwhm = rft(4.0).infer(&field, &clusters, &one(3.1)).unwrap();
        let via_resels = RftClusterExtent::new(Smoothness::Resels(ReselCounts {
            counts: [1.0, 28.5, 270.75, 857.375],
            resels_per_voxel: 0.125,
        }))
        .infer(&field, &clusters, &one(3.1))
        .unwrap();
        assert_eq!(via_fwhm.clusters, via_resels.clusters);
        // Reference for t(20) at u = 3.1, k = 27 voxels.
        close(via_fwhm.clusters[0].p_corrected, 4.000056752607728e-04);
    }

    #[test]
    fn rejects_bad_inputs() {
        let mask = vec![true; 8000];
        let field = StatField::new(FieldKind::Z, [20; 3], [2.0; 3], &mask).unwrap();
        let c = [ClusterExtent::new(8)];
        assert!(rft(4.0).infer(&field, &c, &one(0.0)).is_err());
        assert!(rft(0.0).infer(&field, &c, &one(3.1)).is_err());
        let empty = vec![false; 8000];
        let none = StatField::new(FieldKind::Z, [20; 3], [2.0; 3], &empty).unwrap();
        assert!(matches!(
            rft(4.0).infer(&none, &c, &one(3.1)),
            Err(InferenceError::EmptySearchVolume(_))
        ));
        assert!(StatField::new(FieldKind::T { df: 0.0 }, [20; 3], [2.0; 3], &mask).is_err());
        assert!(StatField::new(FieldKind::Z, [20; 3], [2.0; 3], &mask[..10]).is_err());
    }

    #[test]
    fn registry_ids_round_trip_and_dispatch() {
        for id in ClusterMethodId::ALL {
            assert_eq!(id.as_str().parse::<ClusterMethodId>().unwrap(), id);
        }
        assert!(ClusterMethodId::RftExtent.is_implemented());
        assert!(!ClusterMethodId::Tfce.is_implemented());
        assert!("spm".parse::<ClusterMethodId>().is_err());
        let method = ClusterMethod::RftExtent(rft(8.0));
        assert_eq!(method.method(), ClusterMethodId::RftExtent);
        let mask = vec![true; 8000];
        let field = StatField::new(FieldKind::Z, [20; 3], [2.0; 3], &mask).unwrap();
        let direct = rft(8.0)
            .infer(&field, &[ClusterExtent::new(5)], &one(3.1))
            .unwrap();
        let dispatched = method
            .infer(&field, &[ClusterExtent::new(5)], &one(3.1))
            .unwrap();
        assert_eq!(direct, dispatched);
    }

    #[test]
    fn two_tails_apply_sidak_to_the_familywise_p_only() {
        let mask = vec![true; 8000];
        let field = StatField::new(FieldKind::Z, [20; 3], [2.0; 3], &mask).unwrap();
        let clusters = [ClusterExtent::new(27), ClusterExtent::new(8)];
        let one = rft(4.0).infer(&field, &clusters, &one(3.1)).unwrap();
        let two = rft(4.0)
            .infer(&field, &clusters, &ClusterSearch::two_tailed(3.1))
            .unwrap();
        for (a, b) in one.clusters.iter().zip(&two.clusters) {
            close(b.p_corrected, 1.0 - (1.0 - a.p_corrected).powi(2));
            // Uncorrected extent p is per cluster and per sign: unchanged.
            assert_eq!(a.p_uncorrected, b.p_uncorrected);
        }
        // Reference: rft_reference.py p_rf values (Ec, p) for 8 voxels, with Ec doubled:
        // 1 - exp(-2 * 8.341737714144005 * 6.449758039338495e-3).
        close(two.clusters[1].p_corrected, 1.020172136758312e-01);
        // Equivalent to doubling E[m] in the Poisson clumping step.
        let ec = 8.341737714144005_f64;
        let p_unc = two.clusters[0].p_uncorrected.unwrap();
        close(
            two.clusters[0].p_corrected,
            1.0 - (-(2.0 * ec) * p_unc).exp(),
        );
        assert_eq!(
            (one.summary.tails, two.summary.tails),
            (Tails::One, Tails::Two)
        );
        assert!(two.summary.assumptions[2].starts_with("Both tails searched"));
        // E[m] stays per tail.
        assert_eq!(one.summary.diagnostics, two.summary.diagnostics);
    }

    #[test]
    fn f_fields_reject_two_tails_and_helper_is_identity_for_one() {
        let mask = vec![true; 8000];
        let f = StatField::new(
            FieldKind::F {
                df1: 2.0,
                df2: 30.0,
            },
            [20; 3],
            [2.0; 3],
            &mask,
        )
        .unwrap();
        assert!(rft(4.0)
            .infer(
                &f,
                &[ClusterExtent::new(8)],
                &ClusterSearch::two_tailed(6.0)
            )
            .is_err());
        close(familywise_over_tails(0.3, Tails::One), 0.3);
        close(familywise_over_tails(0.3, Tails::Two), 0.51);
        assert_eq!((Tails::One.count(), Tails::Two.count()), (1, 2));
    }
}
