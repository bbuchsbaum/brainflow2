// Direct test of colormap module
fn main() {
    // Test if we can access the colormap crate
    match std::process::Command::new("cargo")
        .args(&["metadata", "--format-version", "1"])
        .output() 
    {
        Ok(output) => {
            let metadata = String::from_utf8_lossy(&output.stdout);
            if metadata.contains("colormap") {
                println!("Found colormap crate in dependencies");
            } else {
                println!("colormap crate not found in dependencies");
            }
        }
        Err(e) => println!("Failed to run cargo metadata: {}", e),
    }
    
    // Check if colormap is a local crate
    if std::path::Path::new("core/colormap").exists() {
        println!("Found local colormap crate at core/colormap");
    } else {
        println!("No local colormap crate found");
    }
}