//! Validated native-grid and arbitrary oblique planes. Geometry is in world mm;
//! square display pixels never change the source grid or its affine.
use crate::{Error, Result, SliceGeometry, VolumeMetadata};
use nalgebra::{Vector3, Vector4};

fn invalid(message: &str) -> Error {
    Error::InvalidSliceSpec(message.into())
}
fn basis(right: [f32; 3], down: [f32; 3]) -> Result<(Vector3<f32>, Vector3<f32>)> {
    let u = Vector3::from(right);
    let v = Vector3::from(down);
    if !u.iter().chain(v.iter()).all(|v| v.is_finite()) || u.norm() <= f32::EPSILON {
        return Err(invalid("non-finite or zero plane basis"));
    }
    let u = u.normalize();
    let v = v - u * v.dot(&u);
    if v.norm() <= f32::EPSILON {
        return Err(invalid("parallel plane basis"));
    }
    Ok((u, v.normalize()))
}

/// Square-pixel plane through a chosen world centre. The right/down vectors
/// choose the orientation; no anatomical display reflection is inferred.
pub fn oblique_slice_geometry(
    center_mm: [f32; 3],
    right: [f32; 3],
    down: [f32; 3],
    extent_mm: [f32; 2],
    dim_px: [u32; 2],
) -> Result<SliceGeometry> {
    if dim_px.contains(&0)
        || !center_mm.iter().all(|v| v.is_finite())
        || extent_mm.iter().any(|v| !v.is_finite() || *v <= 0.0)
    {
        return Err(invalid("invalid plane centre, extent or raster"));
    }
    let (u, v) = basis(right, down)?;
    let pixel = (extent_mm[0] / dim_px[0] as f32).max(extent_mm[1] / dim_px[1] as f32);
    let origin = Vector3::from(center_mm)
        - u * (pixel * dim_px[0] as f32 * 0.5)
        - v * (pixel * dim_px[1] as f32 * 0.5);
    if !origin.iter().all(|v| v.is_finite()) || !pixel.is_finite() || pixel <= 0.0 {
        return Err(invalid("plane extent overflow"));
    }
    Ok(SliceGeometry {
        origin_mm: origin.into(),
        u_mm: (u * pixel).into(),
        v_mm: (v * pixel).into(),
        dim_px,
    })
}

/// A plane through one native voxel slice. The in-plane axes are the two other
/// affine columns in ascending order. Explicit flips select display orientation.
/// For a sheared affine, orthonormal display axes frame all four native slice
/// corners, preserving physical geometry and square pixels.
pub fn native_slice_geometry(
    meta: &VolumeMetadata,
    normal_axis: u8,
    slice_index: u32,
    dim_px: [u32; 2],
    flips: [bool; 2],
) -> Result<SliceGeometry> {
    let axis = usize::from(normal_axis);
    let affine = &meta.voxel_to_world;
    if axis >= 3 || meta.dimensions.contains(&0) || slice_index as usize >= meta.dimensions[axis] {
        return Err(invalid("native slice is outside the reference grid"));
    }
    if !affine.iter().all(|v| v.is_finite())
        || affine
            .row(3)
            .iter()
            .zip([0.0, 0.0, 0.0, 1.0])
            .any(|(a, b)| (*a - b).abs() > 1e-6)
        || affine.try_inverse().is_none()
    {
        return Err(invalid("invalid native-grid affine"));
    }
    let axes: Vec<usize> = (0..3).filter(|&a| a != axis).collect();
    let sign = |flip| if flip { -1.0 } else { 1.0 };
    let right = affine.fixed_view::<3, 1>(0, axes[0]).into_owned() * sign(flips[0]);
    let down = affine.fixed_view::<3, 1>(0, axes[1]).into_owned() * sign(flips[1]);
    let (u, v) = basis(right.into(), down.into())?;
    let mut center = Vector4::new(0.0, 0.0, 0.0, 1.0);
    for a in 0..3 {
        center[a] = if a == axis {
            slice_index as f32
        } else {
            (meta.dimensions[a] as f32 - 1.0) * 0.5
        };
    }
    let center_world = (affine * center).xyz();
    let mut extent = [0.0f32; 2];
    for a in [-0.5, meta.dimensions[axes[0]] as f32 - 0.5] {
        for b in [-0.5, meta.dimensions[axes[1]] as f32 - 0.5] {
            let mut point = center;
            point[axes[0]] = a;
            point[axes[1]] = b;
            let delta = (affine * point).xyz() - center_world;
            extent[0] = extent[0].max(2.0 * delta.dot(&u).abs());
            extent[1] = extent[1].max(2.0 * delta.dot(&v).abs());
        }
    }
    oblique_slice_geometry(center_world.into(), u.into(), v.into(), extent, dim_px)
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;
    use nalgebra::Matrix4;
    #[test]
    fn oblique_anisotropic_native_slice_retains_voxel_centres_and_no_reflection() {
        let meta = VolumeMetadata {
            dimensions: [5, 3, 7],
            voxel_to_world: Matrix4::new(
                0.4, 0.0, 0.0, 10.0, 0.0, 1.6, -0.24, -20.0, 0.0, 1.2, 0.32, 5.0, 0.0, 0.0, 0.0,
                1.0,
            ),
        };
        let plane = native_slice_geometry(&meta, 1, 1, [5, 7], [false; 2]).unwrap();
        for x in 0..5 {
            for z in 0..7 {
                let actual = crate::pixel_to_world_raw(
                    plane.origin_mm,
                    plane.u_mm,
                    plane.v_mm,
                    x as f32 + 0.5,
                    z as f32 + 0.5,
                );
                let expected = [
                    10.0 + x as f32 * 0.4,
                    -18.4 - z as f32 * 0.24,
                    6.2 + z as f32 * 0.32,
                ];
                for a in 0..3 {
                    assert_relative_eq!(actual[a], expected[a], epsilon = 3e-6);
                }
            }
        }
        assert_relative_eq!(Vector3::from(plane.u_mm).norm(), 0.4, epsilon = 1e-6);
        assert_relative_eq!(Vector3::from(plane.v_mm).norm(), 0.4, epsilon = 1e-6);
        let flipped = native_slice_geometry(&meta, 1, 1, [5, 7], [true, false]).unwrap();
        let point =
            crate::pixel_to_world_raw(flipped.origin_mm, flipped.u_mm, flipped.v_mm, 0.5, 0.5);
        assert_relative_eq!(point[0], 11.6, epsilon = 2e-6);
    }
    #[test]
    fn sheared_affine_uses_square_pixels_and_contains_the_native_slice_edges() {
        let meta = VolumeMetadata {
            dimensions: [5, 3, 7],
            voxel_to_world: Matrix4::new(
                -0.4, 0.0, 0.1, 10.0, 0.0, 2.0, 0.0, -20.0, 0.0, 0.0, 0.4, 5.0, 0.0, 0.0, 0.0, 1.0,
            ),
        };
        let p = native_slice_geometry(&meta, 1, 0, [120, 100], [false; 2]).unwrap();
        let u = Vector3::from(p.u_mm);
        let v = Vector3::from(p.v_mm);
        assert_relative_eq!(u.norm(), v.norm(), epsilon = 1e-6);
        assert_relative_eq!(u.dot(&v), 0.0, epsilon = 1e-6);
        for x in [-0.5, 4.5] {
            for z in [-0.5, 6.5] {
                let w = (meta.voxel_to_world * Vector4::new(x, 0.0, z, 1.0)).xyz()
                    - Vector3::from(p.origin_mm);
                let px = w.dot(&u) / u.norm_squared();
                let py = w.dot(&v) / v.norm_squared();
                assert!((-1e-4..=120.0001).contains(&px));
                assert!((-1e-4..=100.0001).contains(&py));
            }
        }
    }
    #[test]
    fn invalid_planes_are_errors() {
        let meta = VolumeMetadata {
            dimensions: [5; 3],
            voxel_to_world: Matrix4::identity(),
        };
        assert!(native_slice_geometry(&meta, 3, 0, [10; 2], [false; 2]).is_err());
        assert!(native_slice_geometry(&meta, 1, 5, [10; 2], [false; 2]).is_err());
        assert!(native_slice_geometry(&meta, 1, 0, [0; 2], [false; 2]).is_err());
        assert!(oblique_slice_geometry(
            [0.0; 3],
            [1.0, 0.0, 0.0],
            [2.0, 0.0, 0.0],
            [1.0; 2],
            [10; 2]
        )
        .is_err());
        assert!(oblique_slice_geometry(
            [f32::NAN; 3],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [1.0; 2],
            [10; 2]
        )
        .is_err());
        let singular = VolumeMetadata {
            voxel_to_world: Matrix4::zeros(),
            ..meta
        };
        assert!(native_slice_geometry(&singular, 1, 0, [10; 2], [false; 2]).is_err());
    }
}
