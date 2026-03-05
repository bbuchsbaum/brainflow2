/**
 * Backend Transport Interface
 * Abstraction layer for backend communication
 */

import { invoke } from '@tauri-apps/api/core';

export interface BackendTransport {
  invoke<T>(cmd: string, args?: unknown): Promise<T>;
}

/**
 * Production transport using Tauri's invoke
 */
export class TauriTransport implements BackendTransport {
  async invoke<T>(cmd: string, args?: any): Promise<T> {
    try {
      // Map plugin commands to their namespaced versions
      const namespacedCmd = this.getNamespacedCommand(cmd);
      return await invoke<T>(namespacedCmd, args);
    } catch (error) {
      console.error(`Tauri command ${cmd} failed:`, error);
      throw error;
    }
  }
  
  private getNamespacedCommand(cmd: string): string {
    // Commands from the api-bridge plugin need the plugin namespace
    const apiBridgeCommands = [
      'render_view', // New unified render method
      'apply_and_render_view_state',
      'apply_and_render_view_state_binary',
      'apply_and_render_view_state_raw',
      'load_file',
      'load_surface',
      'unload_surface',
      'load_surface_overlay',
      'unload_surface_overlay',
      'get_surface_overlay_data',
      'get_surface_geometry',
      'get_volume_bounds',
      'unload_volume',
      'get_volume_info',
      'set_volume_timepoint',
      'get_volume_timepoint',
      'get_initial_views',
      'fs_list_directory',
      'remote_mount_connect',
      'remote_mount_respond_host_key',
      'remote_mount_respond_auth',
      'remote_mount_unmount',
      'list_remote_mount_profiles',
      'remove_remote_mount_profile',
      'sample_world_coordinate',
      'init_render_loop',
      'resize_canvas',
      'create_offscreen_render_target',
      'add_render_layer',
      'remove_render_layer',
      'clear_render_layers',
      'patch_layer',
      'compute_layer_histogram',
      'request_layer_gpu_resources',
      'release_layer_gpu_resources',
      'update_frame_ubo',
      'update_frame_for_synchronized_view',
      'recalculate_all_views',
      'recalculate_view_for_dimensions',
      'query_slice_axis_meta',
      'batch_render_slices',
      // Atlas management commands
      'get_atlas_catalog',
      'get_filtered_atlases',
      'get_atlas_entry',
      'toggle_atlas_favorite',
      'get_recent_atlases',
      'get_favorite_atlases',
      'validate_atlas_config',
      'load_atlas',
      'start_atlas_progress_monitoring',
      'get_atlas_subscription_count',
      'get_atlas_stats',
      'get_nifti_header_info',
      // Surface template commands
      'load_surface_template',
      'get_surface_template_catalog'
    ];
    
    if (apiBridgeCommands.includes(cmd)) {
      return `plugin:api-bridge|${cmd}`;
    }
    
    // Core Tauri commands don't need namespace
    return cmd;
  }
}

/**
 * Mock transport for testing and development
 */
export class MockTransport implements BackendTransport {
  private responses = new Map<string, any>();
  private callLog: Array<{ cmd: string; args: any; timestamp: number }> = [];
  
  async invoke<T>(cmd: string, args?: unknown): Promise<T> {
    // Log the call
    this.callLog.push({
      cmd,
      args,
      timestamp: Date.now()
    });
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 10 + Math.random() * 20));
    
    // Return mock response
    const response = this.responses.get(cmd);
    if (response instanceof Function) {
      return response(args);
    }
    if (response !== undefined) {
      return response;
    }
    
    // Default responses for common commands
    return this.getDefaultResponse(cmd, args) as T;
  }
  
  /**
   * Set mock response for a command
   */
  setMockResponse(cmd: string, response: any) {
    this.responses.set(cmd, response);
  }
  
  /**
   * Get call history for testing
   */
  getCallLog() {
    return [...this.callLog];
  }
  
  /**
   * Clear call history
   */
  clearCallLog() {
    this.callLog.length = 0;
  }
  
  private getDefaultResponse(cmd: string, args: any): any {
    switch (cmd) {
      case 'render_view':
        // Return mock data based on format
        if (args?.format === 'png') {
          // Return mock PNG data
          return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG header
        } else {
          // Return mock RGBA data with proper header (8 bytes: width + height as uint32)
          const width = 256;
          const height = 256;
          const headerSize = 8;
          const pixelDataSize = width * height * 4;
          const totalSize = headerSize + pixelDataSize;
          const buffer = new Uint8Array(totalSize);

          // Write header: width and height as uint32 little-endian
          const view = new DataView(buffer.buffer);
          view.setUint32(0, width, true);  // width at offset 0, little-endian
          view.setUint32(4, height, true); // height at offset 4, little-endian

          // Fill pixel data with mock data (semi-transparent gray)
          for (let i = headerSize; i < totalSize; i += 4) {
            buffer[i] = 128;     // R
            buffer[i + 1] = 128; // G
            buffer[i + 2] = 128; // B
            buffer[i + 3] = 200; // A
          }
          return buffer;
        }
        
      case 'apply_and_render_view_state':
        // Return mock PNG data as Uint8Array for binary optimization
        return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG header
        
      case 'apply_and_render_view_state_binary':
        // Return mock PNG data as Uint8Array for binary optimization
        return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG header
        
      case 'apply_and_render_view_state_raw':
        // Return mock RGBA data directly as Uint8Array
        const w = 256;
        const h = 256;
        const raw = new Uint8Array(w * h * 4);
        // Fill with mock data (semi-transparent gray)
        for (let i = 0; i < raw.length; i += 4) {
          raw[i] = 128;     // R
          raw[i + 1] = 128; // G
          raw[i + 2] = 128; // B
          raw[i + 3] = 200; // A
        }
        return raw;
      case 'recalculate_view_for_dimensions': {
        const dims = args?.dimensions || [256, 256];
        return {
          origin_mm: [0, 0, 0],
          u_mm: [1, 0, 0],
          v_mm: [0, 1, 0],
          width_px: dims[0],
          height_px: dims[1]
        };
      }
      case 'recalculate_all_views': {
        const dimsByView = args?.dimensionsByView || {};
        const buildView = (key: string) => {
          const dim = dimsByView[key] || [256, 256];
          return {
            origin_mm: [0, 0, 0],
            u_mm: [1, 0, 0],
            v_mm: [0, 1, 0],
            width_px: dim[0],
            height_px: dim[1]
          };
        };
        return {
          axial: buildView('axial'),
          sagittal: buildView('sagittal'),
          coronal: buildView('coronal')
        };
      }

      case 'set_volume_timepoint':
        return null;

      case 'get_volume_timepoint':
        return 0;

      case 'get_atlas_stats': {
        const now = Date.now();
        return {
          total_layers: 16,
          used_layers: 4,
          free_layers: 12,
          allocations: 4,
          releases: 0,
          high_watermark: 4,
          full_events: 0,
          is_3d: false,
          last_allocation_ms: now,
          last_release_ms: now
        };
      }
        
      case 'load_file':
        return {
          id: 'mock-volume-' + Math.random().toString(36).substr(2, 9),
          name: args?.path?.split('/').pop() || 'mock-volume.nii.gz',
          dims: [182, 218, 182],
          voxel_size: [1.0, 1.0, 1.0],
          affine: [
            [1, 0, 0, -91],
            [0, 1, 0, -126], 
            [0, 0, 1, -72],
            [0, 0, 0, 1]
          ]
        };
        
      case 'fs_list_directory':
        // Generate some mock files for testing
        const basePath = args?.path || '/mock';
        const mockFiles = [
          { id: `${basePath}/data`, name: 'data', isDir: true, parentIdx: null, iconId: 1 },
          { id: `${basePath}/brain.nii.gz`, name: 'brain.nii.gz', isDir: false, parentIdx: null, iconId: 2 },
          { id: `${basePath}/mask.nii.gz`, name: 'mask.nii.gz', isDir: false, parentIdx: null, iconId: 2 },
        ];
        
        return { nodes: mockFiles };
        
      case 'sample_world_coordinate':
        return {
          value: Math.random() * 1000,
          coordinate: args?.worldCoord || [0, 0, 0]
        };
        
      default:
        console.warn(`Mock transport: No response defined for command '${cmd}'`);
        return null;
    }
  }
}

// Global transport instance
let globalTransport: BackendTransport | null = null;

/**
 * Get the global transport instance
 */
export function getTransport(): BackendTransport {
  if (!globalTransport) {
    // Check if we're in a Tauri environment
    if (typeof window !== 'undefined' && (window as any).__TAURI__) {
      globalTransport = new TauriTransport();
    } else {
      throw new Error(
        'Tauri environment not detected. Please run the application with "cargo tauri dev" instead of "npm run dev".'
      );
    }
  }
  return globalTransport;
}

/**
 * Set the global transport (useful for testing)
 */
export function setTransport(transport: BackendTransport) {
  globalTransport = transport;
}
