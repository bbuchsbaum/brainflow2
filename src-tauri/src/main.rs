#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

// Learn more about Tauri commands at https://tauri.app/v1/guides/features/command
use api_bridge::{self, BridgeState};
use tauri::menu::{
    CheckMenuItemBuilder, Menu, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
};
use tauri::AppHandle;
use tauri::{Emitter, Listener, Manager, State};

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

/// Extensions of the Open dialog's "Neuroimaging Files" filter. One component
/// each: macOS matches a filter by the last extension only, so "nii.gz" greyed
/// out every `.nii.gz` (QA 2026-10-30 F25); "gz" lists them, and the frontend
/// rejects a `.gz` it cannot load with a message. "gii" covers `.surf.gii`,
/// `.func.gii`, `.shape.gii` and `.label.gii`. Gzipped GIfTI (`.gii.gz`) is not
/// listed: the GIfTI loader only accepts `.gii`.
const OPEN_DIALOG_EXTENSIONS: &[&str] = &["nii", "gz", "gii"];

/// Intents whose Open dialog takes several files: each is loaded in turn. A new
/// workspace or a comparison opens one file.
fn open_dialog_allows_multiple(intent: Option<&str>) -> bool {
    matches!(intent, None | Some("default") | Some("add-layer"))
}

fn emit_open_files_event(
    app_handle: &AppHandle,
    paths: &[String],
    intent: Option<&str>,
) -> Result<(), tauri::Error> {
    println!(
        "Emitting open-file-event with {} path(s) and intent: {:?}",
        paths.len(),
        intent
    );
    // `path` stays the first file for listeners that read one; `paths` lists all.
    app_handle.emit(
        "open-file-event",
        serde_json::json!({
            "path": paths.first(),
            "paths": paths,
            "intent": intent,
        }),
    )
}

// Command to open a file picker and request immediate file load in frontend
#[tauri::command]
fn open_file_dialog(app_handle: AppHandle, intent: Option<String>) {
    use tauri_plugin_dialog::DialogExt;

    println!("Opening file dialog...");

    let app_handle_clone = app_handle.clone();
    let multiple = open_dialog_allows_multiple(intent.as_deref());
    let dialog = app_handle
        .dialog()
        .file()
        .add_filter("Neuroimaging Files", OPEN_DIALOG_EXTENSIONS)
        .add_filter("All Files", &["*"]);

    let emit = move |paths: Vec<String>| {
        if paths.is_empty() {
            println!("File dialog was cancelled");
            return;
        }
        match emit_open_files_event(&app_handle_clone, &paths, intent.as_deref()) {
            Ok(_) => println!("Open file event emitted successfully"),
            Err(e) => eprintln!("Failed to emit open file event: {}", e),
        }
    };
    if multiple {
        dialog.pick_files(move |files| {
            emit(
                files
                    .unwrap_or_default()
                    .into_iter()
                    .map(|f| f.to_string())
                    .collect(),
            )
        });
    } else {
        dialog.pick_file(move |file| emit(file.into_iter().map(|f| f.to_string()).collect()));
    }

    println!("File dialog setup complete");
}

/// Largest image Copy view puts on the clipboard (decoded RGBA bytes).
const CLIPBOARD_MAX_RGBA_BYTES: usize = 256 * 1024 * 1024;

/// The message a too-large copy shows the user verbatim (the UI passes it
/// through; any other failure becomes its generic clipboard message).
const CLIPBOARD_TOO_LARGE: &str = "Image too large for the clipboard";

/// A PNG decoded to 8-bit RGBA rows: (width, height, pixels). The size is
/// checked from the header before any pixel buffer is allocated.
fn png_to_rgba(bytes: &[u8], max_rgba_bytes: usize) -> Result<(usize, usize, Vec<u8>), String> {
    let mut decoder = png::Decoder::new(bytes);
    decoder.set_transformations(png::Transformations::normalize_to_color8());
    let mut reader = decoder.read_info().map_err(|e| format!("Not a PNG: {e}"))?;
    let (width, height) = (reader.info().width as usize, reader.info().height as usize);
    if width.saturating_mul(height).saturating_mul(4) > max_rgba_bytes {
        return Err(format!("{CLIPBOARD_TOO_LARGE} ({width}×{height})"));
    }
    let mut buf = vec![0; reader.output_buffer_size()];
    let frame = reader
        .next_frame(&mut buf)
        .map_err(|e| format!("Not a PNG: {e}"))?;
    buf.truncate(frame.buffer_size());
    let rgba = match frame.color_type {
        // Already RGBA: the decode buffer itself, no copy.
        png::ColorType::Rgba => buf,
        png::ColorType::Rgb => buf
            .chunks_exact(3)
            .flat_map(|p| [p[0], p[1], p[2], 255])
            .collect(),
        png::ColorType::GrayscaleAlpha => buf
            .chunks_exact(2)
            .flat_map(|p| [p[0], p[0], p[0], p[1]])
            .collect(),
        png::ColorType::Grayscale => buf.iter().flat_map(|&g| [g, g, g, 255]).collect(),
        png::ColorType::Indexed => return Err("Indexed PNG was not expanded".to_string()),
    };
    Ok((width, height, rgba))
}

/// Copy view (⇧⌘C): put a PNG on the system clipboard natively. WebKit's
/// `navigator.clipboard.write` refuses a write that lands after the key
/// gesture, and the composite capture of a mosaic always does (QA N8).
/// The decode and the write run on a blocking worker, off the main thread:
/// arboard's macOS backend uses NSPasteboard, which may be used from any
/// thread, so the UI never waits on a large decode.
#[tauri::command]
async fn copy_png_to_clipboard(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Copy view expects the PNG as a raw body".to_string());
    };
    let png = bytes.to_vec();
    tauri::async_runtime::spawn_blocking(move || {
        let (width, height, rgba) = png_to_rgba(&png, CLIPBOARD_MAX_RGBA_BYTES)?;
        drop(png);
        let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        clipboard
            .set_image(arboard::ImageData {
                width,
                height,
                bytes: std::borrow::Cow::Owned(rgba),
            })
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
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
            // ⌘W closes the front tab, like its ×; the window closes on ⇧⌘W
            // (QA 2026-10-31 N1: the predefined Close Window owned ⌘W, so one
            // habitual keystroke closed the window and quit). Both live in
            // File; Window keeps Minimize and Zoom.
            let close_tab = MenuItemBuilder::new("Close Tab")
                .id("workspace_close_tab")
                .accelerator("CmdOrCtrl+W")
                .build(app)?;
            let close_window = MenuItemBuilder::new("Close Window")
                .id("close_window")
                .accelerator("CmdOrCtrl+Shift+W")
                .build(app)?;

            // Opens the UI's export dialog (ui2 useExportMenuListener).
            let export_view = MenuItemBuilder::new("Export View as Image...")
                .id("export_view_image")
                .accelerator("CmdOrCtrl+Shift+E")
                .build(app)?;

            // A check item kept in step with the UI (crosshair-visibility-changed
            // below). No accelerator: bare C is the UI's "go to image center".
            let show_crosshair = CheckMenuItemBuilder::new("Show Crosshair")
                .id("toggle_crosshair")
                .checked(true)
                .build(app)?;
            // A persisted UI setting (ui2 viewDisplaySettingsStore); the UI
            // reports it (radiological-convention-changed) so the check follows.
            let radiological = CheckMenuItemBuilder::new("Radiological Convention")
                .id("toggle_radiological")
                .checked(false)
                .build(app)?;

            // View › Layout: check items, so the current tab's layout carries
            // a ✓ (current-layout-changed below). Integrated is enabled only
            // while the UI's feature flag is on (integrated-layout-availability).
            let layout_orthogonal = CheckMenuItemBuilder::new("Orthogonal")
                .id("layout_orthogonal")
                .accelerator("CmdOrCtrl+1")
                .build(app)?;
            let layout_integrated = CheckMenuItemBuilder::new("Integrated")
                .id("layout_integrated")
                .accelerator("CmdOrCtrl+2")
                .build(app)?;
            let layout_mosaic = CheckMenuItemBuilder::new("Mosaic")
                .id("layout_mosaic")
                .accelerator("CmdOrCtrl+3")
                .build(app)?;
            let layout_compare = CheckMenuItemBuilder::new("Compare")
                .id("layout_compare")
                .accelerator("CmdOrCtrl+4")
                .build(app)?;
            let layout_orthogonal_panels = CheckMenuItemBuilder::new("Orthogonal Panels")
                .id("layout_orthogonal_panels")
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
                        // ui2 useAppSettingsMenuListener opens the Settings dialog.
                        .item(
                            &MenuItemBuilder::new("Settings...")
                                .id("app_settings")
                                .accelerator("CmdOrCtrl+,")
                                .build(app)?,
                        )
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
                            .item(&export_view)
                            .separator()
                            .item(&close_tab)
                            .item(&close_window);

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
                            .item(&export_view)
                            .separator()
                            .item(&close_tab)
                            .item(&close_window)
                            .separator()
                            .item(&PredefinedMenuItem::quit(app, None)?);

                        file_menu.build()?
                    },
                    &templates_menu,
                    &menu_builder::build_atlases_menu(app)?,
                    &menu_builder::build_surface_templates_menu(app)?,
                    &SubmenuBuilder::new(app, "Edit")
                        // Not the predefined Undo/Redo: they reach only the
                        // focused text field. The UI undoes scene edits, or
                        // the text field's own edit when one has focus
                        // (ui2 SceneHistoryService.runEditCommand).
                        .item(
                            &MenuItemBuilder::new("Undo")
                                .id("edit_undo")
                                .accelerator("CmdOrCtrl+Z")
                                .build(app)?,
                        )
                        .item(
                            &MenuItemBuilder::new("Redo")
                                .id("edit_redo")
                                .accelerator("Shift+CmdOrCtrl+Z")
                                .build(app)?,
                        )
                        .separator()
                        .item(&PredefinedMenuItem::cut(app, None)?)
                        .item(&PredefinedMenuItem::copy(app, None)?)
                        .item(&PredefinedMenuItem::paste(app, None)?)
                        // Not the predefined Select All: it would select every
                        // label in the window (QA 2026-10-29 §4.3). The UI selects
                        // within the focused text field only (ui2 editSelectAll).
                        .item(
                            &MenuItemBuilder::new("Select All")
                                .id("edit_select_all")
                                .accelerator("CmdOrCtrl+A")
                                .build(app)?,
                        )
                        .build()?,
                    &SubmenuBuilder::new(app, "View")
                        .item(&PredefinedMenuItem::fullscreen(app, None)?)
                        .separator()
                        .item(&show_crosshair)
                        .item(
                            &MenuItemBuilder::new("Crosshair Settings...")
                                .id("crosshair_settings")
                                .build(app)?,
                        )
                        .item(&radiological)
                        .separator()
                        // Opens the UI's image header dialog for the selected
                        // layer (ui2 App: "image-header-action").
                        .item(
                            &MenuItemBuilder::new("Image Header...")
                                .id("image_header")
                                .accelerator("CmdOrCtrl+I")
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
                                // Layers and atlases live in the Inspector; the old
                                // "Layer Manager"/"Atlas Browser" items were aliases of
                                // it (and Atlas Browser fought Select All for Cmd+A).
                                .item(
                                    &MenuItemBuilder::new("Inspector")
                                        .id("panel_layer_manager")
                                        .accelerator("CmdOrCtrl+L")
                                        .build(app)?,
                                )
                                .item(
                                    &MenuItemBuilder::new("Plot Panel")
                                        .id("panel_plot")
                                        .accelerator("CmdOrCtrl+P")
                                        .build(app)?,
                                )
                                .item(
                                    // Opens the bottom dock's Clusters tab (ui2 GoldenLayoutRoot).
                                    &MenuItemBuilder::new("Clusters")
                                        .id("panel_clusters")
                                        .build(app)?,
                                )
                                .separator()
                                .item(
                                    // Restores the default side panels (ui2 layoutService).
                                    &MenuItemBuilder::new("Reset Layout")
                                        .id("reset_layout")
                                        .build(app)?,
                                )
                                .build()?,
                        )
                        .separator()
                        // Layouts apply to the current tab, in place (ui2
                        // services/workspaceNavigation.ts); they never open a tab.
                        .item(
                            &SubmenuBuilder::new(app, "Layout")
                                .item(&layout_orthogonal)
                                .item(&layout_integrated)
                                .item(&layout_mosaic)
                                .item(&layout_compare)
                                .separator()
                                .item(&layout_orthogonal_panels)
                                .build()?,
                        )
                        // New tabs: a new view, or a tool (opened once, then refocused).
                        .item(
                            &SubmenuBuilder::new(app, "Workspace")
                                .item(
                                    &MenuItemBuilder::new("New View")
                                        .id("workspace_new_view")
                                        .accelerator("CmdOrCtrl+T")
                                        .build(app)?,
                                )
                                .separator()
                                .item(
                                    &MenuItemBuilder::new("Set Studio")
                                        .id("workspace_set_studio")
                                        .accelerator("CmdOrCtrl+5")
                                        .build(app)?,
                                )
                                .item(
                                    &MenuItemBuilder::new("BIDS")
                                        .id("workspace_bids")
                                        .accelerator("CmdOrCtrl+6")
                                        .build(app)?,
                                )
                                .item(
                                    &MenuItemBuilder::new("Analysis")
                                        .id("workspace_analysis")
                                        .build(app)?,
                                )
                                .build()?,
                        )
                        .build()?,
                    &SubmenuBuilder::new(app, "Window")
                        .item(&PredefinedMenuItem::minimize(app, None)?)
                        .item(&PredefinedMenuItem::maximize(app, None)?)
                        .build()?,
                ],
            )?;

            app.set_menu(menu)?;

            // View › Radiological Convention follows the UI's persisted setting.
            let radiological_check = radiological.clone();
            app.listen("radiological-convention-changed", move |event| {
                let enabled = serde_json::from_str::<serde_json::Value>(event.payload())
                    .ok()
                    .and_then(|payload| payload.get("enabled").and_then(|v| v.as_bool()));
                if let Some(enabled) = enabled {
                    if let Err(e) = radiological_check.set_checked(enabled) {
                        eprintln!("Failed to sync Radiological Convention check: {}", e);
                    }
                }
            });

            // The UI owns crosshair visibility (this item only asks it to toggle);
            // it reports every change so the check mark follows.
            let crosshair_check = show_crosshair.clone();
            app.listen("crosshair-visibility-changed", move |event| {
                let visible = serde_json::from_str::<serde_json::Value>(event.payload())
                    .ok()
                    .and_then(|payload| payload.get("visible").and_then(|v| v.as_bool()));
                if let Some(visible) = visible {
                    if let Err(e) = crosshair_check.set_checked(visible) {
                        eprintln!("Failed to sync Show Crosshair check: {}", e);
                    }
                }
            });

            // The UI reports its Integrated feature flag; the layout item follows.
            let integrated_item = layout_integrated.clone();
            app.listen("integrated-layout-availability", move |event| {
                let enabled = serde_json::from_str::<serde_json::Value>(event.payload())
                    .ok()
                    .and_then(|payload| payload.get("enabled").and_then(|v| v.as_bool()));
                if let Some(enabled) = enabled {
                    if let Err(e) = integrated_item.set_enabled(enabled) {
                        eprintln!("Failed to sync Integrated layout item: {}", e);
                    }
                }
            });

            // The UI reports the front tab's layout (a view type, or null for a
            // tool or surface tab); View › Layout checks that one item only. The
            // UI re-reports after every layout request, which also undoes the
            // check toggle macOS applies to a clicked item.
            let layout_checks = [
                (layout_orthogonal.clone(), "orthogonal-locked"),
                (layout_integrated.clone(), "integrated"),
                (layout_mosaic.clone(), "mosaic"),
                (layout_compare.clone(), "comparison"),
                (layout_orthogonal_panels.clone(), "orthogonal-flexible"),
            ];
            app.listen("current-layout-changed", move |event| {
                let layout = serde_json::from_str::<serde_json::Value>(event.payload())
                    .ok()
                    .and_then(|payload| {
                        payload
                            .get("layout")
                            .and_then(|v| v.as_str())
                            .map(str::to_owned)
                    });
                for (item, view_type) in &layout_checks {
                    let checked = layout.as_deref() == Some(*view_type);
                    if let Err(e) = item.set_checked(checked) {
                        eprintln!("Failed to sync View › Layout check: {}", e);
                    }
                }
            });

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
                    "export_view_image" => {
                        if let Err(e) = app.emit(
                            "export-active-view",
                            serde_json::json!({ "action": "export-image" }),
                        ) {
                            eprintln!("Failed to emit export-active-view event: {}", e);
                        }
                    }
                    "toggle_radiological" => {
                        if let Err(e) = app.emit(
                            "view-display-action",
                            serde_json::json!({ "action": "toggle-radiological" }),
                        ) {
                            eprintln!("Failed to emit view-display-action event: {}", e);
                        }
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
                    "app_settings" => {
                        if let Err(e) = app.emit("app-settings-action", serde_json::json!({})) {
                            eprintln!("Failed to emit app-settings-action event: {}", e);
                        }
                    }
                    "image_header" => {
                        if let Err(e) = app.emit("image-header-action", serde_json::json!({})) {
                            eprintln!("Failed to emit image-header-action event: {}", e);
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
                    "edit_undo" | "edit_redo" => {
                        let action = if event_id == "edit_undo" {
                            "undo"
                        } else {
                            "redo"
                        };
                        if let Err(e) =
                            app.emit("edit-action", serde_json::json!({ "action": action }))
                        {
                            eprintln!("Failed to emit edit {} event: {}", action, e);
                        }
                    }
                    "edit_select_all" => {
                        if let Err(e) =
                            app.emit("edit-action", serde_json::json!({ "action": "select-all" }))
                        {
                            eprintln!("Failed to emit select-all event: {}", e);
                        }
                    }
                    "reset_layout" => {
                        if let Err(e) = app.emit(
                            "panel-action",
                            serde_json::json!({ "action": "reset-layout" }),
                        ) {
                            eprintln!("Failed to emit reset-layout event: {}", e);
                        }
                    }
                    // Handle panel menu items
                    id if id.starts_with("panel_") => {
                        let panel_type = match id {
                            "panel_file_browser" => "FileBrowser",
                            "panel_layer_manager" => "Inspector",
                            "panel_plot" => "PlotPanel",
                            "panel_clusters" => "ClusterPanel",
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
                    "close_window" => {
                        // The UI's stores persist on every change, so the
                        // session is already saved when the window goes.
                        let windows = app.webview_windows();
                        let target = windows
                            .values()
                            .find(|w| w.is_focused().unwrap_or(false))
                            .or_else(|| windows.get("main"))
                            .or_else(|| windows.values().next());
                        if let Some(window) = target {
                            if let Err(e) = window.close() {
                                eprintln!("Failed to close the window: {}", e);
                            }
                        }
                    }
                    // View › Layout, View › Workspace and File › Close Tab
                    id if id.starts_with("layout_") || id.starts_with("workspace_") => {
                        let Some(payload) = menu_builder::navigation_menu_action(id) else {
                            return;
                        };
                        if let Err(e) = app.emit("workspace-action", payload) {
                            eprintln!("Failed to emit workspace event: {}", e);
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
            // The bridge plugin has already registered the canonical state.
            // Warm up its renderer off the UI thread; frontend initialization
            // uses the same serialized path and observes the same ready slot.
            let render_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = render_app.state::<BridgeState>().ensure_render_loop().await {
                    log::error!("Render-loop warmup failed; frontend may retry: {error}");
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
            flush_startup_actions,
            copy_png_to_clipboard
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod open_dialog_tests {
    use super::{open_dialog_allows_multiple, OPEN_DIALOG_EXTENSIONS};

    #[test]
    fn filter_extensions_are_single_components() {
        // macOS matches the last extension only: "nii.gz" greys out .nii.gz files.
        assert!(OPEN_DIALOG_EXTENSIONS.iter().all(|e| !e.contains('.')));
        for ext in ["nii", "gz", "gii"] {
            assert!(OPEN_DIALOG_EXTENSIONS.contains(&ext), "{ext} missing");
        }
    }

    #[test]
    fn multi_select_only_where_each_file_is_loaded_in_turn() {
        assert!(open_dialog_allows_multiple(None));
        assert!(open_dialog_allows_multiple(Some("add-layer")));
        assert!(!open_dialog_allows_multiple(Some("new-workspace")));
        assert!(!open_dialog_allows_multiple(Some("comparison")));
    }
}

#[cfg(test)]
mod clipboard_tests {
    use super::{png_to_rgba, CLIPBOARD_MAX_RGBA_BYTES, CLIPBOARD_TOO_LARGE};

    fn encode(width: u32, height: u32, color: png::ColorType, data: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(color);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .unwrap()
            .write_image_data(data)
            .unwrap();
        out
    }

    #[test]
    fn decodes_rgba_and_rgb_to_rgba() {
        let rgba = encode(2, 1, png::ColorType::Rgba, &[1, 2, 3, 4, 5, 6, 7, 8]);
        assert_eq!(
            png_to_rgba(&rgba, CLIPBOARD_MAX_RGBA_BYTES).unwrap(),
            (2, 1, vec![1, 2, 3, 4, 5, 6, 7, 8])
        );
        let rgb = encode(1, 2, png::ColorType::Rgb, &[9, 8, 7, 6, 5, 4]);
        assert_eq!(
            png_to_rgba(&rgb, CLIPBOARD_MAX_RGBA_BYTES).unwrap(),
            (1, 2, vec![9, 8, 7, 255, 6, 5, 4, 255])
        );
        let gray = encode(1, 1, png::ColorType::Grayscale, &[42]);
        assert_eq!(
            png_to_rgba(&gray, CLIPBOARD_MAX_RGBA_BYTES).unwrap().2,
            vec![42, 42, 42, 255]
        );
    }

    #[test]
    fn rejects_bytes_that_are_not_a_png() {
        assert!(png_to_rgba(&[0, 1, 2, 3], CLIPBOARD_MAX_RGBA_BYTES)
            .unwrap_err()
            .starts_with("Not a PNG"));
    }

    #[test]
    fn refuses_an_image_over_the_cap_from_its_header() {
        // 4 × 4 RGBA is 64 bytes: a 63-byte cap refuses it before decoding.
        let png = encode(4, 4, png::ColorType::Rgba, &[0; 64]);
        let err = png_to_rgba(&png, 63).unwrap_err();
        assert!(err.starts_with(CLIPBOARD_TOO_LARGE), "{err}");
        assert!(err.contains("4×4"));
        assert_eq!(png_to_rgba(&png, 64).unwrap().2.len(), 64);
        assert_eq!(CLIPBOARD_MAX_RGBA_BYTES, 256 * 1024 * 1024);
    }
}
