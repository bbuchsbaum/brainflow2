const COMMANDS: &[&str] = &[
    "load_file",
    "world_to_voxel",
    "get_timeseries_matrix",
    "request_layer_gpu_resources",
    "release_layer_gpu_resources",
    "fs_list_directory",
    "init_render_loop",
    "resize_canvas",
    "update_frame_ubo",
    "update_frame_for_synchronized_view",
    "set_crosshair",
    "set_view_plane",
    "render_frame",
    "create_offscreen_render_target",
    "render_to_image",
    "add_render_layer",
    "patch_layer",
    "sample_world_coordinate",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .build();
}