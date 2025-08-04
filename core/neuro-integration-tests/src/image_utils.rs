//! Image utility functions for integration tests
//!
//! Provides shared functionality for saving RGBA images with proper dimension handling

use image::{ImageBuffer, ImageFormat, Rgba};
use neuro_types::{Error, Result as NeuroResult, RgbaImage};
use std::path::Path;

/// Save RGBA data as PNG with explicit dimensions
///
/// This function properly handles non-square images by accepting explicit width and height
/// parameters, avoiding the stride mismatch issues that occur when assuming square images.
pub fn save_rgba_image_with_dimensions(
    data: &RgbaImage,
    width: u32,
    height: u32,
    path: &Path,
) -> NeuroResult<()> {
    // Validate that data length matches dimensions
    let expected_len = (width * height * 4) as usize;
    if data.len() != expected_len {
        return Err(Error::TestError(format!(
            "Image data length {} doesn't match dimensions {}x{} (expected {} bytes)",
            data.len(),
            width,
            height,
            expected_len
        )));
    }

    // Create image buffer with proper dimensions
    let img: ImageBuffer<Rgba<u8>, Vec<u8>> =
        ImageBuffer::from_raw(width, height, data.to_vec())
            .ok_or_else(|| Error::TestError("Failed to create image buffer".into()))?;

    // Save as PNG
    img.save_with_format(path, ImageFormat::Png)
        .map_err(|e| Error::TestError(format!("Failed to save image: {}", e)))?;

    Ok(())
}

/// Information about image dimensions
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ImageDimensions {
    pub width: u32,
    pub height: u32,
}

impl ImageDimensions {
    /// Create new dimensions
    pub fn new(width: u32, height: u32) -> Self {
        Self { width, height }
    }

    /// Total number of pixels
    pub fn pixel_count(&self) -> usize {
        (self.width * self.height) as usize
    }

    /// Total number of bytes for RGBA image
    pub fn byte_count(&self) -> usize {
        self.pixel_count() * 4
    }
}

/// Extended RgbaImage type that includes dimension information
#[derive(Debug, Clone)]
pub struct RgbaImageWithDimensions {
    pub data: RgbaImage,
    pub dimensions: ImageDimensions,
}

impl RgbaImageWithDimensions {
    /// Create new image with dimensions
    pub fn new(data: RgbaImage, width: u32, height: u32) -> NeuroResult<Self> {
        let dimensions = ImageDimensions::new(width, height);
        if data.len() != dimensions.byte_count() {
            return Err(Error::TestError(format!(
                "Data length {} doesn't match dimensions {}x{}",
                data.len(),
                width,
                height
            )));
        }
        Ok(Self { data, dimensions })
    }

    /// Save image to file
    pub fn save(&self, path: &Path) -> NeuroResult<()> {
        save_rgba_image_with_dimensions(
            &self.data,
            self.dimensions.width,
            self.dimensions.height,
            path,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_image_dimensions() {
        let dims = ImageDimensions::new(256, 216);
        assert_eq!(dims.pixel_count(), 55296);
        assert_eq!(dims.byte_count(), 221184);
    }

    #[test]
    fn test_rgba_image_with_dimensions() {
        // Create test data for 2x2 image
        let data = vec![
            255, 0, 0, 255, // Red pixel
            0, 255, 0, 255, // Green pixel
            0, 0, 255, 255, // Blue pixel
            255, 255, 255, 255, // White pixel
        ];

        let img = RgbaImageWithDimensions::new(data.clone(), 2, 2).unwrap();
        assert_eq!(img.dimensions.width, 2);
        assert_eq!(img.dimensions.height, 2);
        assert_eq!(img.data.len(), 16);

        // Test mismatched dimensions
        let result = RgbaImageWithDimensions::new(data, 3, 3);
        assert!(result.is_err());
    }
}
