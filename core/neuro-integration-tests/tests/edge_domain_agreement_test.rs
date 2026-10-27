//! GPU slice sampling and the CPU samplers must share the voxel-centre domain
//! [-0.5, dim - 0.5): the same pixels are covered at the volume edges and the
//! sampled values agree, for nearest and linear interpolation. Requires a GPU.

use neuro_core::{TestVolume, Volume};
use neuro_cpu::interpolation::{sample_nearest, sample_trilinear};
use neuro_types::{
    CompositeRequest, InterpolationMethod, LayerSpec, LayerVisual, SliceSpec, VolumeHandle,
};
use render_loop::RenderLoopService;
use volmath::{DenseVolume3, NeuroSpace, NeuroSpaceExt};

const DIM: usize = 8;
const PIXELS: u32 = 100;
const STEP_MM: f32 = 0.1;
const ORIGIN_X: f32 = -1.0;
const ROW: [f32; 2] = [2.0, 3.0];
const DISPLAY_MAX: f32 = 80.0;

fn value(x: usize) -> f32 {
    (x + 1) as f32 * 10.0
}

/// World x of pixel k's centre: the GPU samples at origin + (k + 0.5) * u.
fn pixel_centre_x(k: u32) -> f32 {
    ORIGIN_X + (k as f32 + 0.5) * STEP_MM
}

fn gray(v: f32) -> i16 {
    (v / DISPLAY_MAX * 255.0).round() as i16
}

#[tokio::test]
async fn gpu_and_cpu_cover_the_same_edge_pixels_with_matching_values() {
    let mut service = RenderLoopService::new().await.expect("real GPU required");
    service.load_shaders().unwrap();

    let space =
        NeuroSpace::from_dims_spacing_origin(vec![DIM; 3], vec![1.0; 3], vec![0.0; 3]).unwrap();
    let data: Vec<f32> = (0..DIM * DIM * DIM).map(|i| value(i % DIM)).collect();
    let gpu_volume = DenseVolume3::from_data(space, data.clone());
    service
        .register_volume_with_upload(
            "volume_0".into(),
            &gpu_volume,
            wgpu::TextureFormat::R32Float,
        )
        .unwrap();

    let mut cpu_volume = TestVolume::new([DIM; 3], [1.0; 3], [0.0; 3]);
    cpu_volume.data_mut().copy_from_slice(&data);

    let mut slice = SliceSpec::oblique(
        [ORIGIN_X, ROW[0], ROW[1]],
        [STEP_MM, 0.0, 0.0],
        [0.0, STEP_MM, 0.0],
        [PIXELS, 1],
    );
    let request = |slice: SliceSpec| {
        CompositeRequest::new(
            slice,
            vec![LayerSpec {
                volume_id: VolumeHandle::new(0),
                world_from_voxel: nalgebra::Matrix4::identity(),
                visual: LayerVisual {
                    display_range: Some((0.0, DISPLAY_MAX)),
                    ..Default::default()
                },
            }],
        )
    };

    for (method, cpu_sample) in [
        (
            InterpolationMethod::Nearest,
            sample_nearest as fn(&dyn Volume, [f32; 3]) -> Option<f32>,
        ),
        (InterpolationMethod::Linear, sample_trilinear),
    ] {
        slice.interp = method;
        let gpu = service.composite_rgba(&request(slice.clone())).unwrap();
        let mut covered = 0;
        for k in 0..PIXELS {
            let x = pixel_centre_x(k);
            let red = gpu[(k * 4) as usize] as i16;
            // Uncovered pixels keep the renderer's clear colour (26).
            let gpu_inside = red != 26;
            let cpu = cpu_sample(&cpu_volume, [x, ROW[0], ROW[1]]);
            assert_eq!(
                gpu_inside,
                cpu.is_some(),
                "{method:?}: coverage differs at x={x:.2} (gpu red {red})"
            );
            if let Some(v) = cpu {
                covered += 1;
                assert!(
                    (red - gray(v)).abs() <= 2,
                    "{method:?}: value differs at x={x:.2}: gpu {red}, cpu {}",
                    gray(v)
                );
            }
        }
        // [-0.5, 7.5) at 0.1 mm pixels: exactly 80 pixel centres.
        assert_eq!(covered, 80, "{method:?}: unexpected coverage");
    }
}
