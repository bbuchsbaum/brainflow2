//! Concrete frame extraction shared by desktop and browser hosts.

use bridge_types::{BridgeError, BridgeResult, VolumeSendable};
use nalgebra::{Affine3, Matrix4, Point3};
use std::borrow::Cow;
use volmath::NeuroSpaceExt;

/// Convert NeuroSpace's potentially 4D transform into its spatial affine.
pub fn affine_from_neurospace_trans(trans: &nalgebra::DMatrix<f64>) -> Affine3<f32> {
    if trans.nrows() < 4 || trans.ncols() < 4 {
        return Affine3::identity();
    }
    let translation = trans.ncols() - 1;
    Affine3::from_matrix_unchecked(Matrix4::new(
        trans[(0, 0)] as f32,
        trans[(0, 1)] as f32,
        trans[(0, 2)] as f32,
        trans[(0, translation)] as f32,
        trans[(1, 0)] as f32,
        trans[(1, 1)] as f32,
        trans[(1, 2)] as f32,
        trans[(1, translation)] as f32,
        trans[(2, 0)] as f32,
        trans[(2, 1)] as f32,
        trans[(2, 2)] as f32,
        trans[(2, translation)] as f32,
        0.0,
        0.0,
        0.0,
        1.0,
    ))
}

/// Spatial affine associated with a 3D or 4D sendable volume.
pub fn affine_from_volume(volume: &VolumeSendable) -> BridgeResult<Affine3<f32>> {
    match volume {
        VolumeSendable::VolF32(_, affine)
        | VolumeSendable::VolI16(_, affine)
        | VolumeSendable::VolU8(_, affine)
        | VolumeSendable::VolI8(_, affine)
        | VolumeSendable::VolU16(_, affine)
        | VolumeSendable::VolI32(_, affine)
        | VolumeSendable::VolU32(_, affine)
        | VolumeSendable::VolF64(_, affine) => Ok(*affine),
        VolumeSendable::Vec4DF32(vec) => Ok(affine_from_neurospace_trans(&vec.space.trans)),
        VolumeSendable::Vec4DI16(vec) => Ok(affine_from_neurospace_trans(&vec.space.trans)),
        VolumeSendable::Vec4DU8(vec) => Ok(affine_from_neurospace_trans(&vec.space.trans)),
        VolumeSendable::Vec4DI8(vec) => Ok(affine_from_neurospace_trans(&vec.space.trans)),
        VolumeSendable::Vec4DU16(vec) => Ok(affine_from_neurospace_trans(&vec.space.trans)),
        VolumeSendable::Vec4DI32(vec) => Ok(affine_from_neurospace_trans(&vec.space.trans)),
        VolumeSendable::Vec4DU32(vec) => Ok(affine_from_neurospace_trans(&vec.space.trans)),
        VolumeSendable::Vec4DF64(vec) => Ok(affine_from_neurospace_trans(&vec.space.trans)),
    }
}

/// First three dimensions, filling absent axes with one.
pub fn spatial_dims(volume: &VolumeSendable) -> [usize; 3] {
    let dims: &[usize] = match volume {
        VolumeSendable::VolF32(vol, _) => vol.space().dims(),
        VolumeSendable::VolI16(vol, _) => vol.space().dims(),
        VolumeSendable::VolU8(vol, _) => vol.space().dims(),
        VolumeSendable::VolI8(vol, _) => vol.space().dims(),
        VolumeSendable::VolU16(vol, _) => vol.space().dims(),
        VolumeSendable::VolI32(vol, _) => vol.space().dims(),
        VolumeSendable::VolU32(vol, _) => vol.space().dims(),
        VolumeSendable::VolF64(vol, _) => vol.space().dims(),
        VolumeSendable::Vec4DF32(vec) => &vec.space.dim,
        VolumeSendable::Vec4DF64(vec) => &vec.space.dim,
        VolumeSendable::Vec4DI16(vec) => &vec.space.dim,
        VolumeSendable::Vec4DI32(vec) => &vec.space.dim,
        VolumeSendable::Vec4DU8(vec) => &vec.space.dim,
        VolumeSendable::Vec4DU16(vec) => &vec.space.dim,
        VolumeSendable::Vec4DU32(vec) => &vec.space.dim,
        VolumeSendable::Vec4DI8(vec) => &vec.space.dim,
    };
    [
        dims.first().copied().unwrap_or(1),
        dims.get(1).copied().unwrap_or(1),
        dims.get(2).copied().unwrap_or(1),
    ]
}

/// Number of temporal frames, or `None` for a 3D volume.
pub fn frame_count(volume: &VolumeSendable) -> Option<usize> {
    macro_rules! frames {
        ($vec:expr) => {
            Some($vec.data.dim().3)
        };
    }
    match volume {
        VolumeSendable::Vec4DF32(vec) => frames!(vec),
        VolumeSendable::Vec4DF64(vec) => frames!(vec),
        VolumeSendable::Vec4DI16(vec) => frames!(vec),
        VolumeSendable::Vec4DI32(vec) => frames!(vec),
        VolumeSendable::Vec4DU8(vec) => frames!(vec),
        VolumeSendable::Vec4DU16(vec) => frames!(vec),
        VolumeSendable::Vec4DU32(vec) => frames!(vec),
        VolumeSendable::Vec4DI8(vec) => frames!(vec),
        _ => None,
    }
}

/// Reject an out-of-range 4D frame index instead of silently clamping it.
pub fn check_timepoint(timepoint: usize, frames: usize) -> BridgeResult<usize> {
    if timepoint < frames {
        Ok(timepoint)
    } else {
        Err(BridgeError::Input { code: 4071, details: format!(
            "Timepoint {timepoint} is out of range: the volume has {frames} frame(s) (valid 0..={})", frames.saturating_sub(1)) })
    }
}

/// One spatial frame in x-fastest NIfTI order.
pub struct Frame<'a> {
    pub values: Cow<'a, [f32]>,
    pub dims: [usize; 3],
    pub affine: Affine3<f32>,
    pub timepoint: Option<usize>,
}

impl Frame<'_> {
    pub fn index(&self, i: usize, j: usize, k: usize) -> usize {
        i + self.dims[0] * (j + self.dims[1] * k)
    }
    pub fn ijk(&self, index: usize) -> [usize; 3] {
        let i = index % self.dims[0];
        let rest = index / self.dims[0];
        [i, rest % self.dims[1], rest / self.dims[1]]
    }
    pub fn world(&self, ijk: [usize; 3]) -> [f32; 3] {
        let p =
            self.affine
                .transform_point(&Point3::new(ijk[0] as f32, ijk[1] as f32, ijk[2] as f32));
        [p.x, p.y, p.z]
    }
    pub fn voxel_volume_mm3(&self) -> f32 {
        self.affine
            .matrix()
            .fixed_view::<3, 3>(0, 0)
            .determinant()
            .abs()
    }
}

/// Extract a selected 4D frame or the sole 3D frame. A 3D timepoint argument
/// is intentionally ignored for compatibility with the desktop API.
pub fn extract_frame(volume: &VolumeSendable, timepoint: usize) -> BridgeResult<Frame<'_>> {
    let affine = affine_from_volume(volume)?;
    let dims = spatial_dims(volume);
    macro_rules! from_3d {
        ($vol:expr) => {
            (
                Cow::Owned(
                    $vol.values_contiguous()
                        .iter()
                        .map(|v| *v as f32)
                        .collect::<Vec<f32>>(),
                ),
                None,
            )
        };
    }
    macro_rules! from_4d {
        ($vec:expr) => {{
            check_timepoint(timepoint, $vec.data.dim().3)?;
            let mut values = Vec::with_capacity(dims.iter().product());
            for k in 0..dims[2] {
                for j in 0..dims[1] {
                    for i in 0..dims[0] {
                        values.push($vec.data[[i, j, k, timepoint]] as f32);
                    }
                }
            }
            (Cow::Owned(values), Some(timepoint))
        }};
    }
    let (values, frame_timepoint) = match volume {
        VolumeSendable::VolF32(vol, _) => (vol.values_contiguous(), None),
        VolumeSendable::VolF64(vol, _) => from_3d!(vol),
        VolumeSendable::VolI16(vol, _) => from_3d!(vol),
        VolumeSendable::VolI32(vol, _) => from_3d!(vol),
        VolumeSendable::VolU8(vol, _) => from_3d!(vol),
        VolumeSendable::VolU16(vol, _) => from_3d!(vol),
        VolumeSendable::VolU32(vol, _) => from_3d!(vol),
        VolumeSendable::VolI8(vol, _) => from_3d!(vol),
        VolumeSendable::Vec4DF32(vec) => from_4d!(vec),
        VolumeSendable::Vec4DF64(vec) => from_4d!(vec),
        VolumeSendable::Vec4DI16(vec) => from_4d!(vec),
        VolumeSendable::Vec4DI32(vec) => from_4d!(vec),
        VolumeSendable::Vec4DU8(vec) => from_4d!(vec),
        VolumeSendable::Vec4DU16(vec) => from_4d!(vec),
        VolumeSendable::Vec4DU32(vec) => from_4d!(vec),
        VolumeSendable::Vec4DI8(vec) => from_4d!(vec),
    };
    if values.len() != dims.iter().product::<usize>() {
        return Err(BridgeError::Internal {
            code: 5071,
            details: "Volume frame size does not match its spatial dimensions".into(),
        });
    }
    Ok(Frame {
        values,
        dims,
        affine,
        timepoint: frame_timepoint,
    })
}
