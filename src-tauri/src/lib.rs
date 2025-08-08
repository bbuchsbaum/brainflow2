use api_bridge::{BridgeState, SurfaceRegistry};
use atlases::AtlasService;
use templates::TemplateService;
use log::{error, info};
use nifti_loader::NiftiLoader;
use raw_window_handle::{HasDisplayHandle, HasWindowHandle};
use render_loop::RenderLoopService;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Manager, Runtime, State};
use tokio::sync::Mutex as TokioMutex;
// --- Add tracing imports ---
use tracing::Instrument;
use tracing_log::LogTracer;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

// Define structures for our domain
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VolumeInfo {
    id: String,
    name: String,
    dimensions: [usize; 3],
    voxel_size: [f32; 3],
    data_type: String,
}

// Global state management
pub struct AppState {
    loaded_volumes: Mutex<HashMap<String, VolumeInfo>>,
}

// Learn more about Tauri commands at https://tauri.app/v1/guides/features/command
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// List all currently loaded volumes
#[tauri::command]
fn list_volumes(state: State<AppState>) -> Result<Vec<VolumeInfo>, String> {
    let volumes = state.loaded_volumes.lock().map_err(|e| e.to_string())?;
    Ok(volumes.values().cloned().collect())
}

/// Check if a file can be loaded (placeholder for real implementation)
#[tauri::command]
fn can_load_file(file_path: &str) -> Result<bool, String> {
    let path = PathBuf::from(file_path);

    // Check file extension (simplistic implementation)
    if let Some(ext) = path.extension() {
        let ext_str = ext.to_string_lossy().to_lowercase();
        if ext_str == "nii" || ext_str == "gz" || ext_str == "gii" {
            return Ok(true);
        }
    }

    Ok(false)
}

/// Simulate loading a volume (placeholder for real implementation)
#[tauri::command]
fn load_volume(file_path: &str, state: State<AppState>) -> Result<VolumeInfo, String> {
    let path = PathBuf::from(file_path);

    // Create a dummy volume info based on filename
    let filename = path
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown.nii".to_string());

    let id = uuid::Uuid::new_v4().to_string();
    let volume_info = VolumeInfo {
        id: id.clone(),
        name: filename,
        dimensions: [64, 64, 64],         // Dummy dimensions
        voxel_size: [1.0, 1.0, 1.0],      // Dummy voxel size
        data_type: "float32".to_string(), // Dummy data type
    };

    // Store in our state
    let mut volumes = state.loaded_volumes.lock().map_err(|e| e.to_string())?;
    volumes.insert(id, volume_info.clone());

    Ok(volume_info)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize basic app state (placeholder)
    let app_state = AppState {
        loaded_volumes: Mutex::new(HashMap::new()),
    };

    // Shared state setup is deferred until after RenderLoopService initialization
    let volume_registry_arc = Arc::new(TokioMutex::new(api_bridge::VolumeRegistry::new()));
    let layer_map_arc = Arc::new(TokioMutex::new(HashMap::<String, u32>::new()));

    tauri::Builder::default()
        .setup(move |app| { // Use move to capture state variables
            let app_handle = app.handle().clone();

            // --- Setup Tracing --- 
            // 1. Bridge tracing events to the log crate
            LogTracer::init().expect("Failed to set logger");

            // 2. Configure tracing_subscriber for terminal output
            let filter = EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,brainflow=debug,render_loop=trace")); // Adjust default filter as needed
            let fmt_layer = fmt::layer() // Terminal logging
                .with_target(true)
                .with_line_number(true)
                .with_file(true);

            tracing_subscriber::registry()
                .with(filter)
                .with(fmt_layer) // Only configure the terminal layer here
                // Remove the explicit JSON layer and writer setup
                // .with(tracing_subscriber::fmt::layer().json().with_writer(logger_writer))
                .init();
                 
            // Use tracing::info! after initialization
            tracing::info!("Tracing subscriber initialized for terminal output.");

            // --- Initialize RenderLoopService & Surface Asynchronously ---
            // We run this in a separate async task to avoid blocking the setup thread.
            // The BridgeState with the initialized service is managed later.
            let volume_registry = volume_registry_arc.clone();
            let layer_to_atlas_map = layer_map_arc.clone();

            // Example of using tracing within setup
            tracing::debug!(app_name = %app.package_info().name, "App setup started");

            tauri::async_runtime::spawn(
                // Don't create span inside the async block
                async move {
                    // Remove internal span creation: 
                    // let _span = tracing::info_span!("RenderLoopInit").entered();
                    tracing::info!("Initializing RenderLoopService...");
                    match RenderLoopService::new().await {
                        Ok(service) => {
                            tracing::info!("RenderLoopService initialized successfully.");
                            
                            // No surface creation needed - we're using offscreen rendering
                            // The frontend will call create_offscreen_render_target when ready

                            // Create the final BridgeState with the initialized service
                            let cache_dir = std::env::temp_dir().join("brainflow");
                            let atlas_service = match AtlasService::new(cache_dir.clone()) {
                                Ok(service) => Arc::new(TokioMutex::new(service)),
                                Err(e) => {
                                    tracing::error!("Failed to initialize atlas service: {}", e);
                                    return;
                                }
                            };
                            let template_service = match TemplateService::new(cache_dir) {
                                Ok(service) => Arc::new(TokioMutex::new(service)),
                                Err(e) => {
                                    tracing::error!("Failed to initialize template service: {}", e);
                                    return;
                                }
                            };
                            
                            let bridge_state = BridgeState::new(
                                volume_registry.clone(),
                                Arc::new(TokioMutex::new(SurfaceRegistry::new())),
                                Arc::new(TokioMutex::new(Some(Arc::new(TokioMutex::new(service))))),
                                layer_to_atlas_map.clone(),
                                Arc::new(TokioMutex::new(HashMap::new())),
                                atlas_service,
                                template_service,
                            );
                            // Manage the state AFTER async initialization is complete
                            app_handle.manage(bridge_state);
                            tracing::info!("BridgeState with RenderLoopService managed.");
                        }
                        Err(e) => {
                            tracing::error!("Failed to initialize RenderLoopService: {:?}. BridgeState will not have GPU capabilities.", e);
                            // Create BridgeState without the service
                            let cache_dir = std::env::temp_dir().join("brainflow");
                            let atlas_service = match AtlasService::new(cache_dir.clone()) {
                                Ok(service) => Arc::new(TokioMutex::new(service)),
                                Err(e) => {
                                    tracing::error!("Failed to initialize atlas service: {}", e);
                                    return;
                                }
                            };
                            let template_service = match TemplateService::new(cache_dir) {
                                Ok(service) => Arc::new(TokioMutex::new(service)),
                                Err(e) => {
                                    tracing::error!("Failed to initialize template service: {}", e);
                                    return;
                                }
                            };
                            
                            let bridge_state = BridgeState::new(
                                volume_registry.clone(),
                                Arc::new(TokioMutex::new(SurfaceRegistry::new())),
                                Arc::new(TokioMutex::new(None)),
                                layer_to_atlas_map.clone(),
                                Arc::new(TokioMutex::new(HashMap::new())),
                                atlas_service,
                                template_service,
                            );
                            app_handle.manage(bridge_state);
                        }
                    }
                }
                // Instrument the whole future returned by the async block
                .instrument(tracing::info_span!("async_render_init")) // Instrument the whole task
            );

            Ok(())
        })
        .manage(app_state)
        .plugin(api_bridge::plugin()) // Re-enabled with proper configuration
        // Configure tauri_plugin_log to capture logs and forward them
        .plugin(tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info) // Set minimum level for frontend logs
            .level_for("core", log::LevelFilter::Debug) // Example: More verbose for 'core' target
            .level_for("render_loop", log::LevelFilter::Trace) // Example: Trace for render_loop
            .build()
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
