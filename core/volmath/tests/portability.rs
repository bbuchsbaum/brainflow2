//! Identical analytic fixtures for native Rust and JavaScript-hosted WASM.
//! Run the WASM integration test with `--features web --test portability`.

use nalgebra::{DMatrix, Vector4};
use std::borrow::Cow;
use volmath::{DenseVolume3, NeuroSpace, NeuroSpaceExt};

fn fixture() -> DenseVolume3<f32> {
    // Non-cubic dimensions and x-fastest values expose axis/layout swaps.
    let data = (0..4)
        .flat_map(|z| (0..3).flat_map(move |y| (0..2).map(move |x| (x + 10 * y + 100 * z) as f32)))
        .collect();
    let affine = DMatrix::from_row_slice(
        4,
        4,
        &[
            0.0, -3.0, 0.0, 10.0, // world x = 10 - 3*y
            2.0, 0.0, 0.0, -20.0, // world y = -20 + 2*x
            0.0, 0.0, 4.0, 30.0, // world z = 30 + 4*z
            0.0, 0.0, 0.0, 1.0,
        ],
    );
    let space = NeuroSpace::new(vec![2, 3, 4], None, None, None, Some(affine)).unwrap();
    DenseVolume3::from_data(space, data)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn voxel_layout_and_bounds() {
    let volume = fixture();
    assert_eq!(volume.get_at_coords(&[1, 2, 3]), Some(321.0));
    assert_eq!(volume.get_at_coords(&[0, 1, 2]), Some(210.0));
    assert_eq!(volume.get_at_coords(&[2, 0, 0]), None);
    assert_eq!(volume.get_at_coords(&[0, 3, 0]), None);
    assert_eq!(volume.get_at_coords(&[0, 0, 4]), None);
    let values = volume.values_contiguous();
    assert!(matches!(values, Cow::Borrowed(_)));
    assert_eq!(&values[..6], &[0.0, 1.0, 10.0, 11.0, 20.0, 21.0]);
    assert_eq!(values[23], 321.0);
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn affine_maps_known_voxel_and_world_coordinates() {
    let volume = fixture();
    let world = volume.space().voxel_to_world() * Vector4::new(1.0, 2.0, 3.0, 1.0);
    assert_eq!(world, Vector4::new(4.0, -18.0, 42.0, 1.0));
    let voxel = volume.space().world_to_voxel() * Vector4::new(7.0, -18.0, 38.0, 1.0);
    // f32 matrix inversion may round; 1e-5 is well below one voxel here.
    assert!((voxel - Vector4::new(1.0, 1.0, 2.0, 1.0)).norm() < 1e-5);
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn resampling_linear_field_at_half_voxel() {
    let volume = fixture();
    let mut target = volume.space().clone();
    // Half a voxel along each source axis, expressed in world coordinates.
    target.trans[(0, 3)] -= 1.5;
    target.trans[(1, 3)] += 1.0;
    target.trans[(2, 3)] += 2.0;
    target.inverse = target.trans.clone().try_inverse();
    let result = volmath::resample::resample(volume.inner(), &target, Some(1)).unwrap();
    // f(x,y,z) = x + 10*y + 100*z, at (0.5, 1.5, 2.5).
    use volmath::NeuroVol;
    assert!((result.get_at(0, 1, 2).unwrap() - 265.5).abs() < 1e-4);
}

#[cfg(all(target_arch = "wasm32", feature = "web"))]
#[wasm_bindgen_test::wasm_bindgen_test]
fn javascript_host_entropy_is_available() {
    // Check availability, not statistical quality or a probabilistic bit pattern.
    getrandom::getrandom(&mut [0_u8; 32]).expect("JavaScript host entropy unavailable");
}
