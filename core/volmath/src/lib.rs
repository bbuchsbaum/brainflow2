// Re-export only the necessary public types/modules for Phase 1
pub mod axis;
pub mod space;
pub mod dense_vol;
pub mod traits;
pub mod view_frame;
// pub mod accel; // Uncomment when KD-tree is added

// Re-export core types
pub use space::{NeuroSpace2, NeuroSpace3, NeuroSpace4};
pub use dense_vol::{DenseSlice, DenseVolume3, DenseVolume4, VoxelData, VolumeF32_3D, VolumeI16_3D, VolumeU8_3D}; // Renamed DenseVolume2 -> DenseSlice
pub use traits::{Volume, VolumeHandle, DynVolumeF32}; // Don't re-export NumericType from traits
pub use axis::{AxisName, NamedAxis, AxisSet3D};
// Re-export DataRange
pub use dense_vol::DataRange;
// Re-export view frame types
pub use view_frame::{ViewFrame, Viewport, Plane, VolumeMeta as ViewVolumeMeta, RenderLayer, 
                     make_frame, screen_to_world, world_to_screen, calculate_field_of_view};

// Import key dependencies for reuse in downstream crates
use serde::{Serialize, Deserialize};
use ts_rs::TS;
use std::any::TypeId;

// Error types 
#[derive(Debug, Serialize, Deserialize, TS, thiserror::Error)]
#[ts(export, export_to = "../../packages/api/src/generated/volmath.ts")]
pub enum VolumeMathError {
    #[error("Invalid axis specification")]
    InvalidAxis,
    #[error("Invalid dimension")]
    InvalidDimension,
    #[error("Index out of bounds")]
    OutOfBounds,
    #[error("Invalid transform matrix")]
    InvalidTransform,
    #[error("No data available")]
    NoData,
}

// Moved from traits.rs
// Ensure this matches the definition needed by bridge_types and api_bridge
// Add Serialize/Deserialize if needed for bridge_types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)] 
#[ts(export, export_to = "../../packages/api/src/generated/volmath.ts")]
pub enum NumericType { 
    F32, I16, U8, I8, U16, I32, U32, F64 
}

impl NumericType {
    // Placeholder implementation - map TypeId to enum variant
    // Requires T: 'static
    pub fn from_typeid<T: 'static>() -> Self {
        let type_id = TypeId::of::<T>();
        if type_id == TypeId::of::<f32>() { NumericType::F32 }
        else if type_id == TypeId::of::<i16>() { NumericType::I16 }
        else if type_id == TypeId::of::<u8>() { NumericType::U8 }
        else if type_id == TypeId::of::<i8>() { NumericType::I8 }
        else if type_id == TypeId::of::<u16>() { NumericType::U16 }
        else if type_id == TypeId::of::<i32>() { NumericType::I32 }
        else if type_id == TypeId::of::<u32>() { NumericType::U32 }
        else if type_id == TypeId::of::<f64>() { NumericType::F64 }
        else {
            // Decide on behavior for unknown types - panic? default? dedicated variant?
            panic!("Unsupported type for NumericType::from_typeid");
        }
    }
}

// A 3D point in space
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../packages/api/src/generated/volmath.ts")]
pub struct Point3D {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Point3D {
    pub fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z }
    }
    
    pub fn distance(&self, other: &Point3D) -> f64 {
        ((self.x - other.x).powi(2) + 
         (self.y - other.y).powi(2) + 
         (self.z - other.z).powi(2)).sqrt()
    }
}

// Simple example function for testing
pub fn add(left: u64, right: u64) -> u64 {
    left + right
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_works() {
        let result = add(2, 2);
        assert_eq!(result, 4);
    }
    
    #[test]
    fn test_point_distance() {
        let p1 = Point3D::new(0.0, 0.0, 0.0);
        let p2 = Point3D::new(1.0, 1.0, 1.0);
        assert_eq!(p1.distance(&p2), 3.0_f64.sqrt());
    }
}

// --- WASM Bindgen Tests ---
#[cfg(test)]
mod wasm_tests {
    use wasm_bindgen_test::*;

    // Initialize wasm-bindgen-test logging
    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    fn pass() {
        assert_eq!(1 + 1, 2);
    }

    // Optional: Add a test using console_error_panic_hook
    #[wasm_bindgen_test]
    fn setup_panic_hook() {
        // Optional: Sets up better panic messages in the JS console
        console_error_panic_hook::set_once();
        // You could add a test that panics here if needed
        // panic!("Testing panic hook!"); 
        assert!(true); // Just assert true to pass
    }
}
