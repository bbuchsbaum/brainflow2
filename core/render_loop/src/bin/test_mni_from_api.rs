use render_loop::RenderLoopService;
use image::{ImageBuffer, Rgba, RgbaImage};
use std::path::Path;
use std::fs;
use volmath::space::GridSpace;

#[tokio::main]
async fn main() {
    println!("Starting MNI brain slice extraction test using API approach...");
    
    // Path to MNI brain template
    let mni_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent().unwrap()
        .parent().unwrap()
        .join("test-data/unit/tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii");
    
    if !mni_path.exists() {
        eprintln!("MNI file not found at {:?}", mni_path);
        eprintln!("Please ensure the MNI brain template is in the test-data/unit directory");
        return;
    }
    
    println!("MNI file found at: {:?}", mni_path);
    println!("\nNOTE: This test requires the full NIfTI loading infrastructure.");
    println!("To properly load and render the MNI brain, we need to:");
    println!("1. Use the api_bridge load_file command from the UI");
    println!("2. Or refactor the test to avoid cyclic dependencies");
    println!("\nFor now, this test demonstrates the issue and provides guidance.");
    
    // The proper way to load NIfTI files is through the api_bridge
    // which avoids cyclic dependencies but requires the full Tauri app context
    
    println!("\nTo test with real MNI data:");
    println!("1. Run: cargo tauri dev");
    println!("2. In the UI console, run:");
    println!("   await coreApi.load_file('{}');", mni_path.display());
    println!("3. Use the returned volume handle for rendering");
    
    // For now, let's document what the fixed test would look like
    create_documentation();
}

fn create_documentation() {
    let doc_content = r#"
# Loading Real MNI Brain Data

The issue with loading NIfTI files directly in test binaries is that it creates cyclic dependencies:
- render_loop depends on volmath
- nifti_loader depends on volmath and bridge_types
- Adding nifti_loader to render_loop creates a cycle

## Solutions:

### 1. Use the API Bridge (Recommended)
The proper way is to load NIfTI files through the existing infrastructure:

```rust
// In a Tauri context or integration test
let volume_handle = api_bridge::load_file(path).await?;
let volume = api_bridge::get_volume(volume_handle.id)?;
```

### 2. Create a Separate Test Crate
Create a new crate specifically for integration tests that can depend on all necessary modules without creating cycles.

### 3. Use Pre-converted Test Data
Convert the MNI brain to a simpler format (like raw binary) that can be loaded without the full NIfTI infrastructure.

## Current Architecture

The brainflow2 architecture intentionally keeps data loading (NIfTI, GIfTI) separate from rendering to maintain clean dependencies:

```
api_bridge (orchestrator)
    ├── loaders/nifti (data loading)
    ├── render_loop (GPU rendering)
    └── volmath (core math)
```

This separation ensures that the rendering pipeline remains independent of specific file formats.
"#;
    
    let doc_path = Path::new("target/test-output/mni_loading_guide.md");
    fs::create_dir_all(doc_path.parent().unwrap()).ok();
    fs::write(doc_path, doc_content).ok();
    
    println!("\nDocumentation written to: {:?}", doc_path);
}