#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

// Learn more about Tauri commands at https://tauri.app/v1/guides/features/command
use api_bridge::{self, BridgeState, SurfaceRegistry};
use atlases::AtlasService;
use render_loop::RenderLoopService;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::menu::{Menu, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::AppHandle;
use tauri::{Emitter, Manager, State};
use templates::TemplateService;
use tokio::sync::Mutex as TokioMutex;

mod menu_builder;
mod startup_args;

use startup_args::{
    format_cli_help, parse_startup_args, EarlyExit, StartupAction, StartupActionQueue,
    StartupRemoteMountSpec,
};

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct MountedDir {
    id: String,
    path: String,
}

fn emit_mount_directory_event(app_handle: &AppHandle, path: &str) -> Result<(), tauri::Error> {
    println!("Emitting mount-directory-event with path: {}", path);
    app_handle.emit("mount-directory-event", serde_json::json!({ "path": path }))
}

fn emit_open_file_event(
    app_handle: &AppHandle,
    path: &str,
    intent: Option<&str>,
) -> Result<(), tauri::Error> {
    println!(
        "Emitting open-file-event with path: {} and intent: {:?}",
        path, intent
    );
    app_handle.emit(
        "open-file-event",
        serde_json::json!({
            "path": path,
            "intent": intent,
        }),
    )
}

fn emit_workspace_action_event(
    app_handle: &AppHandle,
    workspace_type: &str,
) -> Result<(), tauri::Error> {
    println!(
        "Emitting workspace-action for startup workspace type: {}",
        workspace_type
    );
    app_handle.emit(
        "workspace-action",
        serde_json::json!({
            "action": "new-workspace",
            "payload": {
                "type": workspace_type
            }
        }),
    )
}

fn emit_template_menu_action_event(
    app_handle: &AppHandle,
    template_id: &str,
) -> Result<(), tauri::Error> {
    println!(
        "Emitting template-menu-action for startup template: {}",
        template_id
    );
    app_handle.emit(
        "template-menu-action",
        serde_json::json!({
            "action": "load-template",
            "payload": {
                "template_id": template_id
            }
        }),
    )
}

fn emit_remote_mount_event(
    app_handle: &AppHandle,
    spec: &StartupRemoteMountSpec,
) -> Result<(), tauri::Error> {
    println!("Emitting mount-remote-event for startup remote mount");
    let payload = match spec {
        StartupRemoteMountSpec::Profile { profile } => serde_json::json!({
            "spec": {
                "kind": "profile",
                "profile": profile,
            }
        }),
        StartupRemoteMountSpec::Direct {
            user,
            host,
            remote_path,
        } => serde_json::json!({
            "spec": {
                "kind": "direct",
                "user": user,
                "host": host,
                "remotePath": remote_path,
            }
        }),
    };
    app_handle.emit("mount-remote-event", payload)
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
                // Emit an event to the frontend with the selected path
                match emit_mount_directory_event(&app_handle_clone, &path_str) {
                    Ok(_) => println!("Event emitted successfully"),
                    Err(e) => eprintln!("Failed to emit event: {}", e),
                }
            } else {
                println!("Dialog was cancelled");
            }
        });

    println!("Dialog setup complete");
}

// Command to open a folder picker for BIDS dataset selection
#[tauri::command]
fn open_bids_dialog(app_handle: AppHandle) {
    use tauri_plugin_dialog::DialogExt;

    println!("Opening BIDS directory dialog...");

    let app_handle_clone = app_handle.clone();

    app_handle
        .dialog()
        .file()
        .set_title("Select BIDS Dataset")
        .pick_folder(move |folder_path| {
            println!("BIDS dialog callback triggered with: {:?}", folder_path);
            if let Some(folder) = folder_path {
                let path_str = folder.to_string();
                match app_handle_clone.emit(
                    "bids-directory-event",
                    serde_json::json!({ "path": path_str }),
                ) {
                    Ok(_) => println!("BIDS directory event emitted successfully"),
                    Err(e) => eprintln!("Failed to emit bids-directory-event: {}", e),
                }
            } else {
                println!("BIDS dialog was cancelled");
            }
        });

    println!("BIDS dialog setup complete");
}

// Command to open a file picker and request immediate file load in frontend
#[tauri::command]
fn open_file_dialog(app_handle: AppHandle, intent: Option<String>) {
    use tauri_plugin_dialog::DialogExt;

    println!("Opening file dialog...");

    let app_handle_clone = app_handle.clone();

    app_handle
        .dialog()
        .file()
        .add_filter(
            "Neuroimaging Files",
            &[
                "nii",
                "nii.gz",
                "gii",
                "surf.gii",
                "shape.gii",
                "func.gii",
                "label.gii",
            ],
        )
        .add_filter("All Files", &["*"])
        .pick_file(move |file_path| {
            println!("File dialog callback triggered with: {:?}", file_path);
            if let Some(file) = file_path {
                let path_str = file.to_string();
                match emit_open_file_event(&app_handle_clone, &path_str, intent.as_deref()) {
                    Ok(_) => println!("Open file event emitted successfully"),
                    Err(e) => eprintln!("Failed to emit open file event: {}", e),
                }
            } else {
                println!("File dialog was cancelled");
            }
        });

    println!("File dialog setup complete");
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

#[tauri::command]
fn flush_startup_actions(
    app_handle: AppHandle,
    startup_actions: State<'_, StartupActionQueue>,
) -> Result<usize, String> {
    let pending = startup_actions.drain();
    let pending_count = pending.len();

    for action in pending {
        let result = match action {
            StartupAction::Mount { path } => emit_mount_directory_event(&app_handle, &path),
            StartupAction::RemoteMount { spec } => emit_remote_mount_event(&app_handle, &spec),
            StartupAction::OpenFile { path } => emit_open_file_event(&app_handle, &path, None),
            StartupAction::Workspace { workspace_type } => {
                emit_workspace_action_event(&app_handle, &workspace_type)
            }
            StartupAction::Template { template_id } => {
                emit_template_menu_action_event(&app_handle, &template_id)
            }
        };

        result.map_err(|error| format!("Failed to emit startup action: {error}"))?;
    }

    Ok(pending_count)
}

fn main() {
    // Initialize state components BEFORE the builder
    let program_name = std::env::args()
        .next()
        .and_then(|arg| {
            std::path::Path::new(&arg)
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| "brainflow".to_string());
    let current_dir = std::env::current_dir().unwrap_or_else(|error| {
        eprintln!("Failed to resolve current working directory: {}", error);
        std::path::PathBuf::from(".")
    });
    let parsed_startup_args = parse_startup_args(std::env::args_os().skip(1), &current_dir);
    if let Some(early_exit) = &parsed_startup_args.early_exit {
        match early_exit {
            EarlyExit::Help => println!("{}", format_cli_help(&program_name)),
            EarlyExit::Version => println!("Brainflow {}", env!("CARGO_PKG_VERSION")),
        }
        return;
    }
    for warning in &parsed_startup_args.warnings {
        eprintln!("[startup] {}", warning);
    }
    if !parsed_startup_args.actions.is_empty() {
        println!(
            "Queued {} startup actions from command line",
            parsed_startup_args.actions.len()
        );
    }
    let startup_action_queue = StartupActionQueue::new(parsed_startup_args.actions);

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
            let open_file = MenuItemBuilder::new("Open File...")
                .id("open_file")
                .accelerator("CmdOrCtrl+Shift+O")
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
                        #[cfg(target_os = "macos")]
                        let file_menu = SubmenuBuilder::new(app, "File")
                            .item(&open_file)
                            .item(
                                &SubmenuBuilder::new(app, "Open File As")
                                    .item(
                                        &MenuItemBuilder::new("Add As Layer")
                                            .id("open_file_as_add_layer")
                                            .build(app)?,
                                    )
                                    .item(
                                        &MenuItemBuilder::new("Open In New Tab")
                                            .id("open_file_as_new_workspace")
                                            .build(app)?,
                                    )
                                    .item(
                                        &MenuItemBuilder::new("Open In Comparison View")
                                            .id("open_file_as_comparison")
                                            .build(app)?,
                                    )
                                    .build()?,
                            )
                            .separator()
                            .item(&mount_dir)
                            .separator()
                            .item(&PredefinedMenuItem::close_window(app, None)?);

                        #[cfg(not(target_os = "macos"))]
                        let file_menu = SubmenuBuilder::new(app, "File")
                            .item(&open_file)
                            .item(
                                &SubmenuBuilder::new(app, "Open File As")
                                    .item(
                                        &MenuItemBuilder::new("Add As Layer")
                                            .id("open_file_as_add_layer")
                                            .build(app)?,
                                    )
                                    .item(
                                        &MenuItemBuilder::new("Open In New Tab")
                                            .id("open_file_as_new_workspace")
                                            .build(app)?,
                                    )
                                    .item(
                                        &MenuItemBuilder::new("Open In Comparison View")
                                            .id("open_file_as_comparison")
                                            .build(app)?,
                                    )
                                    .build()?,
                            )
                            .separator()
                            .item(&mount_dir)
                            .separator()
                            .item(&PredefinedMenuItem::close_window(app, None)?)
                            .separator()
                            .item(&PredefinedMenuItem::quit(app, None)?);

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
                                    &MenuItemBuilder::new("Orthogonal Panels")
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
                                    &MenuItemBuilder::new("Comparison View")
                                        .id("workspace_comparison")
                                        .accelerator("CmdOrCtrl+4")
                                        .build(app)?,
                                )
                                .item(
                                    &MenuItemBuilder::new("Integrated View")
                                        .id("workspace_integrated")
                                        .accelerator("CmdOrCtrl+6")
                                        .build(app)?,
                                )
                                .separator()
                                .item(
                                    &MenuItemBuilder::new("Set Studio")
                                        .id("workspace_set_studio")
                                        .accelerator("CmdOrCtrl+5")
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
                    "open_file" => {
                        println!("Open file menu item clicked");
                        let handle = app.app_handle().clone();
                        open_file_dialog(handle, None);
                    }
                    "open_file_as_add_layer" => {
                        println!("Open file as layer menu item clicked");
                        let handle = app.app_handle().clone();
                        open_file_dialog(handle, Some("add-layer".to_string()));
                    }
                    "open_file_as_new_workspace" => {
                        println!("Open file in new workspace menu item clicked");
                        let handle = app.app_handle().clone();
                        open_file_dialog(handle, Some("new-workspace".to_string()));
                    }
                    "open_file_as_comparison" => {
                        println!("Open file in comparison workspace menu item clicked");
                        let handle = app.app_handle().clone();
                        open_file_dialog(handle, Some("comparison".to_string()));
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
                            "workspace_comparison" => "comparison",
                            "workspace_integrated" => "integrated",
                            "workspace_set_studio" => "set-studio",
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

                        if let Some(preset) = menu_builder::find_surface_atlas_preset_by_menu_id(id)
                        {
                            match app.emit(
                                "atlas-menu-action",
                                serde_json::json!({
                                    "action": "load-surface-atlas-preset",
                                    "payload": preset.to_payload()
                                }),
                            ) {
                                Ok(_) => println!("Surface atlas load event emitted successfully"),
                                Err(e) => {
                                    eprintln!("Failed to emit surface atlas load event: {}", e)
                                }
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
                                Ok(_) => {
                                    println!("Surface template load event emitted successfully")
                                }
                                Err(e) => {
                                    eprintln!("Failed to emit surface template load event: {}", e)
                                }
                            }
                        }
                    }
                    _ => {}
                }
            });
            // --- Create and manage BridgeState immediately ---
            // The wgpu adapter/device handshake (inside RenderLoopService::new)
            // is expensive and used to block here via block_on, delaying the
            // window and all UI interactivity until the GPU was ready. Instead
            // we manage BridgeState right away with an empty render-service slot
            // and initialize the GPU on a background task (below). Commands that
            // need the service already handle the not-yet-initialized case
            // gracefully (returning a recoverable error), and the frontend's
            // init_render_loop is idempotent, so nothing breaks if a render is
            // requested before initialization finishes.

            // Create atlas and template services (cheap, kept synchronous).
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

            // Shared render-service slot, initially empty. A clone is handed to
            // the background init task so it can populate the slot once the GPU
            // device is ready.
            let render_loop_slot: Arc<TokioMutex<Option<Arc<TokioMutex<RenderLoopService>>>>> =
                Arc::new(TokioMutex::new(None));
            let render_loop_slot_for_init = render_loop_slot.clone();

            let bridge_state = BridgeState::new(
                volume_registry.clone(),                           // Volume registry
                Arc::new(TokioMutex::new(SurfaceRegistry::new())), // Surface registry
                render_loop_slot,   // Render loop service (filled async)
                layer_to_atlas_map, // Layer to atlas map
                Arc::new(TokioMutex::new(HashMap::new())), // Layer to volume map
                atlas_service,      // Atlas service
                template_service,   // Template service
            );
            bridge_state.start_layer_watchdog();
            app.manage(bridge_state); // Manage immediately so the UI is interactive

            // --- Initialize RenderLoopService off the startup critical path ---
            tauri::async_runtime::spawn(async move {
                println!("Initializing RenderLoopService (async, off the startup path)...");
                // Hold the slot lock across initialization. Any command (or the
                // frontend's idempotent init_render_loop) that needs the service
                // will await this lock and then observe the populated slot,
                // preventing a duplicate GPU initialization.
                let mut slot = render_loop_slot_for_init.lock().await;
                if slot.is_some() {
                    return;
                }
                match RenderLoopService::new().await {
                    Ok(service) => {
                        *slot = Some(Arc::new(TokioMutex::new(service)));
                        println!("RenderLoopService Initialized (async).");
                    }
                    Err(e) => {
                        eprintln!("FATAL: Failed to initialize RenderLoopService: {}", e);
                    }
                }
            });

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
        .manage(startup_action_queue)
        .invoke_handler(tauri::generate_handler![
            open_mount_dialog,
            open_bids_dialog,
            open_file_dialog,
            update_dynamic_menus,
            flush_startup_actions
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
