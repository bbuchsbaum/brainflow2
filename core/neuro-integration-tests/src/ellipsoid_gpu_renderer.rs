//! GPU ellipsoid renderer for differential testing
//! 
//! Provides GPU-based ellipsoid rendering using the render_loop service

use neuro_types::{OrientedEllipsoid, Result as NeuroResult, RgbaImage, SliceSpec, CompositeRequest, LayerSpec, LayerVisual, VolumeHandle};
use render_loop::RenderLoopService;
use nalgebra::Matrix4;
use volmath::{DenseVolume3, NeuroSpace3, NeuroSpaceExt};

/// GPU-based ellipsoid renderer using the render_loop service
pub struct GpuEllipsoidRenderer {
    render_service: RenderLoopService,
    /// Track active volume handles for cleanup
    active_volumes: Vec<u32>,
}

impl GpuEllipsoidRenderer {
    /// Create a new GPU ellipsoid renderer
    pub async fn new() -> NeuroResult<Self> {
        let render_service = RenderLoopService::new().await
            .map_err(|e| neuro_types::Error::GpuError(e.to_string()))?;
        
        Ok(Self { 
            render_service,
            active_volumes: Vec::new(),
        })
    }
    
    /// Initialize the renderer (load shaders, etc.)
    pub async fn init(&mut self) -> NeuroResult<()> {
        // Note: offscreen rendering is handled by render_to_buffer method
        // Load shaders
        self.render_service.load_shaders()
            .map_err(|e| neuro_types::Error::GpuError(e.to_string()))?;
        
        // Initialize colormaps
        self.render_service.initialize_colormap()
            .map_err(|e| neuro_types::Error::GpuError(e.to_string()))?;
        
        // Enable world-space rendering
        self.render_service.enable_world_space_rendering()
            .map_err(|e| neuro_types::Error::GpuError(e.to_string()))?;
        
        // Create world-space bind groups
        self.render_service.create_world_space_bind_groups()
            .map_err(|e| neuro_types::Error::GpuError(e.to_string()))?;
        
        Ok(())
    }
    
    /// Render an ellipsoid to an RGBA image using GPU
    /// 
    /// # Parameters
    /// - `ellipsoid`: The ellipsoid to render
    /// - `slice_spec`: Slice specification defining the view
    /// - `color`: RGBA color for the ellipsoid
    pub async fn render_volume_slice(
        &mut self,
        ellipsoid: &OrientedEllipsoid,
        slice_spec: &SliceSpec,
        color: [u8; 4],
    ) -> NeuroResult<RgbaImage> {
        // Step 1: Create a synthetic volume containing the ellipsoid
        let volume_handle = self.create_ellipsoid_volume(ellipsoid).await?;
        
        // Step 2: Create layer specification
        let layer = LayerSpec {
            volume_id: volume_handle,
            world_from_voxel: Matrix4::identity(), // Will be set properly based on ellipsoid
            visual: LayerVisual {
                opacity: color[3] as f32 / 255.0,
                intensity_range: (0.0, ellipsoid.intensity),
                display_range: None,
                colormap_id: self.create_solid_color_map(color).await?,
                threshold_range: (f32::NEG_INFINITY, f32::INFINITY),
                blend_mode: neuro_types::BlendMode::Normal,
                premultiplied: true,
                is_mask: false,
            },
        };
        
        // Step 3: Create composite request
        let request = CompositeRequest::new(slice_spec.clone(), vec![layer]);
        
        // Step 4: Render using GPU
        let rgba_data = self.render_service.composite_rgba(&request)
            .map_err(|e| neuro_types::Error::GpuError(e.to_string()))?;
        
        Ok(rgba_data)
    }
    
    /// Create a synthetic volume containing the ellipsoid
    /// This creates a 3D volume texture on the GPU containing the ellipsoid
    async fn create_ellipsoid_volume(&mut self, ellipsoid: &OrientedEllipsoid) -> NeuroResult<VolumeHandle> {
        // Determine volume dimensions based on ellipsoid bounds
        // Add padding to ensure ellipsoid fits within volume
        let padding = 10.0; // mm
        let max_radius = ellipsoid.radii.x.max(ellipsoid.radii.y).max(ellipsoid.radii.z) + padding;
        
        // Calculate dimensions to contain the ellipsoid
        let center_offset = max_radius;
        let dims = [
            (2.0 * max_radius) as usize,
            (2.0 * max_radius) as usize,
            (2.0 * max_radius) as usize,
        ];
        
        // Create volume with 1mm spacing
        let spacing = [1.0, 1.0, 1.0];
        let origin = [
            ellipsoid.center.x - center_offset,
            ellipsoid.center.y - center_offset,
            ellipsoid.center.z - center_offset,
        ];
        
        // Create NeuroSpace
        let space_impl = <volmath::NeuroSpace as NeuroSpaceExt>::from_dims_spacing_origin(
            dims.to_vec(),
            spacing.to_vec(),
            origin.to_vec(),
        ).map_err(|e| neuro_types::Error::TestError(format!("Failed to create NeuroSpace: {}", e)))?;
        let space = NeuroSpace3::new(space_impl);
        
        // Create volume data - rasterize ellipsoid
        let mut data = vec![0.0f32; dims[0] * dims[1] * dims[2]];
        
        // Rasterize ellipsoid into volume
        for z in 0..dims[2] {
            for y in 0..dims[1] {
                for x in 0..dims[0] {
                    // Convert voxel to world coordinates
                    let voxel_pos = nalgebra::Point3::new(x as f32, y as f32, z as f32);
                    let voxel_to_world = space.0.voxel_to_world();
                    let world_pos = voxel_to_world.transform_point(&voxel_pos);
                    
                    // Check if point is inside ellipsoid (convert to f64 for ellipsoid math)
                    let dx = world_pos.x as f64 - ellipsoid.center.x;
                    let dy = world_pos.y as f64 - ellipsoid.center.y;
                    let dz = world_pos.z as f64 - ellipsoid.center.z;
                    
                    // Apply rotation to get into ellipsoid's local space
                    let local_vec = nalgebra::Vector3::new(dx, dy, dz);
                    let rotated = ellipsoid.rotation * local_vec;
                    
                    // Check ellipsoid equation: (x/a)² + (y/b)² + (z/c)² <= 1
                    let normalized_x = rotated.x / ellipsoid.radii.x;
                    let normalized_y = rotated.y / ellipsoid.radii.y;
                    let normalized_z = rotated.z / ellipsoid.radii.z;
                    
                    let distance_squared = normalized_x * normalized_x + 
                                         normalized_y * normalized_y + 
                                         normalized_z * normalized_z;
                    
                    if distance_squared <= 1.0 {
                        // Inside ellipsoid - calculate gradient from center to edge
                        let distance = distance_squared.sqrt();
                        let intensity_norm = (1.0 - distance).max(0.0);
                        let value = ellipsoid.intensity * intensity_norm as f32;
                        
                        let idx = x + y * dims[0] + z * dims[0] * dims[1];
                        data[idx] = value;
                    }
                }
            }
        }
        
        // Create DenseVolume3
        let volume = DenseVolume3::<f32>::from_data(space.0, data);
        
        // Upload to GPU
        let (texture_idx, _transform) = self.render_service.upload_volume_3d(&volume)
            .map_err(|e| neuro_types::Error::TestError(format!("Failed to upload volume: {}", e)))?;
        
        // Track the volume for cleanup
        self.active_volumes.push(texture_idx);
        
        Ok(VolumeHandle::new(texture_idx as usize))
    }
    
    /// Create a solid color colormap
    async fn create_solid_color_map(&mut self, color: [u8; 4]) -> NeuroResult<u32> {
        // Map colors to built-in colormaps based on predominant channel
        // This is a workaround until custom colormap upload is implemented
        
        // Determine which color channel is dominant
        let r = color[0] as f32;
        let g = color[1] as f32;
        let b = color[2] as f32;
        
        // Use hot colormap for red-dominant colors (red ellipsoids)
        if r > g && r > b && r > 128.0 {
            return Ok(2); // Hot colormap ID
        }
        
        // Use cool colormap for blue-dominant colors
        if b > r && b > g && b > 128.0 {
            return Ok(3); // Cool colormap ID
        }
        
        // For purple (high red + high blue), also use cool colormap
        if r > 128.0 && b > 128.0 && g < 100.0 {
            return Ok(3); // Cool colormap shows purple nicely
        }
        
        // Use viridis for green-dominant colors
        if g > r && g > b && g > 128.0 {
            return Ok(1); // Viridis colormap ID
        }
        
        // Default to grayscale for other colors
        Ok(0)
    }
    
    /// Render multiple ellipsoids with blending
    pub async fn render_composite(
        &mut self,
        ellipsoids: &[(OrientedEllipsoid, [u8; 4], neuro_types::BlendMode)],
        slice_spec: &SliceSpec,
    ) -> NeuroResult<RgbaImage> {
        // Create layer specifications for each ellipsoid
        let mut layers = Vec::new();
        
        for (ellipsoid, color, blend_mode) in ellipsoids {
            let volume_handle = self.create_ellipsoid_volume(ellipsoid).await?;
            
            let layer = LayerSpec {
                volume_id: volume_handle,
                world_from_voxel: Matrix4::identity(),
                visual: LayerVisual {
                    opacity: color[3] as f32 / 255.0,
                    intensity_range: (0.0, ellipsoid.intensity),
                    display_range: None,
                    colormap_id: self.create_solid_color_map(*color).await?,
                    threshold_range: (f32::NEG_INFINITY, f32::INFINITY),
                    blend_mode: *blend_mode,
                    premultiplied: true,
                    is_mask: false,
                },
            };
            
            layers.push(layer);
        }
        
        // Create composite request with all layers
        let request = CompositeRequest::new(slice_spec.clone(), layers);
        
        // Render using GPU
        let rgba_data = self.render_service.composite_rgba(&request)
            .map_err(|e| neuro_types::Error::GpuError(e.to_string()))?;
        
        Ok(rgba_data)
    }
    
    /// Clean up all active volumes to free GPU resources
    pub fn cleanup_volumes(&mut self) -> NeuroResult<()> {
        let volumes_to_clean = self.active_volumes.drain(..).collect::<Vec<_>>();
        
        for texture_idx in volumes_to_clean {
            self.render_service.release_volume(texture_idx)
                .map_err(|e| neuro_types::Error::TestError(format!("Failed to release volume {}: {}", texture_idx, e)))?;
        }
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nalgebra::{Point3, Vector3, Rotation3};
    
    #[tokio::test]
    async fn test_gpu_ellipsoid_renderer_creation() {
        let result = GpuEllipsoidRenderer::new().await;
        assert!(result.is_ok(), "GPU ellipsoid renderer creation failed: {:?}", result.err());
    }
    
    #[tokio::test]
    async fn test_gpu_ellipsoid_renderer_init() {
        let mut renderer = GpuEllipsoidRenderer::new().await.unwrap();
        let result = renderer.init().await;
        assert!(result.is_ok(), "GPU ellipsoid renderer initialization failed: {:?}", result.err());
    }
    
    // NOTE: Full rendering tests would require implementing create_ellipsoid_volume
    // and proper volume storage integration
}