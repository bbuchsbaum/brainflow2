#!/bin/bash

# Quick command reference and tester for Tauri API bridge

echo "🌉 Tauri API Bridge Command Reference"
echo "===================================="
echo ""
echo "Available commands:"
echo ""
echo "1. load_file"
echo "   Args: path (string)"
echo "   Example: {\"path\": \"/test-data/unit/toy_t1w.nii.gz\"}"
echo ""
echo "2. supports_webgpu"
echo "   Args: none"
echo "   Example: {}"
echo ""
echo "3. fs_list_directory"
echo "   Args: dir (string)"
echo "   Example: {\"dir\": \"/test-data\"}"
echo ""
echo "4. world_to_voxel"
echo "   Args: volumeId (string), worldCoord ([f32; 3])"
echo "   Example: {\"volumeId\": \"volume-123\", \"worldCoord\": [10.5, 20.3, 30.1]}"
echo ""
echo "5. set_crosshair"
echo "   Args: worldCoords ([f32; 3])"
echo "   Example: {\"worldCoords\": [100, 150, 75]}"
echo ""
echo "6. set_frame_params"
echo "   Args: origin, uBasis, vBasis (all [f32; 4])"
echo "   Example: {\"origin\": [0,0,0,1], \"uBasis\": [1,0,0,0], \"vBasis\": [0,1,0,0]}"
echo ""
echo "7. request_layer_gpu_resources"
echo "   Args: layerSpec (object)"
echo "   Example: {\"layerSpec\": {\"type\": \"Volume\", \"id\": \"layer-1\", \"source_resource_id\": \"volume-123\", \"colormap\": \"grayscale\"}}"
echo ""
echo "====================================="
echo ""

# If a command is provided, show its example
if [ $# -eq 1 ]; then
    case "$1" in
        "load_file")
            echo "Testing load_file command..."
            echo "cargo tauri dev"
            echo "Then in browser console:"
            echo "await window.__TAURI__.core.invoke('plugin:api-bridge|load_file', {path: '/Users/bbuchsbaum/code/brainflow2/test-data/unit/toy_t1w.nii.gz'})"
            ;;
        "supports_webgpu")
            echo "Testing supports_webgpu command..."
            echo "await window.__TAURI__.core.invoke('plugin:api-bridge|supports_webgpu')"
            ;;
        "fs_list_directory")
            echo "Testing fs_list_directory command..."
            echo "await window.__TAURI__.core.invoke('plugin:api-bridge|fs_list_directory', {dir: '/Users/bbuchsbaum/code/brainflow2/test-data'})"
            ;;
        *)
            echo "Unknown command: $1"
            echo "Usage: $0 [command_name]"
            ;;
    esac
else
    echo "To test a specific command, run:"
    echo "$0 <command_name>"
    echo ""
    echo "To test in the browser console:"
    echo "1. Run: cargo tauri dev"
    echo "2. Open browser console (F12)"
    echo "3. Use window.__TAURI__.core.invoke()"
fi