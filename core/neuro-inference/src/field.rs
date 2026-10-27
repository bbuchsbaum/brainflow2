//! Description of a thresholded statistic field.
use crate::error::{invalid, Result};

/// Distribution of the statistic under the null hypothesis.
#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(tag = "kind", rename_all = "lowercase"))]
pub enum FieldKind {
    /// Standard normal (Gaussian) field.
    Z,
    /// Student t field with `df` error degrees of freedom.
    T { df: f64 },
    /// F field with `df1` (effect) and `df2` (error) degrees of freedom.
    F { df1: f64, df2: f64 },
}

impl FieldKind {
    /// Check that the degrees of freedom are finite and positive.
    pub fn validate(&self) -> Result<()> {
        let ok = |d: f64| d.is_finite() && d > 0.0;
        match *self {
            FieldKind::Z => Ok(()),
            FieldKind::T { df } if ok(df) => Ok(()),
            FieldKind::F { df1, df2 } if ok(df1) && ok(df2) => Ok(()),
            _ => Err(invalid("degrees of freedom must be finite and > 0")),
        }
    }
}

/// A statistic image on a 3D voxel grid together with its search volume.
///
/// The mask is in x-fastest (column-major, NIfTI) order: voxel `(i, j, k)` is
/// `mask[i + nx * (j + ny * k)]`.
#[derive(Debug, Clone, Copy)]
pub struct StatField<'a> {
    pub kind: FieldKind,
    pub dims: [usize; 3],
    /// Voxel edge lengths in mm along the voxel axes.
    pub voxel_size_mm: [f64; 3],
    /// Voxels included in the search volume.
    pub search_mask: &'a [bool],
}

impl<'a> StatField<'a> {
    /// Validated constructor.
    pub fn new(
        kind: FieldKind,
        dims: [usize; 3],
        voxel_size_mm: [f64; 3],
        search_mask: &'a [bool],
    ) -> Result<Self> {
        kind.validate()?;
        if search_mask.len() != dims.iter().product::<usize>() {
            return Err(invalid(
                "search mask length does not match the grid dimensions",
            ));
        }
        if !voxel_size_mm.iter().all(|v| v.is_finite() && *v > 0.0) {
            return Err(invalid("voxel sizes must be finite and > 0"));
        }
        Ok(Self {
            kind,
            dims,
            voxel_size_mm,
            search_mask,
        })
    }

    /// Number of voxels in the search volume.
    pub fn search_voxels(&self) -> u64 {
        self.search_mask.iter().filter(|m| **m).count() as u64
    }
}
