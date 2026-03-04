// Simple test to load the cached template file directly
use std::path::Path;

fn main() {
    // Enable logging
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    // Path to the cached template
    let cache_path = Path::new("/Users/bbuchsbaum/Library/Caches/com.brainflow.dev/templates/MNI152NLin2009cAsym_T1w_1mm.nii.gz");

    println!("=== TESTING TEMPLATE LOADING ===");
    println!("Cache file path: {}", cache_path.display());
    println!("File exists: {}", cache_path.exists());

    if cache_path.exists() {
        // Check file metadata
        match std::fs::metadata(cache_path) {
            Ok(metadata) => {
                println!("File size: {} bytes", metadata.len());
                println!("Is file: {}", metadata.is_file());
            }
            Err(e) => println!("Failed to get metadata: {}", e),
        }

        // Try to decompress and create .nii version
        println!("\n--- Testing decompression ---");
        let mut nii_path = cache_path.to_path_buf();
        nii_path.set_extension(""); // Remove .gz -> .nii
        println!("Uncompressed path would be: {}", nii_path.display());

        if nii_path.exists() {
            println!("Uncompressed file already exists");
            match std::fs::metadata(&nii_path) {
                Ok(metadata) => {
                    println!("Uncompressed file size: {} bytes", metadata.len());
                }
                Err(e) => println!("Failed to get uncompressed file metadata: {}", e),
            }
        } else {
            println!("Uncompressed file does not exist, would need to create it");
        }

        // Try loading with neuroim directly (this is what the loader uses)
        println!("\n--- Testing neuroim header read (.nii.gz) ---");
        match neuroim::io::read_header(cache_path) {
            Ok(header) => {
                println!("✓ Successfully read header from .nii.gz!");
                println!("  Dimensions: {:?}", header.dim);
                println!("  Data type: {:?}", header.datatype);
                println!("  Voxel spacing: {:?}", header.spacing);
            }
            Err(e) => {
                println!("✗ Failed to read header from .nii.gz: {}", e);
            }
        }

        // Try loading as f32 (most common type)
        println!("\n--- Testing neuroim volume load (f32, .nii.gz) ---");
        match neuroim::io::read_vol_as::<f32>(cache_path, 0) {
            Ok(vol) => {
                println!("✓ Successfully loaded .nii.gz as f32!");
                println!("  Volume dimensions: {:?}", vol.space().dim);
            }
            Err(e) => {
                println!("✗ Failed to load .nii.gz as f32: {}", e);
                println!("  Error details: {:?}", e);
            }
        }

        // Try the loader's auto-detect function
        println!("\n--- Testing nifti_loader::load_nifti_volume_auto (.nii.gz) ---");
        match nifti_loader::load_nifti_volume_auto(cache_path) {
            Ok((_volume, _affine)) => {
                println!("✓ Successfully loaded .nii.gz with load_nifti_volume_auto!");
            }
            Err(e) => {
                println!("✗ Failed with load_nifti_volume_auto on .nii.gz: {}", e);
                println!("  Error details: {:?}", e);
            }
        }

        // Try the auto-dimension function used by template service
        println!("\n--- Testing nifti_loader::load_nifti_auto_dimension (.nii.gz) ---");
        match nifti_loader::load_nifti_auto_dimension(cache_path) {
            Ok(_volume) => {
                println!("✓ Successfully loaded .nii.gz with load_nifti_auto_dimension!");
            }
            Err(e) => {
                println!("✗ Failed with load_nifti_auto_dimension on .nii.gz: {}", e);
                println!("  Error details: {:?}", e);
            }
        }

        // If .nii version exists, test it too
        if nii_path.exists() {
            println!("\n=== TESTING UNCOMPRESSED .nii FILE ===");

            println!("\n--- Testing neuroim header read (.nii) ---");
            match neuroim::io::read_header(&nii_path) {
                Ok(header) => {
                    println!("✓ Successfully read header from .nii!");
                    println!("  Dimensions: {:?}", header.dim);
                    println!("  Data type: {:?}", header.datatype);
                }
                Err(e) => {
                    println!("✗ Failed to read header from .nii: {}", e);
                }
            }

            println!("\n--- Testing nifti_loader::load_nifti_auto_dimension (.nii) ---");
            match nifti_loader::load_nifti_auto_dimension(&nii_path) {
                Ok(_volume) => {
                    println!("✓ Successfully loaded .nii with load_nifti_auto_dimension!");
                }
                Err(e) => {
                    println!("✗ Failed with load_nifti_auto_dimension on .nii: {}", e);
                    println!("  Error details: {:?}", e);
                }
            }
        }

    } else {
        println!("ERROR: Cache file does not exist!");
    }

    println!("\n=== TEST COMPLETE ===");
}
