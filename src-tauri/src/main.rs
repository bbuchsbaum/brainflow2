#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

// Learn more about Tauri commands at https://tauri.app/v1/guides/features/command
use api_bridge::{self, BridgeState, SurfaceRegistry};
use atlases::AtlasService;
use futures::executor::block_on;
use render_loop::RenderLoopService;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::menu::{Menu, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::AppHandle;
use tauri::{Emitter, Manager};
use templates::{TemplateService, TemplateSpace, TemplateType};
use tokio::sync::Mutex as TokioMutex;

mod menu_builder;

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

    app_handle
        .dialog()
        .file()
        .add_filter("All Files", &["*"])
        .pick_folder(move |folder_path| {
            println!("Dialog callback triggered with: {:?}", folder_path);
            if let Some(folder) = folder_path {
                // FilePath enum has Display implementation, convert to string
                let path_str = folder.to_string();
                println!("Emitting mount-directory-event with path: {}", path_str);
                // Emit an event to the frontend with the selected path
                match app_handle_clone.emit(
                    "mount-directory-event",
                    serde_json::json!({ "path": path_str }),
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
async fn update_dynamic_menus(
    _app_handle: AppHandle,
    mounted: Vec<MountedDir>,
) -> Result<(), String> {
    // TODO: Implement dynamic menu updates
    // For now, just log the request
    println!(
        "Update dynamic menus called with {} mounted directories",
        mounted.len()
    );
    Ok(())
}

fn main() {
    // Initialize state components BEFORE the builder

    let volume_registry = Arc::new(TokioMutex::new(api_bridge::VolumeRegistry::new()));
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

            // Build templates menu directly
            let templates_menu = {
                // Create main Templates submenu
                let mut templates_menu = SubmenuBuilder::new(app, "Templates");

                // MNI152 2009c Asymmetric - directly under Templates
                let mut mni152_2009c = SubmenuBuilder::new(app, "MNI152 2009c Asymmetric");

                // Add T1 and T2 templates directly (flattened)
                mni152_2009c = mni152_2009c
                    .item(
                        &MenuItemBuilder::new("T1 1mm")
                            .id("template_MNI152NLin2009cAsym_T1w_1mm")
                            .build(app)?,
                    )
                    .item(
                        &MenuItemBuilder::new("T1 2mm")
                            .id("template_MNI152NLin2009cAsym_T1w_2mm")
                            .build(app)?,
                    )
                    .item(
                        &MenuItemBuilder::new("T2 1mm")
                            .id("template_MNI152NLin2009cAsym_T2w_1mm")
                            .build(app)?,
                    )
                    .item(
                        &MenuItemBuilder::new("T2 2mm")
                            .id("template_MNI152NLin2009cAsym_T2w_2mm")
                            .build(app)?,
                    )
                    .separator();

                // Tissue probability maps
                let mut tissue_menu = SubmenuBuilder::new(app, "Tissue Probability");
                tissue_menu = tissue_menu
                    .item(
                        &MenuItemBuilder::new("Gray Matter (1mm)")
                            .id("template_MNI152NLin2009cAsym_GM_1mm")
                            .build(app)?,
                    )
                    .item(
                        &MenuItemBuilder::new("Gray Matter (2mm)")
                            .id("template_MNI152NLin2009cAsym_GM_2mm")
                            .build(app)?,
                    )
                    .item(
                        &MenuItemBuilder::new("White Matter (1mm)")
                            .id("template_MNI152NLin2009cAsym_WM_1mm")
                            .build(app)?,
                    )
                    .item(
                        &MenuItemBuilder::new("White Matter (2mm)")
                            .id("template_MNI152NLin2009cAsym_WM_2mm")
                            .build(app)?,
                    )
                    .item(
                        &MenuItemBuilder::new("CSF (1mm)")
                            .id("template_MNI152NLin2009cAsym_CSF_1mm")
                            .build(app)?,
                    )
                    .item(
                        &MenuItemBuilder::new("CSF (2mm)")
                            .id("template_MNI152NLin2009cAsym_CSF_2mm")
                            .build(app)?,
                    );

                // Brain masks
                let mut mask_menu = SubmenuBuilder::new(app, "Brain Masks");
                mask_menu = mask_menu
                    .item(
                        &MenuItemBuilder::new("Brain Mask (1mm)")
                            .id("template_MNI152NLin2009cAsym_mask_1mm")
                            .build(app)?,
                    )
                    .item(
                        &MenuItemBuilder::new("Brain Mask (2mm)")
                            .id("template_MNI152NLin2009cAsym_mask_2mm")
                            .build(app)?,
                    )
                    .item(
                        &MenuItemBuilder::new("Skull-stripped Brain (1mm)")
                            .id("template_MNI152NLin2009cAsym_brain_1mm")
                            .build(app)?,
                    )
                    .item(
                        &MenuItemBuilder::new("Skull-stripped Brain (2mm)")
                            .id("template_MNI152NLin2009cAsym_brain_2mm")
                            .build(app)?,
                    );

                // Build MNI152 2009c submenu with flattened structure
                mni152_2009c = mni152_2009c
                    .item(&tissue_menu.build()?)
                    .separator()
                    .item(&mask_menu.build()?);

                // Add MNI152 2009c directly to templates menu (no MNI Space intermediate level)
                templates_menu = templates_menu.item(&mni152_2009c.build()?);

                // MNIColin27 - directly under Templates
                let mut mnicolin27 = SubmenuBuilder::new(app, "MNI Colin27");
                mnicolin27 = mnicolin27
                    .item(
                        &MenuItemBuilder::new("T1w")
                            .id("template_MNIColin27_T1w_native")
                            .build(app)?,
                    )
                    .item(
                        &MenuItemBuilder::new("Brain Mask")
                            .id("template_MNIColin27_mask_native")
                            .build(app)?,
                    );

                templates_menu = templates_menu.item(&mnicolin27.build()?);

                // MNI305 - directly under Templates
                let mut mni305 = SubmenuBuilder::new(app, "MNI305");
                mni305 = mni305
                    .item(
                        &MenuItemBuilder::new("T1w")
                            .id("template_MNI305_T1w_native")
                            .build(app)?,
                    )
                    .item(
                        &MenuItemBuilder::new("T2w")
                            .id("template_MNI305_T2w_native")
                            .build(app)?,
                    )
                    .item(
                        &MenuItemBuilder::new("Brain Mask")
                            .id("template_MNI305_mask_native")
                            .build(app)?,
                    );

                templates_menu = templates_menu.item(&mni305.build()?);

                templates_menu.build()?
            };

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
                    &templates_menu,
                    &menu_builder::build_atlases_menu(app)?,
                    &menu_builder::build_surface_templates_menu(app)?,
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
                        .item(
                            &MenuItemBuilder::new("Show Crosshair")
                                .id("toggle_crosshair")
                                .accelerator("C")
                                .build(app)?,
                        )
                        .item(
                            &MenuItemBuilder::new("Crosshair Settings...")
                                .id("crosshair_settings")
                                .build(app)?,
                        )
                        .separator()
                        .item(
                            &SubmenuBuilder::new(app, "Panels")
                                .item(
                                    &MenuItemBuilder::new("File Browser")
                                        .id("panel_file_browser")
                                        .accelerator("CmdOrCtrl+B")
                                        .build(app)?,
                                )
                                .item(
                                    &MenuItemBuilder::new("Layer Manager")
                                        .id("panel_layer_manager")
                                        .accelerator("CmdOrCtrl+L")
                                        .build(app)?,
                                )
                                .item(
                                    &MenuItemBuilder::new("Atlas Browser")
                                        .id("panel_atlas_browser")
                                        .accelerator("CmdOrCtrl+A")
                                        .build(app)?,
                                )
                                .item(
                                    &MenuItemBuilder::new("Plot Panel")
                                        .id("panel_plot")
                                        .accelerator("CmdOrCtrl+P")
                                        .build(app)?,
                                )
                                .build()?,
                        )
                        .separator()
                        .item(
                            &SubmenuBuilder::new(app, "Workspace")
                                // Visualization workspaces
                                .item(
                                    &MenuItemBuilder::new("Orthogonal (Locked)")
                                        .id("workspace_orthogonal_locked")
                                        .accelerator("CmdOrCtrl+1")
                                        .build(app)?,
                                )
                                .item(
                                    &MenuItemBuilder::new("Orthogonal (Flexible)")
                                        .id("workspace_orthogonal_flexible")
                                        .accelerator("CmdOrCtrl+2")
                                        .build(app)?,
                                )
                                .separator()
                                // Multi-slice workspaces
                                .item(
                                    &MenuItemBuilder::new("Mosaic View")
                                        .id("workspace_mosaic")
                                        .accelerator("CmdOrCtrl+3")
                                        .build(app)?,
                                )
                                .item(
                                    &MenuItemBuilder::new("Lightbox View")
                                        .id("workspace_lightbox")
                                        .accelerator("CmdOrCtrl+4")
                                        .build(app)?,
                                )
                                .separator()
                                // Analysis workspaces
                                .item(
                                    &MenuItemBuilder::new("ROI Statistics (Demo)")
                                        .id("workspace_roi_stats")
                                        .accelerator("CmdOrCtrl+5")
                                        .build(app)?,
                                )
                                .separator()
                                // Tool workspaces
                                .item(
                                    &MenuItemBuilder::new("Coordinate Converter (Demo)")
                                        .id("workspace_coordinate_converter")
                                        .accelerator("CmdOrCtrl+6")
                                        .build(app)?,
                                )
                                .build()?,
                        )
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
                    "toggle_crosshair" => {
                        println!("Toggle crosshair menu item clicked");
                        match app.emit(
                            "crosshair-action",
                            serde_json::json!({
                                "action": "toggle"
                            }),
                        ) {
                            Ok(_) => println!("Crosshair toggle event emitted successfully"),
                            Err(e) => eprintln!("Failed to emit crosshair toggle event: {}", e),
                        }
                    }
                    "crosshair_settings" => {
                        println!("Crosshair settings menu item clicked");
                        match app.emit(
                            "crosshair-action",
                            serde_json::json!({
                                "action": "open-settings"
                            }),
                        ) {
                            Ok(_) => println!("Crosshair settings event emitted successfully"),
                            Err(e) => eprintln!("Failed to emit crosshair settings event: {}", e),
                        }
                    }
                    // Handle panel menu items
                    id if id.starts_with("panel_") => {
                        let panel_type = match id {
                            "panel_file_browser" => "FileBrowser",
                            "panel_layer_manager" => "LayerPanel",
                            "panel_atlas_browser" => "AtlasPanel",
                            "panel_plot" => "PlotPanel",
                            _ => return,
                        };

                        println!("Panel menu item clicked: {}", panel_type);

                        // Emit panel action event to frontend
                        match app.emit(
                            "panel-action",
                            serde_json::json!({
                                "action": "show-panel",
                                "payload": {
                                    "type": panel_type
                                }
                            }),
                        ) {
                            Ok(_) => println!("Panel event emitted successfully"),
                            Err(e) => eprintln!("Failed to emit panel event: {}", e),
                        }
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
                        match app.emit(
                            "workspace-action",
                            serde_json::json!({
                                "action": "new-workspace",
                                "payload": {
                                    "type": workspace_type
                                }
                            }),
                        ) {
                            Ok(_) => println!("Workspace event emitted successfully"),
                            Err(e) => eprintln!("Failed to emit workspace event: {}", e),
                        }
                    }
                    // Handle template menu items
                    id if id.starts_with("template_") => {
                        println!("Template menu item clicked: {}", id);

                        // Parse template ID: "template_MNI152NLin2009cAsym_T1w_1mm"
                        if let Some(template_id) = id.strip_prefix("template_") {
                            // Emit template loading event to frontend
                            match app.emit(
                                "template-menu-action",
                                serde_json::json!({
                                    "action": "load-template",
                                    "payload": {
                                        "template_id": template_id
                                    }
                                }),
                            ) {
                                Ok(_) => println!("Template load event emitted successfully"),
                                Err(e) => eprintln!("Failed to emit template load event: {}", e),
                            }
                        }
                    }
                    // Handle atlas menu items
                    id if id.starts_with("atlas_") => {
                        println!("Atlas menu item clicked: {}", id);

                        if let Some(preset) = menu_builder::find_preset_by_menu_id(id) {
                            match app.emit(
                                "atlas-menu-action",
                                serde_json::json!({
                                    "action": "load-atlas-preset",
                                    "payload": preset.to_payload()
                                }),
                            ) {
                                Ok(_) => println!("Atlas load event emitted successfully"),
                                Err(e) => eprintln!("Failed to emit atlas load event: {}", e),
                            }
                        }
                    }
                    // Handle surface atlas menu items
                    id if id.starts_with("surface_atlas_") => {
                        println!("Surface atlas menu item clicked: {}", id);

                        if let Some(preset) = menu_builder::find_surface_atlas_preset_by_menu_id(id) {
                            match app.emit(
                                "atlas-menu-action",
                                serde_json::json!({
                                    "action": "load-surface-atlas-preset",
                                    "payload": preset.to_payload()
                                }),
                            ) {
                                Ok(_) => println!("Surface atlas load event emitted successfully"),
                                Err(e) => eprintln!("Failed to emit surface atlas load event: {}", e),
                            }
                        }
                    }
                    // Handle surface template menu items
                    id if id.starts_with("surface_") => {
                        println!("Surface template menu item clicked: {}", id);

                        if let Some(preset) = menu_builder::find_surface_preset_by_menu_id(id) {
                            match app.emit(
                                "surface-template-menu-action",
                                serde_json::json!({
                                    "action": "load-surface-template",
                                    "payload": preset.to_payload()
                                }),
                            ) {
                                Ok(_) => println!("Surface template load event emitted successfully"),
                                Err(e) => eprintln!("Failed to emit surface template load event: {}", e),
                            }
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
            // Create atlas and template services
            let cache_dir = app
                .path()
                .app_cache_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("brainflow"));
            let atlas_service = Arc::new(TokioMutex::new(
                AtlasService::new(cache_dir.clone())
                    .map_err(|e| format!("Failed to initialize atlas service: {}", e))?,
            ));
            let template_service = Arc::new(TokioMutex::new(
                TemplateService::new(cache_dir)
                    .map_err(|e| format!("Failed to initialize template service: {}", e))?,
            ));

            let bridge_state = BridgeState::new(
                volume_registry.clone(),                           // Volume registry
                Arc::new(TokioMutex::new(SurfaceRegistry::new())), // Surface registry
                Arc::new(TokioMutex::new(render_loop_service)),    // Render loop service
                layer_to_atlas_map,                                // Layer to atlas map
                Arc::new(TokioMutex::new(HashMap::new())),         // Layer to volume map
                atlas_service,                                     // Atlas service
                template_service,                                  // Template service
            );
            bridge_state.start_layer_watchdog();
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
        .plugin(
            tauri_plugin_fs::init(), // Scope is now handled by capabilities/default.json
        )
        .plugin(api_bridge::plugin()) // Re-enabled with proper configuration
        .invoke_handler(tauri::generate_handler![
            open_mount_dialog,
            update_dynamic_menus
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
