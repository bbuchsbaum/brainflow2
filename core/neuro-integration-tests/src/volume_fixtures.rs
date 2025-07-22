//! Volume fixtures for integration testing

use neuro_core::{Volume, VolumeStore, VolumeHandle as CoreVolumeHandle};
use std::sync::Arc;
use anyhow::Result;

/// Integration test volume store that extends the basic TestVolumeStore
pub struct IntegrationVolumeStore {
    inner: neuro_core::TestVolumeStore,
}

impl IntegrationVolumeStore {
    pub fn new() -> Self {
        Self {
            inner: neuro_core::TestVolumeStore::new(),
        }
    }
    
    pub fn with_standard_volumes() -> Result<Self> {
        use neuro_core::TestVolume;
        
        let mut store = Self::new();
        
        // Add standard test volumes using TestVolume
        // Sphere volume
        let mut sphere = TestVolume::new([128, 128, 128], [1.0, 1.0, 1.0], [0.0, 0.0, 0.0]);
        let sphere_data = sphere.data_mut();
        for z in 0..128 {
            for y in 0..128 {
                for x in 0..128 {
                    let dx = x as f32 - 64.0;
                    let dy = y as f32 - 64.0;
                    let dz = z as f32 - 64.0;
                    let dist_sq = dx * dx + dy * dy + dz * dz;
                    
                    if dist_sq < 30.0 * 30.0 {
                        let dist = dist_sq.sqrt();
                        let value = 1000.0 * (1.0 - dist / 30.0);
                        let idx = z * 128 * 128 + y * 128 + x;
                        sphere_data[idx] = value;
                    }
                }
            }
        }
        store.inner.add_volume(Arc::new(sphere));
        
        // Gradient volume
        let gradient = TestVolume::with_gradient([128, 128, 128]);
        store.inner.add_volume(Arc::new(gradient));
        
        // Checkerboard volume
        let mut checkerboard = TestVolume::new([128, 128, 128], [1.0, 1.0, 1.0], [0.0, 0.0, 0.0]);
        let checker_data = checkerboard.data_mut();
        for z in 0..128 {
            for y in 0..128 {
                for x in 0..128 {
                    let checker_x = (x / 16) % 2;
                    let checker_y = (y / 16) % 2;
                    let checker_z = (z / 16) % 2;
                    
                    let is_even = (checker_x + checker_y + checker_z) % 2 == 0;
                    let value = if is_even { 200.0 } else { 800.0 };
                    
                    let idx = z * 128 * 128 + y * 128 + x;
                    checker_data[idx] = value;
                }
            }
        }
        store.inner.add_volume(Arc::new(checkerboard));
        
        // Sinusoid volume
        let mut sinusoid = TestVolume::new([128, 128, 128], [1.0, 1.0, 1.0], [0.0, 0.0, 0.0]);
        let sin_data = sinusoid.data_mut();
        use std::f32::consts::PI;
        
        for z in 0..128 {
            for y in 0..128 {
                for x in 0..128 {
                    let fx = 2.0 * PI * 2.0 * (x as f32 / 128.0);
                    let fy = 2.0 * PI * 3.0 * (y as f32 / 128.0);
                    let fz = 2.0 * PI * 1.0 * (z as f32 / 128.0);
                    
                    let value = 500.0 + 500.0 * (fx.sin() + fy.sin() + fz.sin()) / 3.0;
                    let idx = z * 128 * 128 + y * 128 + x;
                    sin_data[idx] = value;
                }
            }
        }
        store.inner.add_volume(Arc::new(sinusoid));
        
        Ok(store)
    }
}

impl VolumeStore for IntegrationVolumeStore {
    fn get_volume(&self, handle: &CoreVolumeHandle) -> Option<Arc<dyn Volume>> {
        self.inner.get_volume(handle)
    }
    
    fn add_volume(&mut self, volume: Arc<dyn Volume>) -> CoreVolumeHandle {
        self.inner.add_volume(volume)
    }
    
    fn remove_volume(&mut self, handle: &CoreVolumeHandle) -> Option<Arc<dyn Volume>> {
        self.inner.remove_volume(handle)
    }
    
    fn len(&self) -> usize {
        self.inner.len()
    }
}