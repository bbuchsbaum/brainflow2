//! High-performance colormap system for neuroimaging visualization
//! 
//! This crate provides compile-time optimized colormaps with zero runtime overhead
//! for builtin colormaps and efficient custom colormap support.

pub mod data;
pub mod metadata;

use phf::phf_map;

// Re-export key types
pub use data::{BuiltinColormap, BUILTIN_COLORMAPS};
pub use metadata::{ColormapInfo, ColormapCategory, ColormapFlags, COLORMAP_INFO};

/// Compile-time string to colormap ID mapping
static COLORMAP_NAMES: phf::Map<&'static str, BuiltinColormap> = phf_map! {
    "grayscale" => BuiltinColormap::Grayscale,
    "grey" => BuiltinColormap::Grayscale,
    "gray" => BuiltinColormap::Grayscale,
    "viridis" => BuiltinColormap::Viridis,
    "hot" => BuiltinColormap::Hot,
    "cool" => BuiltinColormap::Cool,
    "plasma" => BuiltinColormap::Plasma,
    "inferno" => BuiltinColormap::Inferno,
    "magma" => BuiltinColormap::Magma,
    "turbo" => BuiltinColormap::Turbo,
    "pet" => BuiltinColormap::PetHotMetal,
    "pet_hot_metal" => BuiltinColormap::PetHotMetal,
    "fmri" => BuiltinColormap::FmriRedBlue,
    "activation" => BuiltinColormap::FmriRedBlue,
    "jet" => BuiltinColormap::Jet,
    "parula" => BuiltinColormap::Parula,
    "hsv" => BuiltinColormap::Hsv,
    "phase" => BuiltinColormap::Phase,
};

/// Fast lookup by name - O(1) at runtime
#[inline]
pub fn colormap_by_name(name: &str) -> Option<BuiltinColormap> {
    COLORMAP_NAMES.get(name).copied()
}

/// Get colormap data by ID - zero cost
#[inline]
pub fn colormap_data(id: BuiltinColormap) -> &'static [[u8; 4]; 256] {
    id.data()
}

/// Custom colormap support
pub mod custom {
    use std::collections::HashMap;
    
    /// Custom colormaps stored in a fixed-size arena
    pub struct CustomColormapArena {
        /// Fixed storage for custom colormaps
        storage: Box<[[[u8; 4]; 256]; 16]>,
        /// Which slots are occupied (bit mask)
        occupied: u16,
        /// Name to slot mapping
        names: HashMap<String, u8>,
    }
    
    impl CustomColormapArena {
        pub fn new() -> Self {
            Self {
                storage: Box::new([[[0; 4]; 256]; 16]),
                occupied: 0,
                names: HashMap::new(),
            }
        }
        
        /// Add custom colormap - returns slot index
        pub fn add(&mut self, name: String, data: [[u8; 4]; 256]) -> Result<u8, &'static str> {
            // Find free slot
            let slot = self.occupied.trailing_ones();
            if slot >= 16 {
                return Err("No free custom colormap slots");
            }
            
            // Copy data
            self.storage[slot as usize] = data;
            self.occupied |= 1 << slot;
            self.names.insert(name, slot as u8);
            
            Ok(slot as u8 + 16) // Offset by 16 for GPU indexing
        }
        
        /// Get custom colormap data
        #[inline]
        pub fn get(&self, slot: u8) -> Option<&[[u8; 4]; 256]> {
            if slot < 16 && (self.occupied & (1 << slot)) != 0 {
                Some(&self.storage[slot as usize])
            } else {
                None
            }
        }
        
        /// Get slot by name
        #[inline]
        pub fn get_slot(&self, name: &str) -> Option<u8> {
            self.names.get(name).copied()
        }
        
        /// Clear all custom colormaps
        pub fn clear(&mut self) {
            self.occupied = 0;
            self.names.clear();
        }
    }
    
    impl Default for CustomColormapArena {
        fn default() -> Self {
            Self::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_colormap_lookup() {
        assert_eq!(colormap_by_name("grayscale"), Some(BuiltinColormap::Grayscale));
        assert_eq!(colormap_by_name("viridis"), Some(BuiltinColormap::Viridis));
        assert_eq!(colormap_by_name("gray"), Some(BuiltinColormap::Grayscale));
        assert_eq!(colormap_by_name("unknown"), None);
    }
    
    #[test]
    fn test_colormap_data() {
        let gray = colormap_data(BuiltinColormap::Grayscale);
        assert_eq!(gray[0], [0, 0, 0, 255]);
        assert_eq!(gray[255], [255, 255, 255, 255]);
    }
}