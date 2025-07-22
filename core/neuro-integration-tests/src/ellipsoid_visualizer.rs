//! Ellipsoid visualization module for generating slice images
//! 
//! This module generates PNG images of ellipsoid slices for visual debugging

use neuro_types::{OrientedEllipsoid, VolumeRasterizer};
use nalgebra::{Point3, Vector3, Rotation3, Matrix4};
use image::{ImageBuffer, Rgb, RgbImage};
use std::fs;
use std::path::Path;
use anyhow::Result;

/// Generates slice images for ellipsoid visualization
pub struct EllipsoidVisualizer {
    output_dir: String,
}

impl EllipsoidVisualizer {
    pub fn new(output_dir: String) -> Self {
        Self { output_dir }
    }
    
    /// Generate slice images for an ellipsoid
    pub fn generate_ellipsoid_slices(
        &self,
        ellipsoid: &OrientedEllipsoid,
        test_name: &str,
        volume_size: [usize; 3],
        spacing: [f64; 3],
    ) -> Result<SliceImagePaths> {
        // Create a simple volume for rasterization
        let mut volume = SimpleVolume::new(volume_size, spacing);
        
        // Rasterize the ellipsoid
        ellipsoid.rasterize_supersampled(&mut volume, 2)?;
        
        // Generate slices
        let axial_path = self.save_axial_slice(&volume, test_name, volume_size[2] / 2)?;
        let coronal_path = self.save_coronal_slice(&volume, test_name, volume_size[1] / 2)?;
        let sagittal_path = self.save_sagittal_slice(&volume, test_name, volume_size[0] / 2)?;
        
        Ok(SliceImagePaths {
            axial: axial_path,
            coronal: coronal_path,
            sagittal: sagittal_path,
        })
    }
    
    /// Save an axial slice (Z plane)
    fn save_axial_slice(&self, volume: &SimpleVolume, test_name: &str, z: usize) -> Result<String> {
        let (width, height) = (volume.dimensions[0], volume.dimensions[1]);
        let mut img = RgbImage::new(width as u32, height as u32);
        
        for y in 0..height {
            for x in 0..width {
                let value = volume.get_at_coords([x, y, z]).unwrap_or(0.0);
                let intensity = (value * 255.0).min(255.0) as u8;
                img.put_pixel(x as u32, y as u32, Rgb([intensity, intensity, intensity]));
            }
        }
        
        let filename = format!("{}/{}_axial.png", self.output_dir, test_name);
        img.save(&filename)?;
        Ok(filename)
    }
    
    /// Save a coronal slice (Y plane)
    fn save_coronal_slice(&self, volume: &SimpleVolume, test_name: &str, y: usize) -> Result<String> {
        let (width, height) = (volume.dimensions[0], volume.dimensions[2]);
        let mut img = RgbImage::new(width as u32, height as u32);
        
        for z in 0..height {
            for x in 0..width {
                let value = volume.get_at_coords([x, y, z]).unwrap_or(0.0);
                let intensity = (value * 255.0).min(255.0) as u8;
                img.put_pixel(x as u32, z as u32, Rgb([intensity, intensity, intensity]));
            }
        }
        
        let filename = format!("{}/{}_coronal.png", self.output_dir, test_name);
        img.save(&filename)?;
        Ok(filename)
    }
    
    /// Save a sagittal slice (X plane)
    fn save_sagittal_slice(&self, volume: &SimpleVolume, test_name: &str, x: usize) -> Result<String> {
        let (width, height) = (volume.dimensions[1], volume.dimensions[2]);
        let mut img = RgbImage::new(width as u32, height as u32);
        
        for z in 0..height {
            for y in 0..width {
                let value = volume.get_at_coords([x, y, z]).unwrap_or(0.0);
                let intensity = (value * 255.0).min(255.0) as u8;
                img.put_pixel(y as u32, z as u32, Rgb([intensity, intensity, intensity]));
            }
        }
        
        let filename = format!("{}/{}_sagittal.png", self.output_dir, test_name);
        img.save(&filename)?;
        Ok(filename)
    }
    
    /// Generate a colorized overlay of two ellipsoids
    pub fn generate_overlay_image(
        &self,
        ellipsoid1: &OrientedEllipsoid,
        ellipsoid2: &OrientedEllipsoid,
        test_name: &str,
        volume_size: [usize; 3],
        spacing: [f64; 3],
    ) -> Result<String> {
        let mut volume1 = SimpleVolume::new(volume_size, spacing);
        let mut volume2 = SimpleVolume::new(volume_size, spacing);
        
        ellipsoid1.rasterize_supersampled(&mut volume1, 2)?;
        ellipsoid2.rasterize_supersampled(&mut volume2, 2)?;
        
        // Create overlay image (axial slice at center)
        let z = volume_size[2] / 2;
        let (width, height) = (volume_size[0], volume_size[1]);
        let mut img = RgbImage::new(width as u32, height as u32);
        
        for y in 0..height {
            for x in 0..width {
                let val1 = volume1.get_at_coords([x, y, z]).unwrap_or(0.0);
                let val2 = volume2.get_at_coords([x, y, z]).unwrap_or(0.0);
                
                // Create color based on overlap
                let r = (val1 * 255.0).min(255.0) as u8;  // Red for first ellipsoid
                let g = (val2 * 255.0).min(255.0) as u8;  // Green for second ellipsoid
                let b = ((val1.min(val2)) * 255.0).min(255.0) as u8;  // Blue for overlap
                
                img.put_pixel(x as u32, y as u32, Rgb([r, g, b]));
            }
        }
        
        let filename = format!("{}/{}_overlay.png", self.output_dir, test_name);
        img.save(&filename)?;
        Ok(filename)
    }
}

/// Paths to generated slice images
pub struct SliceImagePaths {
    pub axial: String,
    pub coronal: String,
    pub sagittal: String,
}

/// Simple volume implementation for rasterization
struct SimpleVolume {
    dimensions: [usize; 3],
    spacing: [f64; 3],
    data: Vec<f32>,
}

impl SimpleVolume {
    fn new(dimensions: [usize; 3], spacing: [f64; 3]) -> Self {
        let size = dimensions[0] * dimensions[1] * dimensions[2];
        Self {
            dimensions,
            spacing,
            data: vec![0.0; size],
        }
    }
    
    fn get_at_coords(&self, coords: [usize; 3]) -> Option<f32> {
        if coords[0] >= self.dimensions[0] || 
           coords[1] >= self.dimensions[1] || 
           coords[2] >= self.dimensions[2] {
            return None;
        }
        
        let idx = coords[2] * self.dimensions[0] * self.dimensions[1]
                + coords[1] * self.dimensions[0]
                + coords[0];
        self.data.get(idx).copied()
    }
}

impl VolumeRasterizer for SimpleVolume {
    fn dimensions(&self) -> [usize; 3] {
        self.dimensions
    }
    
    fn voxel_to_world_matrix(&self) -> Matrix4<f32> {
        Matrix4::new(
            self.spacing[0] as f32, 0.0, 0.0, 0.0,
            0.0, self.spacing[1] as f32, 0.0, 0.0,
            0.0, 0.0, self.spacing[2] as f32, 0.0,
            0.0, 0.0, 0.0, 1.0,
        )
    }
    
    fn set_at_coords(&mut self, coords: [usize; 3], value: f32) -> neuro_types::Result<()> {
        if coords[0] >= self.dimensions[0] || 
           coords[1] >= self.dimensions[1] || 
           coords[2] >= self.dimensions[2] {
            return Ok(()); // Silently ignore out-of-bounds
        }
        
        let idx = coords[2] * self.dimensions[0] * self.dimensions[1]
                + coords[1] * self.dimensions[0]
                + coords[0];
        
        if idx < self.data.len() {
            self.data[idx] = value;
        }
        Ok(())
    }
}