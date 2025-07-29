#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

// Learn more about Tauri commands at https://tauri.app/v1/guides/features/command
use std::sync::Arc;
use std::collections::HashMap;
use tokio::sync::Mutex as TokioMutex;
use api_bridge::{self, BridgeState};
use render_loop::RenderLoopService;
use tauri::{Manager, Emitter};
use futures::executor::block_on;
use tauri::menu::{Menu, MenuItemBuilder, SubmenuBuilder, PredefinedMenuItem};
use tauri::AppHandle;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct MountedDir {
    id: String,
    path: String,
}

// Command to open the mount dialog
#[tauri::command]
fn open_mount_dialog(app_handle: AppHandle) {
    use tauri_plugin_dialog::DialogExt;
    
    println!("Opening mount dialog...");
    
    // Clone app_handle for use in the closure
    let app_handle_clone = app_handle.clone();
    
    app_handle.dialog()
        .file()
        .add_filter("All Files", &["*"])
        .pick_folder(move |folder_path| {
            println!("Dialog callback triggered with: {:?}", folder_path);
            if let Some(folder) = folder_path {
                // FilePath enum has Display implementation, convert to string
                let path_str = folder.to_string();
                println!("Emitting mount-directory-event with path: {}", path_str);
                // Emit an event to the frontend with the selected path
                match app_handle_clone.emit("mount-directory-event", 
                    serde_json::json!({ "path": path_str })
                ) {
                    Ok(_) => println!("Event emitted successfully"),
                    Err(e) => eprintln!("Failed to emit event: {}", e),
                }
            } else {
                println!("Dialog was cancelled");
            }
        });
    
    println!("Dialog setup complete");
}

// Command to update dynamic menus
#[tauri::command]
async fn update_dynamic_menus(_app_handle: AppHandle, mounted: Vec<MountedDir>) -> Result<(), String> {
    // TODO: Implement dynamic menu updates
    // For now, just log the request
    println!("Update dynamic menus called with {} mounted directories", mounted.len());
    Ok(())
}

fn main() {
     // Initialize state components BEFORE the builder
     
     let volume_registry = Arc::new(TokioMutex::new(HashMap::<String, bridge_types::VolumeSendable>::new()));
     // Initialize the new layer map state
     let layer_to_atlas_map = Arc::new(TokioMutex::new(HashMap::<String, u32>::new()));
 
     // Set up logging plugin (assuming similar setup as lib.rs)
     let log_plugin = tauri_plugin_log::Builder::default()
         .level(log::LevelFilter::Info)
         .build();
 
     tauri::Builder::default()
          .setup(move |app| {
             // Create custom menu items
             let mount_dir = MenuItemBuilder::new("Mount Directory...")
                 .id("mount_directory")
                 .accelerator("CmdOrCtrl+O")
                 .build(app)?;
             
             // Build menu with standard items
             let menu = Menu::with_items(
                 app,
                 &[
                     #[cfg(target_os = "macos")]
                     &SubmenuBuilder::new(app, "Brainflow")
                         .item(&PredefinedMenuItem::about(app, Some("Brainflow"), None)?)
                         .separator()
                         .item(&PredefinedMenuItem::services(app, None)?)
                         .separator()
                         .item(&PredefinedMenuItem::hide(app, None)?)
                         .item(&PredefinedMenuItem::hide_others(app, None)?)
                         .item(&PredefinedMenuItem::show_all(app, None)?)
                         .separator()
                         .item(&PredefinedMenuItem::quit(app, None)?)
                         .build()?,
                     
                     &{
                         let file_menu = SubmenuBuilder::new(app, "File")
                             .item(&mount_dir)
                             .separator()
                             .item(&PredefinedMenuItem::close_window(app, None)?);
                         
                         #[cfg(not(target_os = "macos"))]
                         {
                             file_menu = file_menu
                                 .separator()
                                 .item(&PredefinedMenuItem::quit(app, None)?);
                         }
                         
                         file_menu.build()?
                     },
                     
                     &SubmenuBuilder::new(app, "Edit")
                         .item(&PredefinedMenuItem::undo(app, None)?)
                         .item(&PredefinedMenuItem::redo(app, None)?)
                         .separator()
                         .item(&PredefinedMenuItem::cut(app, None)?)
                         .item(&PredefinedMenuItem::copy(app, None)?)
                         .item(&PredefinedMenuItem::paste(app, None)?)
                         .item(&PredefinedMenuItem::select_all(app, None)?)
                         .build()?,
                     
                     &SubmenuBuilder::new(app, "View")
                         .item(&PredefinedMenuItem::fullscreen(app, None)?)
                         .separator()
                         .item(&SubmenuBuilder::new(app, "Workspace")
                             // Visualization workspaces
                             .item(&MenuItemBuilder::new("Orthogonal (Locked)")
                                 .id("workspace_orthogonal_locked")
                                 .accelerator("CmdOrCtrl+1")
                                 .build(app)?)
                             .item(&MenuItemBuilder::new("Orthogonal (Flexible)")
                                 .id("workspace_orthogonal_flexible")
                                 .accelerator("CmdOrCtrl+2")
                                 .build(app)?)
                             .separator()
                             // Multi-slice workspaces
                             .item(&MenuItemBuilder::new("Mosaic View")
                                 .id("workspace_mosaic")
                                 .accelerator("CmdOrCtrl+3")
                                 .build(app)?)
                             .item(&MenuItemBuilder::new("Lightbox View")
                                 .id("workspace_lightbox")
                                 .accelerator("CmdOrCtrl+4")
                                 .build(app)?)
                             .separator()
                             // Analysis workspaces
                             .item(&MenuItemBuilder::new("ROI Statistics (Demo)")
                                 .id("workspace_roi_stats")
                                 .accelerator("CmdOrCtrl+5")
                                 .build(app)?)
                             .separator()
                             // Tool workspaces
                             .item(&MenuItemBuilder::new("Coordinate Converter (Demo)")
                                 .id("workspace_coordinate_converter")
                                 .accelerator("CmdOrCtrl+6")
                                 .build(app)?)
                             .build()?)
                         .build()?,
                     
                     &SubmenuBuilder::new(app, "Window")
                         .item(&PredefinedMenuItem::minimize(app, None)?)
                         .item(&PredefinedMenuItem::maximize(app, None)?)
                         .separator()
                         .item(&PredefinedMenuItem::close_window(app, None)?)
                         .build()?,
                 ],
             )?;
             
             app.set_menu(menu)?;
             
             // Handle menu events
             app.on_menu_event(move |app, event| {
                 println!("Menu event received: {:?}", event.id());
                 let event_id = event.id().as_ref();
                 
                 match event_id {
                     "mount_directory" => {
                         println!("Mount directory menu item clicked");
                         let handle = app.app_handle().clone();
                         // Call synchronously since it's no longer async
                         open_mount_dialog(handle);
                     }
                     // Handle workspace menu items
                     id if id.starts_with("workspace_") => {
                         let workspace_type = match id {
                             "workspace_orthogonal_locked" => "orthogonal-locked",
                             "workspace_orthogonal_flexible" => "orthogonal-flexible",
                             "workspace_mosaic" => "mosaic",
                             "workspace_lightbox" => "lightbox",
                             "workspace_roi_stats" => "roi-stats",
                             "workspace_coordinate_converter" => "coordinate-converter",
                             _ => return,
                         };
                         
                         println!("Workspace menu item clicked: {}", workspace_type);
                         
                         // Emit workspace action event to frontend
                         match app.emit("workspace-action", 
                             serde_json::json!({
                                 "action": "new-workspace",
                                 "payload": {
                                     "type": workspace_type
                                 }
                             })
                         ) {
                             Ok(_) => println!("Workspace event emitted successfully"),
                             Err(e) => eprintln!("Failed to emit workspace event: {}", e),
                         }
                     }
                     _ => {}
                 }
             });
             // --- Initialize RenderLoopService --- 
             println!("Initializing RenderLoopService...");
             let render_loop_service_result = block_on(RenderLoopService::new());
 
             let render_loop_service = match render_loop_service_result {
                 Ok(service) => {
                     println!("RenderLoopService Initialized.");
                     Some(Arc::new(TokioMutex::new(service)))
                 }
                 Err(e) => {
                     eprintln!("FATAL: Failed to initialize RenderLoopService: {}", e);
                     // Handle error appropriately - maybe show an error dialog via Tauri API?
                     // For now, we'll keep it as None, but a real app needs better handling.
                     // Consider panic!("...") if it's truly unrecoverable.
                     None 
                 }
             };
 
             // --- Create and manage final BridgeState --- 
             let bridge_state = BridgeState::new(
                 volume_registry.clone(), // Clone Arc
                 Arc::new(TokioMutex::new(render_loop_service)), // Wrap in Arc<Mutex<...>>
                 layer_to_atlas_map, // Pass the new map
             );
             app.manage(bridge_state); // Manage the fully initialized state
 
             // Initialize logging based on debug/release mode
             if cfg!(debug_assertions) {
                 // Add logging initialization code here
             }
             Ok(())
         })
         .plugin(log_plugin) // Add logging plugin
         .plugin(tauri_plugin_dialog::init())
         //.plugin(tauri_plugin_window_state::init())
         .plugin(tauri_plugin_shell::init())
         .plugin(tauri_plugin_fs::init()
             // Scope is now handled by capabilities/default.json
         )
         .plugin(api_bridge::plugin()) // Re-enabled with proper configuration
         .invoke_handler(tauri::generate_handler![ 
             open_mount_dialog,
             update_dynamic_menus
         ])
         .run(tauri::generate_context!())
         .expect("error while running tauri application");
} 