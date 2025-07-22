//! Volume storage trait
//! 
//! Provides an abstraction for storing and retrieving volume data without global state

use std::sync::Arc;
use std::collections::HashMap;
use nalgebra::Matrix4;

/// Handle to reference a volume in the store
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct VolumeHandle(pub usize);

impl VolumeHandle {
    /// Create a new handle with the given ID
    pub fn new(id: usize) -> Self {
        Self(id)
    }
}

/// Trait for storing and retrieving volumes
/// 
/// Implementations should be thread-safe and avoid global state.
/// The TestVolumeStore provides a simple in-memory implementation.
pub trait VolumeStore: Send + Sync {
    /// Retrieve a volume by its handle
    fn get_volume(&self, handle: &VolumeHandle) -> Option<Arc<dyn Volume>>;
    
    /// Add a volume to the store and return its handle
    fn add_volume(&mut self, volume: Arc<dyn Volume>) -> VolumeHandle;
    
    /// Remove a volume from the store
    fn remove_volume(&mut self, handle: &VolumeHandle) -> Option<Arc<dyn Volume>>;
    
    /// Get the number of volumes in the store
    fn len(&self) -> usize;
    
    /// Check if the store is empty
    fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// Trait representing a 3D volume
pub trait Volume: Send + Sync {
    /// Get the dimensions of the volume [x, y, z]
    fn dimensions(&self) -> [usize; 3];
    
    /// Get the voxel spacing in mm [dx, dy, dz]
    fn spacing(&self) -> [f32; 3];
    
    /// Get the origin in world coordinates [x, y, z]
    fn origin(&self) -> [f32; 3];
    
    /// Sample a value at the given voxel coordinates
    fn get_at_coords(&self, coords: [usize; 3]) -> Option<f32>;
    
    /// Get the voxel-to-world affine transform matrix
    /// This is the full 4x4 matrix that transforms voxel indices to world coordinates
    fn voxel_to_world_matrix(&self) -> Matrix4<f32>;
    
    /// Get the data type name for debugging
    fn dtype_name(&self) -> &str;
}

/// Simple in-memory volume store for testing
#[derive(Default)]
pub struct TestVolumeStore {
    volumes: HashMap<VolumeHandle, Arc<dyn Volume>>,
    next_id: usize,
}

impl TestVolumeStore {
    /// Create a new empty volume store
    pub fn new() -> Self {
        Self {
            volumes: HashMap::new(),
            next_id: 0,
        }
    }
}

impl VolumeStore for TestVolumeStore {
    fn get_volume(&self, handle: &VolumeHandle) -> Option<Arc<dyn Volume>> {
        self.volumes.get(handle).cloned()
    }
    
    fn add_volume(&mut self, volume: Arc<dyn Volume>) -> VolumeHandle {
        let handle = VolumeHandle(self.next_id);
        self.next_id += 1;
        self.volumes.insert(handle, volume);
        handle
    }
    
    fn remove_volume(&mut self, handle: &VolumeHandle) -> Option<Arc<dyn Volume>> {
        self.volumes.remove(handle)
    }
    
    fn len(&self) -> usize {
        self.volumes.len()
    }
}

/// A simple test volume implementation
pub struct TestVolume {
    dimensions: [usize; 3],
    spacing: [f32; 3],
    origin: [f32; 3],
    voxel_to_world: Matrix4<f32>,
    data: Vec<f32>,
}

impl TestVolume {
    /// Create a new test volume with the given parameters
    pub fn new(dimensions: [usize; 3], spacing: [f32; 3], origin: [f32; 3]) -> Self {
        let size = dimensions[0] * dimensions[1] * dimensions[2];
        
        // Build standard voxel-to-world matrix (translation * scaling)
        let voxel_to_world = Matrix4::new_translation(&nalgebra::Vector3::from(origin))
            * Matrix4::new_nonuniform_scaling(&nalgebra::Vector3::from(spacing));
        
        Self {
            dimensions,
            spacing,
            origin,
            voxel_to_world,
            data: vec![0.0; size],
        }
    }
    
    /// Create a new test volume with a custom affine transform
    pub fn with_transform(dimensions: [usize; 3], voxel_to_world: Matrix4<f32>) -> Self {
        let size = dimensions[0] * dimensions[1] * dimensions[2];
        
        // Extract spacing and origin from the transform for backward compatibility
        let spacing = [
            (voxel_to_world.column(0).xyz().norm()),
            (voxel_to_world.column(1).xyz().norm()),
            (voxel_to_world.column(2).xyz().norm()),
        ];
        let origin = voxel_to_world.column(3).xyz().into();
        
        Self {
            dimensions,
            spacing,
            origin,
            voxel_to_world,
            data: vec![0.0; size],
        }
    }
    
    /// Create a test volume filled with a gradient pattern
    pub fn with_gradient(dimensions: [usize; 3]) -> Self {
        let mut volume = Self::new(dimensions, [1.0, 1.0, 1.0], [0.0, 0.0, 0.0]);
        
        for z in 0..dimensions[2] {
            for y in 0..dimensions[1] {
                for x in 0..dimensions[0] {
                    let idx = z * dimensions[0] * dimensions[1] + y * dimensions[0] + x;
                    volume.data[idx] = (x + y + z) as f32;
                }
            }
        }
        
        volume
    }
    
    /// Get a mutable reference to the data for testing
    pub fn data_mut(&mut self) -> &mut [f32] {
        &mut self.data
    }
}

impl Volume for TestVolume {
    fn dimensions(&self) -> [usize; 3] {
        self.dimensions
    }
    
    fn spacing(&self) -> [f32; 3] {
        self.spacing
    }
    
    fn origin(&self) -> [f32; 3] {
        self.origin
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
        
        Some(self.data[idx])
    }
    
    fn voxel_to_world_matrix(&self) -> Matrix4<f32> {
        self.voxel_to_world
    }
    
    fn dtype_name(&self) -> &str {
        "f32"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_volume_store() {
        let mut store = TestVolumeStore::new();
        let volume = TestVolume::new([10, 10, 10], [1.0, 1.0, 1.0], [0.0, 0.0, 0.0]);
        
        let handle = store.add_volume(Arc::new(volume));
        assert_eq!(store.len(), 1);
        assert!(store.get_volume(&handle).is_some());
    }
    
    #[test]
    fn test_multiple_volumes() {
        let mut store = TestVolumeStore::new();
        
        let vol1 = TestVolume::new([10, 10, 10], [1.0, 1.0, 1.0], [0.0, 0.0, 0.0]);
        let vol2 = TestVolume::new([20, 20, 20], [2.0, 2.0, 2.0], [10.0, 10.0, 10.0]);
        
        let handle1 = store.add_volume(Arc::new(vol1));
        let handle2 = store.add_volume(Arc::new(vol2));
        
        assert_eq!(store.len(), 2);
        assert_ne!(handle1, handle2);
        
        // Check that we can retrieve both
        let retrieved1 = store.get_volume(&handle1).unwrap();
        let retrieved2 = store.get_volume(&handle2).unwrap();
        
        assert_eq!(retrieved1.dimensions(), [10, 10, 10]);
        assert_eq!(retrieved2.dimensions(), [20, 20, 20]);
    }
    
    #[test]
    fn test_remove_volume() {
        let mut store = TestVolumeStore::new();
        let volume = TestVolume::new([10, 10, 10], [1.0, 1.0, 1.0], [0.0, 0.0, 0.0]);
        
        let handle = store.add_volume(Arc::new(volume));
        assert_eq!(store.len(), 1);
        
        let removed = store.remove_volume(&handle);
        assert!(removed.is_some());
        assert_eq!(store.len(), 0);
        assert!(store.get_volume(&handle).is_none());
    }
    
    #[test]
    fn test_gradient_volume() {
        let volume = TestVolume::with_gradient([5, 5, 5]);
        
        // Test corner values
        assert_eq!(volume.get_at_coords([0, 0, 0]), Some(0.0));
        assert_eq!(volume.get_at_coords([1, 1, 1]), Some(3.0));
        assert_eq!(volume.get_at_coords([2, 2, 2]), Some(6.0));
        
        // Test out of bounds
        assert_eq!(volume.get_at_coords([5, 0, 0]), None);
        assert_eq!(volume.get_at_coords([0, 5, 0]), None);
        assert_eq!(volume.get_at_coords([0, 0, 5]), None);
    }
    
    #[test]
    fn test_volume_properties() {
        let volume = TestVolume::new([10, 20, 30], [1.5, 2.0, 3.0], [-5.0, -10.0, -15.0]);
        
        assert_eq!(volume.dimensions(), [10, 20, 30]);
        assert_eq!(volume.spacing(), [1.5, 2.0, 3.0]);
        assert_eq!(volume.origin(), [-5.0, -10.0, -15.0]);
        assert_eq!(volume.dtype_name(), "f32");
    }
}