//! Statistical inference for thresholded neuroimaging maps.
//!
//! The crate is plain Rust (only `libm`; `serde` behind the `serde` feature)
//! and independent of any viewer or file format. A caller describes a
//! statistic image as a [`StatField`] (field type, grid, voxel size, search
//! mask) and asks a method for p values:
//!
//! - **Cluster level** ([`ClusterInference`]): p values for suprathreshold
//!   clusters formed at one threshold. [`RftClusterExtent`] implements
//!   SPM's Gaussian random field cluster-extent test; permutation,
//!   TFCE and cluster-mass ids are reserved in [`ClusterMethodId`].
//! - **Voxel level** ([`VoxelThreshold`]): adjusted p values for a family of
//!   voxels. [`Bonferroni`] and [`BenjaminiHochberg`] are implemented;
//!   random-field peak FWE is reserved in [`VoxelMethodId`].
//!
//! Smoothness for random field methods is a [`Smoothness`]: a stationary FWHM
//! in mm or precomputed resel counts. A [`SmoothnessEstimator`] can supply one
//! later; none ships, because estimating smoothness from the statistic map
//! itself is biased.
//!
//! See `README.md` for the model, references and validation evidence.
pub mod cluster;
pub mod distributions;
pub mod error;
pub mod field;
pub mod resels;
pub mod rft;
pub mod smoothness;
pub mod voxel;

pub use cluster::{
    familywise_over_tails, ClusterExtent, ClusterInference, ClusterInferenceResult, ClusterMethod,
    ClusterMethodId, ClusterP, ClusterSearch, Diagnostics, MethodSummary, RftClusterExtent,
    RftDiagnostics, Tails, RFT_MIN_SMOOTH_FWHM_VOXELS,
};
pub use error::{InferenceError, Result};
pub use field::{FieldKind, StatField};
pub use smoothness::{ReselCounts, Smoothness, SmoothnessEstimator};
pub use voxel::{BenjaminiHochberg, Bonferroni, VoxelMethodId, VoxelThreshold};
