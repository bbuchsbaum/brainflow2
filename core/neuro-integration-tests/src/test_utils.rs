//! Test utilities for integration testing

use neuro_types::{SliceSpec, LayerSpec, LayerVisual, VolumeHandle, CompositeRequest};
use nalgebra::Matrix4;
use std::f32::consts::PI;

/// Generate standard test slice specifications
pub struct TestSliceGenerator;

impl TestSliceGenerator {
    /// Create an axial slice at the given Z coordinate
    pub fn axial_slice(z_mm: f32, fov_mm: [f32; 2], dim_px: [u32; 2]) -> SliceSpec {
        SliceSpec::axial_at(z_mm, fov_mm, dim_px)
    }
    
    /// Create a coronal slice at the given Y coordinate
    pub fn coronal_slice(y_mm: f32, fov_mm: [f32; 2], dim_px: [u32; 2]) -> SliceSpec {
        SliceSpec::coronal_at(y_mm, fov_mm, dim_px)
    }
    
    /// Create a sagittal slice at the given X coordinate
    pub fn sagittal_slice(x_mm: f32, fov_mm: [f32; 2], dim_px: [u32; 2]) -> SliceSpec {
        SliceSpec::sagittal_at(x_mm, fov_mm, dim_px)
    }
    
    /// Create an oblique slice with custom orientation
    pub fn oblique_slice(
        origin_mm: [f32; 3],
        rotation_x: f32,
        rotation_y: f32,
        fov_mm: [f32; 2],
        dim_px: [u32; 2],
    ) -> SliceSpec {
        // Create rotation matrices
        let cos_x = rotation_x.cos();
        let sin_x = rotation_x.sin();
        let cos_y = rotation_y.cos();
        let sin_y = rotation_y.sin();
        
        // Combined rotation: Y rotation followed by X rotation
        let u_mm = [
            cos_y,
            sin_x * sin_y,
            -cos_x * sin_y,
        ];
        
        let v_mm = [
            0.0,
            cos_x,
            sin_x,
        ];
        
        SliceSpec {
            origin_mm,
            u_mm,
            v_mm,
            dim_px,
            interp: neuro_types::InterpolationMethod::Linear,
            border_mode: neuro_types::BorderMode::Transparent,
        }
    }
    
    /// Generate a set of standard test slices
    pub fn standard_test_slices() -> Vec<(&'static str, SliceSpec)> {
        vec![
            ("axial_center", Self::axial_slice(0.0, [256.0, 256.0], [256, 256])),
            ("coronal_center", Self::coronal_slice(0.0, [256.0, 256.0], [256, 256])),
            ("sagittal_center", Self::sagittal_slice(0.0, [256.0, 256.0], [256, 256])),
            ("axial_top", Self::axial_slice(50.0, [256.0, 256.0], [256, 256])),
            ("axial_bottom", Self::axial_slice(-50.0, [256.0, 256.0], [256, 256])),
            ("oblique_45deg", Self::oblique_slice([0.0, 0.0, 0.0], PI/4.0, 0.0, [256.0, 256.0], [256, 256])),
            ("oblique_complex", Self::oblique_slice([10.0, -5.0, 15.0], PI/6.0, PI/3.0, [200.0, 200.0], [200, 200])),
            ("high_res", Self::axial_slice(0.0, [128.0, 128.0], [512, 512])),
            ("low_res", Self::axial_slice(0.0, [256.0, 256.0], [64, 64])),
        ]
    }
}

/// Generate standard test layer specifications
pub struct TestLayerGenerator;

impl TestLayerGenerator {
    /// Create a simple layer with default visual parameters
    pub fn simple_layer(volume_id: usize, transform: Matrix4<f32>) -> LayerSpec {
        LayerSpec {
            volume_id: VolumeHandle::new(volume_id),
            world_from_voxel: transform,
            visual: LayerVisual::default(),
        }
    }
    
    /// Create a layer with custom intensity window
    pub fn windowed_layer(
        volume_id: usize,
        transform: Matrix4<f32>,
        intensity_min: f32,
        intensity_max: f32,
    ) -> LayerSpec {
        let mut visual = LayerVisual::default();
        visual.intensity_range = Some([intensity_min, intensity_max]);
        
        LayerSpec {
            volume_id: VolumeHandle::new(volume_id),
            world_from_voxel: transform,
            visual,
        }
    }
    
    /// Create a layer with colormap
    pub fn colormap_layer(
        volume_id: usize,
        transform: Matrix4<f32>,
        colormap: neuro_types::Colormap,
        opacity: f32,
    ) -> LayerSpec {
        let mut visual = LayerVisual::default();
        visual.colormap = colormap;
        visual.opacity = opacity;
        
        LayerSpec {
            volume_id: VolumeHandle::new(volume_id),
            world_from_voxel: transform,
            visual,
        }
    }
    
    /// Create a thresholded overlay layer
    pub fn overlay_layer(
        volume_id: usize,
        transform: Matrix4<f32>,
        threshold_min: f32,
        threshold_max: f32,
        colormap: neuro_types::Colormap,
    ) -> LayerSpec {
        let mut visual = LayerVisual::overlay();
        visual.colormap = colormap;
        visual.threshold_range = Some([threshold_min, threshold_max]);
        
        LayerSpec {
            volume_id: VolumeHandle::new(volume_id),
            world_from_voxel: transform,
            visual,
        }
    }
}

/// Create composite requests for testing
pub struct TestRequestGenerator;

impl TestRequestGenerator {
    /// Create a single-layer composite request
    pub fn single_layer(slice: SliceSpec, layer: LayerSpec) -> CompositeRequest {
        CompositeRequest::new(slice, vec![layer])
    }
    
    /// Create a multi-layer composite request
    pub fn multi_layer(slice: SliceSpec, layers: Vec<LayerSpec>) -> CompositeRequest {
        CompositeRequest::new(slice, layers)
    }
    
    /// Create a standard anatomical + overlay request
    pub fn anatomical_with_overlay(
        slice: SliceSpec,
        anat_volume_id: usize,
        anat_transform: Matrix4<f32>,
        overlay_volume_id: usize,
        overlay_transform: Matrix4<f32>,
        overlay_threshold: f32,
    ) -> CompositeRequest {
        let anat_layer = TestLayerGenerator::simple_layer(anat_volume_id, anat_transform);
        let overlay_layer = TestLayerGenerator::overlay_layer(
            overlay_volume_id,
            overlay_transform,
            overlay_threshold,
            f32::INFINITY,
            neuro_types::Colormap::Hot,
        );
        
        CompositeRequest::new(slice, vec![anat_layer, overlay_layer])
    }
}

/// Test result analysis utilities
pub struct TestAnalysis;

impl TestAnalysis {
    /// Calculate per-channel statistics for an RGBA image
    pub fn channel_statistics(rgba: &[u8]) -> ChannelStats {
        assert!(rgba.len() % 4 == 0, "Invalid RGBA data length");
        
        let num_pixels = rgba.len() / 4;
        let mut stats = ChannelStats::default();
        
        for i in 0..num_pixels {
            let offset = i * 4;
            let r = rgba[offset] as f32;
            let g = rgba[offset + 1] as f32;
            let b = rgba[offset + 2] as f32;
            let a = rgba[offset + 3] as f32;
            
            stats.r_sum += r;
            stats.g_sum += g;
            stats.b_sum += b;
            stats.a_sum += a;
            
            stats.r_min = stats.r_min.min(r);
            stats.g_min = stats.g_min.min(g);
            stats.b_min = stats.b_min.min(b);
            stats.a_min = stats.a_min.min(a);
            
            stats.r_max = stats.r_max.max(r);
            stats.g_max = stats.g_max.max(g);
            stats.b_max = stats.b_max.max(b);
            stats.a_max = stats.a_max.max(a);
            
            if a > 0.0 {
                stats.non_transparent_pixels += 1;
            }
        }
        
        let n = num_pixels as f32;
        stats.r_mean = stats.r_sum / n;
        stats.g_mean = stats.g_sum / n;
        stats.b_mean = stats.b_sum / n;
        stats.a_mean = stats.a_sum / n;
        
        stats
    }
    
    /// Check if an image is mostly transparent
    pub fn is_mostly_transparent(rgba: &[u8], threshold: f32) -> bool {
        let stats = Self::channel_statistics(rgba);
        let num_pixels = rgba.len() / 4;
        let transparent_ratio = 1.0 - (stats.non_transparent_pixels as f32 / num_pixels as f32);
        transparent_ratio > threshold
    }
}

#[derive(Debug, Default)]
pub struct ChannelStats {
    pub r_sum: f32,
    pub g_sum: f32,
    pub b_sum: f32,
    pub a_sum: f32,
    pub r_mean: f32,
    pub g_mean: f32,
    pub b_mean: f32,
    pub a_mean: f32,
    pub r_min: f32,
    pub g_min: f32,
    pub b_min: f32,
    pub a_min: f32,
    pub r_max: f32,
    pub g_max: f32,
    pub b_max: f32,
    pub a_max: f32,
    pub non_transparent_pixels: usize,
}

impl ChannelStats {
    fn default() -> Self {
        Self {
            r_sum: 0.0,
            g_sum: 0.0,
            b_sum: 0.0,
            a_sum: 0.0,
            r_mean: 0.0,
            g_mean: 0.0,
            b_mean: 0.0,
            a_mean: 0.0,
            r_min: f32::INFINITY,
            g_min: f32::INFINITY,
            b_min: f32::INFINITY,
            a_min: f32::INFINITY,
            r_max: f32::NEG_INFINITY,
            g_max: f32::NEG_INFINITY,
            b_max: f32::NEG_INFINITY,
            a_max: f32::NEG_INFINITY,
            non_transparent_pixels: 0,
        }
    }
}