//! Spatial smoothness of a statistic field, as random field methods need it.
use crate::error::{invalid, InferenceError, Result};
use crate::field::StatField;
use crate::resels::lattice_resels;

/// Resel counts `[R0, R1, R2, R3]` of a search volume plus the resel size of
/// one voxel.
#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ReselCounts {
    pub counts: [f64; 4],
    /// Resels per voxel: `Π (voxel size / FWHM)` over the three axes.
    pub resels_per_voxel: f64,
}

/// How smooth the field is. Supplied by the caller today; an estimator can
/// produce one through [`SmoothnessEstimator`].
#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum Smoothness {
    /// Stationary FWHM in mm along the voxel axes.
    FwhmMm([f64; 3]),
    /// Precomputed resel counts (for example from an analysis package).
    Resels(ReselCounts),
}

impl Smoothness {
    pub fn isotropic_fwhm_mm(fwhm: f64) -> Self {
        Smoothness::FwhmMm([fwhm; 3])
    }

    fn check(&self) -> Result<()> {
        let ok = match self {
            Smoothness::FwhmMm(f) => f.iter().all(|v| v.is_finite() && *v > 0.0),
            Smoothness::Resels(r) => {
                r.counts.iter().all(|v| v.is_finite())
                    && r.resels_per_voxel.is_finite()
                    && r.resels_per_voxel > 0.0
            }
        };
        if ok {
            Ok(())
        } else {
            Err(invalid("smoothness must be finite and > 0"))
        }
    }

    /// FWHM in voxels per axis, when the smoothness is given as an FWHM.
    pub fn fwhm_voxels(&self, field: &StatField) -> Option<[f64; 3]> {
        match self {
            Smoothness::FwhmMm(f) => Some([0, 1, 2].map(|a| f[a] / field.voxel_size_mm[a])),
            Smoothness::Resels(_) => None,
        }
    }

    /// Resel counts of `field`'s search volume.
    pub fn resel_counts(&self, field: &StatField) -> Result<ReselCounts> {
        self.check()?;
        let counts = match self {
            Smoothness::Resels(r) => *r,
            Smoothness::FwhmMm(f) => {
                let voxel_fwhm = [0, 1, 2].map(|a| field.voxel_size_mm[a] / f[a]);
                ReselCounts {
                    counts: lattice_resels(field.search_mask, field.dims, voxel_fwhm),
                    resels_per_voxel: voxel_fwhm.iter().product(),
                }
            }
        };
        if counts.counts[3] <= 0.0 {
            return Err(InferenceError::EmptySearchVolume(
                "no resel volume (needs at least one 2x2x2 block of search voxels)".into(),
            ));
        }
        Ok(counts)
    }

    /// Short human description, e.g. "8 mm FWHM" or "6 x 6 x 8 mm FWHM".
    pub fn describe(&self) -> String {
        match self {
            Smoothness::FwhmMm([x, y, z]) if x == y && y == z => format!("{x} mm FWHM"),
            Smoothness::FwhmMm([x, y, z]) => format!("{x} x {y} x {z} mm FWHM"),
            Smoothness::Resels(r) => format!("supplied resel counts {:?}", r.counts),
        }
    }
}

/// Estimates smoothness from data (for example residual images). No
/// implementation ships: estimating FWHM from the statistic map itself is
/// biased, and residuals are not available to a viewer.
pub trait SmoothnessEstimator {
    fn estimate(&self, field: &StatField) -> Result<Smoothness>;
}
