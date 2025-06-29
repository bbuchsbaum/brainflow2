// crates/volmath/src/traits.rs
use crate::space::GridSpace;
use crate::dense_vol::{VoxelData, DataRange};
use crate::NeuroSpace3; // Assuming we might need concrete types for DynVolume
use crate::NumericType;
// Remove unused import
// use crate::NumericType; // Make sure NumericType is imported or defined here
// Import NumericType if defining VolumeHandle here
// use api_bridge::NumericType; // Or define NumericType locally/in volmath

// --- Volume Trait ---

/// Generic, dimension-aware view of *anything* that can answer
/// "What value is at this integer grid coordinate?"
///
/// * `const D` – dimensionality (2 / 3 / 4) decided at compile-time
/// * Associated `Scalar` allows heterogeneous numeric back-ends
///
/// **NO assumption** about storage layout (dense, chunked, sparse).
pub trait Volume<const D: usize>: Send + Sync {
    /// Scalar voxel type (u8, f32 …)
    type Scalar: VoxelData + DataRange<Self::Scalar>; // Use bounds from proposal
    /// Geometry (dims, affine) — any type implementing `GridSpace<D>`
    type Space: GridSpace<D>;

    //----------------------------------------
    // *cheap* introspection
    //----------------------------------------
    /// Get a reference to the underlying GridSpace
    fn space(&self) -> &Self::Space;

    /// Get dimensions directly from space. Requires Space to be Sized.
    // Note: GridSpace::dims() returns &[usize], which requires a lifetime.
    // If we want to return an owned array [usize; D], GridSpace needs modification
    // or we constrain Space here. Returning the slice via space() is safer for now.
    // #[inline] fn dims(&self) -> [usize; D] { self.space().dims() }

    /// Get total voxel count directly from space.
    #[inline]
    fn voxel_count(&self) -> usize {
        self.space().voxel_count()
    }

    /// Get voxel type information
    fn voxel_type(&self) -> NumericType;

    //----------------------------------------
    // mandatory accessors
    //----------------------------------------
    /// Random access by integer grid index; `None` if OOB / missing.
    fn get(&self, ijk: &[usize; D]) -> Option<Self::Scalar>;

    //----------------------------------------
    // optional fast paths — default = "not supported"
    //----------------------------------------
    /// **Dense** back‐ends override to expose their flat buffer as raw bytes.
    fn as_bytes(&self) -> Option<&[u8]> {
        None
    }

    /// Bulk sampling: fill `out` with a slice along the fastest axis (usually X).
    /// Dense impl should override for memcpy; sparse impl might loop using get().
    /// Returns true on success, false if coords are OOB or slice length mismatches.
    fn slice_fast_axis(&self, fixed: &[usize], out: &mut [Self::Scalar]) -> bool {
        // Default implementation using get()
        if fixed.len() != D - 1 { // Add runtime check for fixed coordinates length
            // Consider logging a warning or returning an error specific to incorrect input length
            return false; 
        }
        let mut current_coords = [0; D];
        let fast_axis_len = self.space().dims().get(0).copied().unwrap_or(0);
        if fast_axis_len != out.len() { return false; } // Check length match

        // Copy fixed coordinates
        for i in 0..(D - 1) {
            current_coords[i + 1] = fixed[i];
        }
        
        // Check bounds for fixed coordinates (assuming D >= 1)
        let dims = self.space().dims();
        for i in 1..D {
            if current_coords[i] >= dims[i] { return false; }
        }

        // Loop along the fast axis (axis 0)
        for i in 0..fast_axis_len {
            current_coords[0] = i;
            if let Some(val) = self.get(&current_coords) {
                out[i] = val;
            } else {
                // If get() returns None for any voxel in the slice, maybe return false?
                // Or fill with default? For now, assume get() succeeds if bounds are ok.
                return false; 
            }
        }
        true
    }
}

// --- Dynamic Dispatch Alias ---

/// Type alias for a dynamically dispatched 3D volume with f32 scalar type.
pub type DynVolumeF32 = dyn Volume<3, Scalar = f32, Space = NeuroSpace3> + Send + Sync + 'static;
// Add other aliases (e.g., DynVolumeI16) if needed

// --- Volume Handle Trait (API Facing) ---

/// Trait representing metadata and basic access for a loaded volume,
/// suitable for use across the application (e.g., in UI state, registries).
/// This provides a stable API facade over potentially different Volume<D> impls.
pub trait VolumeHandle<const D: usize>: Send + Sync {
    /// Get the unique identifier for this volume resource.
    fn id(&self) -> &str;

    /// Get the underlying voxel data type.
    fn voxel_type(&self) -> NumericType;

    /// Get the min/max range of the voxel data (potentially computed).
    fn range(&self) -> [f32; 2]; // Use f32 for API consistency

    /// Get a dynamic reference to the volume's GridSpace.
    fn space(&self) -> &dyn GridSpace<D>;
    
    // Consider adding a method to get the actual Volume<D> object if needed,
    // but might require locking/Arc<Mutex> depending on storage.
    // fn get_volume_accessor(&self) -> Result<Arc<dyn Volume<D, ...>>, AccessError>;
}

// Example placeholder implementation (replace with real one later)
// pub struct VolumeHandleImpl {
//     id: String,
//     vol_ref: Arc<DynVolumeF32>, // Example: Holds Arc to the trait object
// }
//
// impl VolumeHandle<3> for VolumeHandleImpl {
//     fn id(&self) -> &str { &self.id }
//     fn voxel_type(&self) -> NumericType { NumericType::F32 } // Assuming f32 here
//     fn range(&self) -> [f32; 2] {
//         // Need access to the underlying data or cached range
//         // This highlights the need for the Volume trait to potentially provide range()
//         // or for the VolumeHandle to store it.
//         // Let's assume DataRange is on Scalar and accessible via Volume.
//         // This requires a method to get the Volume object back, which is tricky.
//         // Alternative: Store range in the handle itself during creation.
//         [0.0, 0.0] // Placeholder
//     }
//     fn space(&self) -> &dyn GridSpace<3> { self.vol_ref.space() }
// } 