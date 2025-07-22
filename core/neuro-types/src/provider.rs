//! Unified slice provider trait
//! 
//! Provides the canonical interface that both CPU and GPU implementations
//! must satisfy for differential testing and unified API.

use crate::{CompositeRequest, Result};

/// RGBA image data (width * height * 4 bytes)
pub type RgbaImage = Vec<u8>;

/// Slice data for single-layer extraction  
#[derive(Debug, Clone)]
pub struct SliceData {
    /// Raw intensity data as f32 values
    pub data: Vec<f32>,
    /// Dimensions [width, height]
    pub dimensions: [u32; 2],
}

/// Composite slice data with alpha channel
#[derive(Debug, Clone)]
pub struct CompositeSliceData {
    /// RGBA data (premultiplied alpha)
    pub data: RgbaImage,
    /// Dimensions [width, height]  
    pub dimensions: [u32; 2],
}

impl CompositeSliceData {
    /// Create new composite data
    pub fn new(data: RgbaImage, dimensions: [u32; 2]) -> Self {
        Self { data, dimensions }
    }
    
    /// Get the pixel data as RGBA chunks
    pub fn pixels(&self) -> impl Iterator<Item = &[u8]> {
        self.data.chunks(4)
    }
    
    /// Get a specific pixel as [R, G, B, A]
    pub fn get_pixel(&self, x: u32, y: u32) -> Option<[u8; 4]> {
        if x >= self.dimensions[0] || y >= self.dimensions[1] {
            return None;
        }
        
        let offset = ((y * self.dimensions[0] + x) * 4) as usize;
        if offset + 3 < self.data.len() {
            Some([
                self.data[offset],
                self.data[offset + 1], 
                self.data[offset + 2],
                self.data[offset + 3],
            ])
        } else {
            None
        }
    }
    
    /// Convert to RgbaImage for direct comparison
    pub fn into_rgba(self) -> RgbaImage {
        self.data
    }
}

/// Unified slice provider interface
/// 
/// Both CPU and GPU implementations must satisfy this trait to enable
/// differential testing and provide a unified public API.
pub trait SliceProvider {
    /// Extract and composite multiple layers into a single RGBA image
    /// 
    /// This is the primary method for differential testing - both CPU and GPU
    /// implementations must produce identical (within tolerance) RGBA output.
    fn composite_rgba(&self, request: &CompositeRequest) -> Result<RgbaImage>;
    
    /// Extract a single slice as raw intensity data (optional for some implementations)
    fn extract_slice_data(&self, _request: &CompositeRequest) -> Result<SliceData> {
        // Default implementation: not all providers need to support raw data extraction
        Err(crate::Error::GpuError("Raw slice data extraction not supported".into()))
    }
    
    /// Extract and composite layers with full alpha channel information
    fn extract_composite(&self, request: &CompositeRequest) -> Result<CompositeSliceData> {
        let rgba = self.composite_rgba(request)?;
        Ok(CompositeSliceData::new(rgba, request.slice.dim_px))
    }
}

/// Convenience methods for common slice operations
pub trait SliceProviderExt: SliceProvider {
    /// Extract an axial slice at the given Z coordinate
    fn axial_slice_rgba(&self, layers: Vec<crate::LayerSpec>, z: f32, extent_mm: [f32; 2], dim_px: [u32; 2]) -> Result<RgbaImage> {
        let slice = crate::SliceSpec::axial_at([0.0, 0.0, z], extent_mm, dim_px);
        let request = CompositeRequest::new(slice, layers);
        self.composite_rgba(&request)
    }
    
    /// Extract a sagittal slice at the given X coordinate  
    fn sagittal_slice_rgba(&self, layers: Vec<crate::LayerSpec>, x: f32, extent_mm: [f32; 2], dim_px: [u32; 2]) -> Result<RgbaImage> {
        let slice = crate::SliceSpec::sagittal_at([x, 0.0, 0.0], extent_mm, dim_px);
        let request = CompositeRequest::new(slice, layers);
        self.composite_rgba(&request)
    }
    
    /// Extract a coronal slice at the given Y coordinate
    fn coronal_slice_rgba(&self, layers: Vec<crate::LayerSpec>, y: f32, extent_mm: [f32; 2], dim_px: [u32; 2]) -> Result<RgbaImage> {
        let slice = crate::SliceSpec::coronal_at([0.0, y, 0.0], extent_mm, dim_px);
        let request = CompositeRequest::new(slice, layers);
        self.composite_rgba(&request)
    }
}

/// Automatically implement convenience methods for all SliceProvider implementations
impl<T: SliceProvider> SliceProviderExt for T {}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_composite_slice_data() {
        let rgba_data = vec![
            255, 0, 0, 255,    // Red pixel
            0, 255, 0, 255,    // Green pixel
            0, 0, 255, 255,    // Blue pixel
            128, 128, 128, 128, // Gray pixel with alpha
        ];
        
        let composite = CompositeSliceData::new(rgba_data, [2, 2]);
        
        // Test pixel access
        assert_eq!(composite.get_pixel(0, 0), Some([255, 0, 0, 255]));
        assert_eq!(composite.get_pixel(1, 0), Some([0, 255, 0, 255]));
        assert_eq!(composite.get_pixel(0, 1), Some([0, 0, 255, 255]));
        assert_eq!(composite.get_pixel(1, 1), Some([128, 128, 128, 128]));
        
        // Test bounds checking
        assert_eq!(composite.get_pixel(2, 0), None);
        assert_eq!(composite.get_pixel(0, 2), None);
    }
    
    #[test]
    fn test_slice_data() {
        let data = vec![0.0, 0.5, 1.0, 0.25];
        let slice = SliceData {
            data,
            dimensions: [2, 2],
        };
        
        assert_eq!(slice.dimensions, [2, 2]);
        assert_eq!(slice.data.len(), 4);
        assert_eq!(slice.data[0], 0.0);
        assert_eq!(slice.data[3], 0.25);
    }
}