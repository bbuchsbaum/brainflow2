// Simple command-line tool to test rendering pipeline

use std::path::PathBuf;
use clap::Parser;
use render_loop::{
    RenderLoopService, LayerInfo, BlendMode, ThresholdMode,
    FrameTimeTracker,
};
use volmath::DenseVolume3;
use nalgebra::{Vector3, Matrix4};
use image::{ImageBuffer, Rgba};

#[derive(Parser, Debug)]
#[command(author, version, about = "Test render pipeline with sample volumes")]
struct Args {
    /// Output directory for rendered images
    #[arg(short, long, default_value = ".")]
    output: PathBuf,
    
    /// Pattern to render
    #[arg(short, long, value_enum, default_value = "gradient")]
    pattern: Pattern,
    
    /// Render width
    #[arg(short = 'W', long, default_value = "256")]
    width: u32,
    
    /// Render height  
    #[arg(short = 'H', long, default_value = "256")]
    height: u32,
    
    /// Number of frames to render (for performance testing)
    #[arg(short, long, default_value = "1")]
    frames: u32,
    
    /// Colormap ID (0=gray, 1=hot, 2=cool, 3=rainbow)
    #[arg(short, long, default_value = "0")]
    colormap: u32,
}

#[derive(Debug, Clone, Copy, clap::ValueEnum)]
enum Pattern {
    Gradient,
    Sphere,
    Checkerboard,
    Cube,
    Noise,
}

/// Helper to create a volume with the given data
fn create_volume_from_data(dims: [usize; 3], data: Vec<f32>, transform: Matrix4<f32>) -> DenseVolume3<f32> {
    use volmath::space::{NeuroSpace3, NeuroSpaceImpl};
    let space_impl = NeuroSpaceImpl::from_affine_matrix4(dims, transform);
    let space = NeuroSpace3(space_impl);
    DenseVolume3::from_data(space, data)
}

fn create_volume(pattern: Pattern) -> DenseVolume3<f32> {
    match pattern {
        Pattern::Gradient => {
            let dims = [64, 64, 64];
            let mut data = vec![0.0f32; dims[0] * dims[1] * dims[2]];
            
            for z in 0..dims[2] {
                for y in 0..dims[1] {
                    for x in 0..dims[0] {
                        let idx = z * dims[0] * dims[1] + y * dims[0] + x;
                        let value = (x + y + z) as f32 / 189.0;
                        data[idx] = value * 1000.0;
                    }
                }
            }
            
            let transform = Matrix4::new_translation(&Vector3::new(-32.0, -32.0, -32.0));
            create_volume_from_data(dims, data, transform)
        }
        Pattern::Sphere => {
            let dims = [64, 64, 64];
            let mut data = vec![0.0f32; dims[0] * dims[1] * dims[2]];
            let center = 31.5;
            
            for z in 0..dims[2] {
                for y in 0..dims[1] {
                    for x in 0..dims[0] {
                        let idx = z * dims[0] * dims[1] + y * dims[0] + x;
                        let dx = x as f32 - center;
                        let dy = y as f32 - center;
                        let dz = z as f32 - center;
                        let dist = (dx * dx + dy * dy + dz * dz).sqrt();
                        if dist <= 25.0 {
                            data[idx] = 1000.0 * (1.0 - dist / 25.0);
                        } else {
                            data[idx] = 0.0;
                        }
                    }
                }
            }
            
            let transform = Matrix4::new_translation(&Vector3::new(-32.0, -32.0, -32.0));
            create_volume_from_data(dims, data, transform)
        }
        Pattern::Checkerboard => {
            let dims = [64, 64, 64];
            let mut data = vec![0.0f32; dims[0] * dims[1] * dims[2]];
            
            for z in 0..dims[2] {
                for y in 0..dims[1] {
                    for x in 0..dims[0] {
                        let idx = z * dims[0] * dims[1] + y * dims[0] + x;
                        if ((x / 8) + (y / 8) + (z / 8)) % 2 == 0 {
                            data[idx] = 1000.0;
                        } else {
                            data[idx] = 0.0;
                        }
                    }
                }
            }
            
            let transform = Matrix4::new_translation(&Vector3::new(-32.0, -32.0, -32.0));
            create_volume_from_data(dims, data, transform)
        }
        Pattern::Cube => {
            let dims = [64, 64, 64];
            let mut data = vec![0.0f32; dims[0] * dims[1] * dims[2]];
            
            for z in 0..dims[2] {
                for y in 0..dims[1] {
                    for x in 0..dims[0] {
                        let idx = z * dims[0] * dims[1] + y * dims[0] + x;
                        if x >= 16 && x < 48 && y >= 16 && y < 48 && z >= 16 && z < 48 {
                            data[idx] = 1000.0;
                        } else {
                            data[idx] = 0.0;
                        }
                    }
                }
            }
            
            let transform = Matrix4::new_translation(&Vector3::new(-32.0, -32.0, -32.0));
            create_volume_from_data(dims, data, transform)
        }
        Pattern::Noise => {
            let dims = [64, 64, 64];
            let mut data = vec![0.0f32; dims[0] * dims[1] * dims[2]];
            
            for z in 0..dims[2] {
                for y in 0..dims[1] {
                    for x in 0..dims[0] {
                        let idx = z * dims[0] * dims[1] + y * dims[0] + x;
                        // Simple pseudo-random noise
                        let hash = ((x * 73 + y * 179 + z * 283) % 1000) as f32;
                        data[idx] = hash;
                    }
                }
            }
            
            let transform = Matrix4::new_translation(&Vector3::new(-32.0, -32.0, -32.0));
            create_volume_from_data(dims, data, transform)
        }
    }
}

async fn render_views(
    service: &mut RenderLoopService,
    layer: LayerInfo,
    _transform: Matrix4<f32>,
    args: &Args,
    tracker: &mut FrameTimeTracker,
) -> Result<(), Box<dyn std::error::Error>> {
    let views = vec![
        ("axial", [64.0, 0.0, 0.0, 0.0], [0.0, 64.0, 0.0, 0.0]),
        ("coronal", [64.0, 0.0, 0.0, 0.0], [0.0, 0.0, 64.0, 0.0]),
        ("sagittal", [0.0, 64.0, 0.0, 0.0], [0.0, 0.0, 64.0, 0.0]),
    ];
    
    // Add layer using public API
    service.clear_render_layers();
    service.add_render_layer(layer.atlas_index, layer.opacity, layer.texture_coords)?;
    
    for (view_name, u_vec, v_vec) in views {
        println!("Rendering {} view...", view_name);
        
        service.update_frame_ubo(
            [0.0, 0.0, 0.0, 1.0],
            u_vec,
            v_vec,
        );
        
        let start = std::time::Instant::now();
        let rendered = service.render_to_buffer()?;
        tracker.record_duration(start.elapsed());
        
        // Save image
        let filename = format!("{}_{}.png", args.pattern.to_string().to_lowercase(), view_name);
        let path = args.output.join(filename);
        
        let img = ImageBuffer::<Rgba<u8>, _>::from_raw(args.width, args.height, rendered)
            .ok_or("Failed to create image buffer")?;
        img.save(&path)?;
        
        println!("  Saved: {}", path.display());
    }
    
    Ok(())
}

async fn run(args: Args) -> Result<(), Box<dyn std::error::Error>> {
    println!("Initializing render service...");
    let mut service = RenderLoopService::new().await?;
    
    println!("Creating {} volume...", args.pattern.to_string());
    let volume = create_volume(args.pattern);
    
    println!("Uploading to GPU...");
    let (handle, transform) = service.upload_volume_3d(&volume)?;
    
    let layer = LayerInfo {
        atlas_index: handle,
        opacity: 1.0,
        blend_mode: BlendMode::Normal,
        colormap_id: args.colormap,
        intensity_range: (0.0, 1000.0),
        threshold_range: (-f32::INFINITY, f32::INFINITY),
        threshold_mode: ThresholdMode::Range,
        texture_coords: (0.0, 0.0, 1.0, 1.0),
        is_mask: false,
    };
    
    let mut tracker = FrameTimeTracker::new(100);
    
    if args.frames == 1 {
        // Single frame mode - render all views
        render_views(&mut service, layer, transform, &args, &mut tracker).await?;
    } else {
        // Performance test mode - render multiple frames
        println!("Running performance test with {} frames...", args.frames);
        
        // Add layer using public API
    service.clear_render_layers();
    service.add_render_layer(layer.atlas_index, layer.opacity, layer.texture_coords)?;
        
        for frame in 0..args.frames {
            let angle = frame as f32 * 0.05;
            let distance = 50.0;
            
            service.update_frame_ubo(
                [angle.cos() * distance, angle.sin() * distance, 0.0, 1.0],
                [64.0, 0.0, 0.0, 0.0],
                [0.0, 64.0, 0.0, 0.0],
            );
            
            let start = std::time::Instant::now();
            let _ = service.render_to_buffer()?;
            tracker.record_duration(start.elapsed());
            
            if frame % 10 == 0 {
                print!(".");
                use std::io::Write;
                std::io::stdout().flush().ok();
            }
        }
        println!();
    }
    
    // Print performance summary
    println!("\nPerformance Summary:");
    println!("{}", tracker.summary());
    
    Ok(())
}

fn main() {
    let args = Args::parse();
    
    // Create output directory if needed
    if !args.output.exists() {
        std::fs::create_dir_all(&args.output)
            .expect("Failed to create output directory");
    }
    
    let runtime = tokio::runtime::Runtime::new()
        .expect("Failed to create tokio runtime");
    
    match runtime.block_on(run(args)) {
        Ok(_) => println!("\nSuccess!"),
        Err(e) => {
            eprintln!("\nError: {}", e);
            std::process::exit(1);
        }
    }
}

// Extension trait for Pattern
impl ToString for Pattern {
    fn to_string(&self) -> String {
        match self {
            Pattern::Gradient => "gradient",
            Pattern::Sphere => "sphere", 
            Pattern::Checkerboard => "checkerboard",
            Pattern::Cube => "cube",
            Pattern::Noise => "noise",
        }.to_string()
    }
}