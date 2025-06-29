use std::{fs, path::Path};

fn main() {
    // For wgpu 0.20, we'll use a simpler approach:
    // 1. Track shader files for rebuild
    // 2. Generate a simple module that loads shaders at runtime
    
    let shader_dir = Path::new("shaders");
    println!("cargo:rerun-if-changed={}", shader_dir.display());
    
    // Track individual shader files
    if let Ok(entries) = fs::read_dir(shader_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "wgsl") {
                println!("cargo:rerun-if-changed={}", path.display());
            }
        }
    }
    
    // For now, we'll use runtime shader loading instead of build-time compilation
    // This is compatible with wgpu 0.20 and doesn't require wgsl_to_wgpu
    // NOTE: wgsl_to_wgpu may now support wgpu 0.25 - see memory-bank/TODO_wgsl_to_wgpu_revisit.md
    // Consider revisiting after MVP is complete for compile-time validation benefits
    println!("cargo:warning=Using runtime shader loading for wgpu 0.20 compatibility");
} 