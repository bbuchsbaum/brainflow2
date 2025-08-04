const COMMANDS: &[&str] = &[
    "load_file",
    "get_volume_bounds",
    // "world_to_voxel", // REMOVED - Unused coordinate transformation
    "set_volume_timepoint",
    "get_volume_timepoint",
    "get_volume_info",
    // "get_timeseries_matrix", // REMOVED - Returns unimplemented
    "get_initial_views",
    "recalculate_view_for_dimensions",
    "request_layer_gpu_resources",
    "release_layer_gpu_resources",
    "fs_list_directory",
    "init_render_loop",
    "resize_canvas",
    "update_frame_ubo",
    "update_frame_for_synchronized_view",
    "set_crosshair",
    "set_view_plane",
    // "render_frame", // REMOVED - Redundant with apply_and_render_view_state
    "create_offscreen_render_target",
    // "render_to_image", // REMOVED - Redundant with apply_and_render_view_state
    // "render_to_image_binary", // REMOVED - Redundant with apply_and_render_view_state
    "clear_render_layers",
    "update_layer_opacity",
    "update_layer_colormap",
    "update_layer_intensity",
    "update_layer_threshold",
    "set_layer_mask",
    "request_frame",
    "add_render_layer",
    "patch_layer",
    "compute_layer_histogram",
    "sample_world_coordinate",
    "render_view", // New unified render method
    "apply_and_render_view_state",
    "apply_and_render_view_state_binary",
    "apply_and_render_view_state_raw",
    "query_slice_axis_meta",
    "batch_render_slices",
    // Atlas management commands
    "get_atlas_catalog",
    "get_filtered_atlases",
    "get_atlas_entry",
    "toggle_atlas_favorite",
    "get_recent_atlases",
    "get_favorite_atlases",
    "validate_atlas_config",
    "load_atlas",
    "start_atlas_progress_monitoring",
    "get_atlas_subscription_count",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
