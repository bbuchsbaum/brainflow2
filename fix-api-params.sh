#!/bin/bash

# Quick script to show all the parameter mismatches we need to fix

echo "=== Checking Rust function signatures ==="
echo ""

# Extract command function signatures from api_bridge
grep -A 2 "#\[command\]" /Users/bbuchsbaum/code/brainflow2/core/api_bridge/src/lib.rs | grep -E "^async fn|^fn" | sed 's/async fn //' | sed 's/fn //' | awk -F'(' '{print $1 " -> " $2}' | awk -F')' '{print $1}'

echo ""
echo "=== Parameter mapping needed ==="
echo ""
echo "load_file -> path_str: String"
echo "world_to_voxel -> volume_id: String, world_coord: [f32; 3]"
echo "get_timeseries_matrix -> volume_id: String, coords: Vec<[f32; 3]>"
echo "request_layer_gpu_resources -> layer_spec: LayerSpec"
echo "release_layer_gpu_resources -> layer_id: String"
echo "fs_list_directory -> path_str: String"
echo "resize_canvas -> width: u32, height: u32"
echo "update_frame_ubo -> origin_mm: Vec<f32>, u_mm: Vec<f32>, v_mm: Vec<f32>"
echo "set_crosshair -> world_coords: Vec<f32>"
echo "set_view_plane -> plane_id: u32"
echo "add_render_layer -> atlas_index: u32, opacity: f32, texture_coords: Vec<f32>"
echo "patch_layer -> layer_id: String, patch: LayerPatch"