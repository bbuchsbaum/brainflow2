use bridge_types::{BridgeResult, Loaded};
use log::debug;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, OnceLock};

// --- Loader Trait (Re-exported or Defined) ---
// Assuming the Loader trait is defined in bridge_types as planned.
// If not, it should be defined here.
pub use bridge_types::Loader;

// --- Loader Implementations ---
// Import concrete loader types. Each loader should live in its own crate/module.
// Assuming nifti_loader is a sibling crate in the workspace.
use nifti_loader::NiftiLoader;
// Example: use gifti_loader::GiftiLoader;

// --- Type Aliases for Function Pointers ---
type CanLoadFn = fn(&Path) -> bool;
type LoadFn = fn(&Path) -> BridgeResult<Loaded>;

// --- Loader Registry Struct ---
#[derive(Default)]
pub struct LoaderRegistry {
    // Store loaders keyed by a unique identifier (e.g., name or file extension hint)
    // For simplicity, store function pointers directly.
    // Could store Box<dyn Loader> if stateful loaders were needed.
    loaders: HashMap<String, (CanLoadFn, LoadFn)>,
}

impl LoaderRegistry {
    /// Creates a new, empty loader registry.
    pub fn new() -> Self {
        Self {
            loaders: HashMap::new(),
        }
    }

    /// Registers a loader implementation using its static methods.
    /// Uses a simple identifier (e.g., "nifti") as the key.
    pub fn register<L: Loader + 'static>(&mut self, id: &str) {
        debug!("Registering loader: {}", id);
        self.loaders.insert(id.to_string(), (L::can_load, L::load));
    }

    /// Finds the appropriate load function for a given path.
    /// Returns the first matching loader's load function.
    pub fn find_loader_for(&self, path: &Path) -> Option<LoadFn> {
        self.loaders
            .values()
            .find(|(can_load_fn, _)| can_load_fn(path))
            .map(|(_, load_fn)| *load_fn)
    }

    /// Checks if any registered loader can handle the path.
    pub fn is_loadable(&self, path: &Path) -> bool {
        self.loaders
            .values()
            .any(|(can_load_fn, _)| can_load_fn(path))
    }
}

// --- Static Registry Instance ---
// Use OnceLock for safe static initialization.
static LOADER_REGISTRY: OnceLock<Arc<LoaderRegistry>> = OnceLock::new();

/// Initializes and returns a reference to the global loader registry.
/// Registers loaders on first call.
pub fn get_registry() -> &'static Arc<LoaderRegistry> {
    LOADER_REGISTRY.get_or_init(|| {
        let mut registry = LoaderRegistry::new();
        // Register known loaders here
        registry.register::<NiftiLoader>("nifti");
        // registry.register::<GiftiLoader>("gifti"); // Example
        Arc::new(registry)
    })
}

// --- Public API Functions ---

/// Checks if any registered loader can handle a path using the global registry.
pub fn is_loadable(path: &Path) -> bool {
    get_registry().is_loadable(path)
}

/// Finds the appropriate load function for a given path using the global registry.
pub fn find_loader_for(path: &Path) -> Option<LoadFn> {
    get_registry().find_loader_for(path)
}

// --- Removed Old Static Array ---
// /// Compile-time registration of loader `can_load` functions.
// static CAN_LOAD_FNS: &[CanLoadFn] = &[
//     NiftiLoader::can_load,
//     // Example: GiftiLoader::can_load,
//     // Add other loaders here as they are created and implement the Loader trait.
// ];

// // Remove old is_loadable implementation
// /// Checks if any registered loader can handle a path using static lookup.
// /// This avoids runtime registry lookups for simple capability checks.
// pub fn is_loadable(path: &Path) -> bool {
//     CAN_LOAD_FNS.iter().any(|can_load_fn| can_load_fn(path))
// }

// // Remove old find_loader_for placeholder
// // Placeholder function to find the *first* matching loader's `load` function.
// // This would be used if a command needs to dispatch the actual load operation.
// // Requires careful handling of types and errors.
// // pub fn find_loader_for(path: &Path) -> Option<fn(&Path) -> BridgeResult<Loaded>> {
// //     if NiftiLoader::can_load(path) {
//         Some(NiftiLoader::load) // Assuming load is callable like this, needs review
//     }
//     // else if GiftiLoader::can_load(path) {
//     //     Some(GiftiLoader::load)
//     // }
//     else {
//         None
//     }
// }
