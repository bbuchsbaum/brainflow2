// This binary triggers ts-rs type generation
use api_bridge::*;
use ts_rs::TS;

fn main() {
    println!("Exporting TypeScript types from api_bridge...");
    
    // Export all types that implement TS trait
    // Using export_all() to include dependencies
    
    if let Err(e) = VolumeHandleInfo::export_all() {
        eprintln!("Failed to export VolumeHandleInfo: {}", e);
    }
    
    if let Err(e) = TimeSeriesResult::export_all() {
        eprintln!("Failed to export TimeSeriesResult: {}", e);
    }
    
    if let Err(e) = LayerGpuResources::export_all() {
        eprintln!("Failed to export LayerGpuResources: {}", e);
    }
    
    if let Err(e) = LayerSpec::export_all() {
        eprintln!("Failed to export LayerSpec: {}", e);
    }
    
    if let Err(e) = VolumeLayerSpec::export_all() {
        eprintln!("Failed to export VolumeLayerSpec: {}", e);
    }
    
    if let Err(e) = SliceAxis::export_all() {
        eprintln!("Failed to export SliceAxis: {}", e);
    }
    
    if let Err(e) = SliceIndex::export_all() {
        eprintln!("Failed to export SliceIndex: {}", e);
    }
    
    if let Err(e) = ReleaseResult::export_all() {
        eprintln!("Failed to export ReleaseResult: {}", e);
    }
    
    println!("TypeScript type export completed for api_bridge");
}