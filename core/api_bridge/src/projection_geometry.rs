//! Boundary to neurosurf's axis-aligned CPU projection volume.
use crate::VolumeProjectionData;
use bridge_types::{BridgeError, BridgeResult};

fn validate_axis_aligned_affine(m: &[f32]) -> BridgeResult<()> {
    let invalid = |details: &str| BridgeError::Input {
        code: 5061,
        details: details.into(),
    };
    if m.len() != 16 || m.iter().any(|v| !v.is_finite()) {
        return Err(invalid(
            "CPU projection requires a finite 4x4 volume affine.",
        ));
    }
    if m[3] != 0.0 || m[7] != 0.0 || m[11] != 0.0 || m[15] != 1.0 {
        return Err(invalid(
            "CPU projection requires an affine, not a projective transform.",
        ));
    }
    if [0, 5, 10].iter().any(|&i| m[i].abs() <= f32::EPSILON) {
        return Err(invalid("CPU projection cannot represent this volume geometry. Use full-affine GPU projection or resample to an axis-aligned grid."));
    }
    if [1, 2, 4, 6, 8, 9].iter().any(|&i| m[i] != 0.0) {
        return Err(invalid("CPU projection does not support rotated or sheared volumes. Use full-affine GPU projection or resample to an axis-aligned grid."));
    }
    Ok(())
}

/// Build a neurosurf `Volume3D` from an extracted projection payload.
///
/// brainflow's buffer is x-fastest (flat = x + nx*y + nx*ny*z), matching
/// Volume3D's linear convention, so the `Array3` is built in Fortran order with
/// shape (nx, ny, nz). Volume3D models an axis-aligned grid (signed diagonal
/// spacing + translation origin), which reproduces diagonal affines exactly (the
/// common case). Unsupported rotation/shear must fail before producing values.
pub(crate) fn build_volume3d_from_projection(
    vol: &VolumeProjectionData,
) -> BridgeResult<neurosurf_rs::analysis::Volume3D> {
    use ndarray::ShapeBuilder;
    validate_axis_aligned_affine(&vol.affine_matrix)?;
    let nx = vol.dims[0] as usize;
    let ny = vol.dims[1] as usize;
    let nz = vol.dims[2] as usize;
    let data_f64: Vec<f64> = vol.volume_data.iter().map(|&v| v as f64).collect();
    let arr = ndarray::Array3::from_shape_vec((nx, ny, nz).f(), data_f64).map_err(|e| {
        BridgeError::Internal {
            code: 5060,
            details: format!("Failed to build Volume3D array ({nx}x{ny}x{nz}): {e}"),
        }
    })?;
    // affine_matrix is column-major 4x4: m(row, col) = affine_matrix[col * 4 + row].
    let m = &vol.affine_matrix;
    let voxel_size = [m[0] as f64, m[5] as f64, m[10] as f64];
    let origin = [m[12] as f64, m[13] as f64, m[14] as f64];
    Ok(neurosurf_rs::analysis::Volume3D::from_arrays(
        arr, voxel_size, origin,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn affine() -> Vec<f32> {
        vec![
            -2., 0., 0., 0., 0., 3., 0., 0., 0., 0., 4., 0., 11., -7., 23., 1.,
        ]
    }

    #[test]
    fn accepts_signed_anisotropic_spacing_and_translation() {
        assert!(validate_axis_aligned_affine(&affine()).is_ok());
    }

    #[test]
    fn rejects_rotation_and_shear_before_sampling() {
        let mut rotated = affine();
        rotated[0] = 0.;
        rotated[1] = 2.;
        rotated[4] = -3.;
        rotated[5] = 0.;
        assert!(validate_axis_aligned_affine(&rotated).is_err());
        let mut shear = affine();
        shear[4] = 0.25;
        assert!(validate_axis_aligned_affine(&shear).is_err());
    }

    #[test]
    fn rejects_malformed_nonfinite_and_singular_geometry() {
        assert!(validate_axis_aligned_affine(&[]).is_err());
        for value in [f32::NAN, f32::INFINITY] {
            let mut m = affine();
            m[12] = value;
            assert!(validate_axis_aligned_affine(&m).is_err());
        }
        let mut m = affine();
        m[10] = 0.;
        assert!(validate_axis_aligned_affine(&m).is_err());
    }
}
