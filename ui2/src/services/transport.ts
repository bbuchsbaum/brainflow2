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
      'apply_and_render_view_state',
      'apply_and_render_view_state_binary',
      'apply_and_render_view_state_raw',
      'load_file',
      'get_volume_bounds',
      'get_initial_views',
      'fs_list_directory',
      'sample_world_coordinate',
      'init_render_loop',
      'resize_canvas',
      'create_offscreen_render_target',
      'add_render_layer',
      'remove_render_layer',
      'clear_render_layers',
      'patch_layer',
      'request_layer_gpu_resources',
      'release_layer_gpu_resources',
      'update_frame_ubo',
      'update_frame_for_synchronized_view'
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
      case 'apply_and_render_view_state':
        // Return mock PNG data as Uint8Array for binary optimization
        return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG header
        
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
          { id: `${basePath}/scans`, name: 'scans', isDir: true, parentIdx: null, iconId: 1 },
          { id: `${basePath}/brain.nii.gz`, name: 'brain.nii.gz', isDir: false, parentIdx: null, iconId: 2 },
          { id: `${basePath}/mask.nii.gz`, name: 'mask.nii.gz', isDir: false, parentIdx: null, iconId: 2 },
          { id: `${basePath}/T1.nii`, name: 'T1.nii', isDir: false, parentIdx: null, iconId: 2 },
          { id: `${basePath}/fMRI_run1.nii.gz`, name: 'fMRI_run1.nii.gz', isDir: false, parentIdx: null, iconId: 2 },
          { id: `${basePath}/surface.gii`, name: 'surface.gii', isDir: false, parentIdx: null, iconId: 3 },
          { id: `${basePath}/README.md`, name: 'README.md', isDir: false, parentIdx: null, iconId: 4 },
          { id: `${basePath}/analysis.json`, name: 'analysis.json', isDir: false, parentIdx: null, iconId: 5 },
          { id: `${basePath}/participants.tsv`, name: 'participants.tsv', isDir: false, parentIdx: null, iconId: 6 },
        ];
        
        return {
          nodes: mockFiles
        };
        
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