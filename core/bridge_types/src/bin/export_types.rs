// This binary triggers ts-rs type generation
use bridge_types::*;
use ts_rs::TS;

fn main() {
    println!("Exporting TypeScript types from bridge_types...");
    
    // Export all types that implement TS trait
    // Using export_all() to include dependencies
    
    if let Err(e) = BridgeError::export_all() {
        eprintln!("Failed to export BridgeError: {}", e);
    }
    
    if let Err(e) = Loaded::export_all() {
        eprintln!("Failed to export Loaded: {}", e);
    }
    
    if let Err(e) = GpuUploadError::export_all() {
        eprintln!("Failed to export GpuUploadError: {}", e);
    }
    
    if let Err(e) = GpuTextureFormat::export_all() {
        eprintln!("Failed to export GpuTextureFormat: {}", e);
    }
    
    if let Err(e) = VolumeLayerGpuInfo::export_all() {
        eprintln!("Failed to export VolumeLayerGpuInfo: {}", e);
    }
    
    if let Err(e) = FlatNode::export_all() {
        eprintln!("Failed to export FlatNode: {}", e);
    }
    
    if let Err(e) = TreePayload::export_all() {
        eprintln!("Failed to export TreePayload: {}", e);
    }
    
    if let Err(e) = SliceInfo::export_all() {
        eprintln!("Failed to export SliceInfo: {}", e);
    }
    
    if let Err(e) = TextureCoordinates::export_all() {
        eprintln!("Failed to export TextureCoordinates: {}", e);
    }
    
    if let Err(e) = DataRange::export_all() {
        eprintln!("Failed to export DataRange: {}", e);
    }
    
    if let Err(e) = LayerPatch::export_all() {
        eprintln!("Failed to export LayerPatch: {}", e);
    }
    
    println!("TypeScript type export completed for bridge_types");
}