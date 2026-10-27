//! Voxel-level multiple-comparison corrections.
//!
//! A [`VoxelThreshold`] turns uncorrected voxel p values into adjusted p
//! values and a significance cut-off. Bonferroni and Benjamini–Hochberg FDR
//! are implemented; random-field peak FWE ([`VoxelMethodId::RftPeak`]) is
//! reserved.
use crate::error::{invalid, Result};
use std::fmt;
use std::str::FromStr;

/// Stable identifiers for voxel-level methods.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum VoxelMethodId {
    /// `"bonferroni"`: family-wise error by Bonferroni.
    Bonferroni,
    /// `"fdr-bh"`: false discovery rate by Benjamini & Hochberg (1995).
    FdrBh,
    /// `"rft-peak"`: random-field peak-height FWE. Reserved, not implemented.
    RftPeak,
}

impl VoxelMethodId {
    pub const ALL: [VoxelMethodId; 3] = [Self::Bonferroni, Self::FdrBh, Self::RftPeak];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Bonferroni => "bonferroni",
            Self::FdrBh => "fdr-bh",
            Self::RftPeak => "rft-peak",
        }
    }

    pub fn is_implemented(self) -> bool {
        !matches!(self, Self::RftPeak)
    }
}

impl fmt::Display for VoxelMethodId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for VoxelMethodId {
    type Err = crate::InferenceError;
    fn from_str(s: &str) -> Result<Self> {
        Self::ALL
            .into_iter()
            .find(|m| m.as_str() == s)
            .ok_or_else(|| invalid(format!("unknown voxel method {s:?}")))
    }
}

/// A voxel-level correction over a family of p values.
pub trait VoxelThreshold {
    fn method(&self) -> VoxelMethodId;

    /// Adjusted p values in input order. Every input must be in `[0, 1]`.
    fn adjust(&self, p_values: &[f64]) -> Result<Vec<f64>>;

    /// Largest uncorrected p value declared significant at level `alpha`
    /// (reject `p <= cut-off`), or `None` when nothing survives.
    fn p_threshold(&self, p_values: &[f64], alpha: f64) -> Result<Option<f64>> {
        check_alpha(alpha)?;
        let adjusted = self.adjust(p_values)?;
        Ok(p_values
            .iter()
            .zip(adjusted)
            .filter(|(_, q)| *q <= alpha)
            .map(|(p, _)| *p)
            .fold(None, |best: Option<f64>, p| {
                Some(best.map_or(p, |b| b.max(p)))
            }))
    }
}

fn check_alpha(alpha: f64) -> Result<()> {
    if alpha.is_finite() && alpha > 0.0 && alpha < 1.0 {
        Ok(())
    } else {
        Err(invalid("alpha must be in (0, 1)"))
    }
}

fn check_p(p_values: &[f64]) -> Result<()> {
    if p_values.iter().all(|p| (0.0..=1.0).contains(p)) {
        Ok(())
    } else {
        Err(invalid("p values must be finite and in [0, 1]"))
    }
}

/// Bonferroni: `min(1, m · p)`.
#[derive(Debug, Clone, Copy, Default)]
pub struct Bonferroni;

impl VoxelThreshold for Bonferroni {
    fn method(&self) -> VoxelMethodId {
        VoxelMethodId::Bonferroni
    }

    fn adjust(&self, p_values: &[f64]) -> Result<Vec<f64>> {
        check_p(p_values)?;
        let m = p_values.len() as f64;
        Ok(p_values.iter().map(|p| (p * m).min(1.0)).collect())
    }
}

/// Benjamini–Hochberg step-up FDR (as R's `p.adjust(p, "BH")`), valid under
/// independence or positive dependence.
#[derive(Debug, Clone, Copy, Default)]
pub struct BenjaminiHochberg;

impl VoxelThreshold for BenjaminiHochberg {
    fn method(&self) -> VoxelMethodId {
        VoxelMethodId::FdrBh
    }

    fn adjust(&self, p_values: &[f64]) -> Result<Vec<f64>> {
        check_p(p_values)?;
        let m = p_values.len();
        let mut order: Vec<usize> = (0..m).collect();
        order.sort_by(|&a, &b| p_values[a].total_cmp(&p_values[b]));
        let mut adjusted = vec![0.0; m];
        let mut running = 1.0f64;
        for rank in (0..m).rev() {
            let index = order[rank];
            running = running.min(p_values[index] * m as f64 / (rank + 1) as f64);
            adjusted[index] = running.min(1.0);
        }
        Ok(adjusted)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_all_close(actual: &[f64], expected: &[f64]) {
        assert_eq!(actual.len(), expected.len());
        for (a, e) in actual.iter().zip(expected) {
            assert!((a - e).abs() < 1e-12, "{actual:?} vs {expected:?}");
        }
    }

    /// Expected values from R 4: `p.adjust(p, "BH")` / `p.adjust(p, "bonferroni")`.
    #[test]
    fn matches_r_p_adjust() {
        let p = [
            0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205, 0.212, 0.216,
        ];
        let bh = BenjaminiHochberg.adjust(&p).unwrap();
        assert_all_close(
            &bh,
            &[
                0.01,
                0.04,
                0.084,
                0.084,
                0.084,
                0.1,
                0.1057142857142857,
                0.216,
                0.216,
                0.216,
            ],
        );
        // Unsorted input keeps its order.
        let q = [0.04, 0.01, 0.03, 0.5, 0.02];
        assert_all_close(
            &BenjaminiHochberg.adjust(&q).unwrap(),
            &[0.05, 0.05, 0.05, 0.5, 0.05],
        );
        assert_all_close(
            &Bonferroni.adjust(&q).unwrap(),
            &[0.2, 0.05, 0.15, 1.0, 0.1],
        );
    }

    #[test]
    fn thresholds_and_validation() {
        let q = [0.04, 0.01, 0.03, 0.5, 0.02];
        assert_eq!(BenjaminiHochberg.p_threshold(&q, 0.05).unwrap(), Some(0.04));
        assert_eq!(Bonferroni.p_threshold(&q, 0.05).unwrap(), Some(0.01));
        assert_eq!(Bonferroni.p_threshold(&q, 0.01).unwrap(), None);
        assert!(Bonferroni.adjust(&[0.2, f64::NAN]).is_err());
        assert!(BenjaminiHochberg.adjust(&[1.5]).is_err());
        assert!(BenjaminiHochberg.p_threshold(&q, 0.0).is_err());
        assert!(BenjaminiHochberg.adjust(&[]).unwrap().is_empty());
    }

    #[test]
    fn method_ids_round_trip() {
        for id in VoxelMethodId::ALL {
            assert_eq!(id.as_str().parse::<VoxelMethodId>().unwrap(), id);
        }
        assert!(!VoxelMethodId::RftPeak.is_implemented());
        assert!("holm".parse::<VoxelMethodId>().is_err());
    }
}
