/**
 * TypeScript types that exactly match the Rust render_loop::view_state structures
 * These are used for the batch_render_slices command
 */

// Matches Rust's SliceOrientation enum
export type SliceOrientation = "Axial" | "Coronal" | "Sagittal";

// Matches Rust's BlendMode enum  
export type BlendMode = "Normal" | "Additive" | "Multiply" | "Maximum";

// Matches Rust's ThresholdMode enum
export type ThresholdMode = "Range" | "Absolute";

// Matches Rust's ThresholdConfig struct
export interface ThresholdConfig {
  mode: ThresholdMode;
  range: [number, number]; // (f32, f32) tuple
}

// Matches Rust's CameraState struct
export interface CameraState {
  world_center: [number, number, number]; // [f32; 3]
  fov_mm: number; // f32
  orientation: SliceOrientation;
  frame_origin?: [number, number, number, number]; // Option<[f32; 4]>
  frame_u_vec?: [number, number, number, number]; // Option<[f32; 4]>
  frame_v_vec?: [number, number, number, number]; // Option<[f32; 4]>
}

// Matches Rust's LayerConfig struct
export interface LayerConfig {
  volume_id: string;
  opacity: number; // f32
  colormap_id: number; // u32
  blend_mode: BlendMode;
  intensity_window: [number, number]; // (f32, f32) tuple
  threshold: ThresholdConfig | null; // Option<ThresholdConfig>
  visible: boolean;
}

// Matches Rust's ViewState struct
export interface RustViewState {
  layout_version: number; // u32
  camera: CameraState;
  crosshair_world: [number, number, number]; // [f32; 3]
  layers: LayerConfig[];
  viewport_size: [number, number]; // [u32; 2]
  show_crosshair: boolean;
}

// Type guard to validate ViewState structure
export function isValidRustViewState(obj: any): obj is RustViewState {
  if (!obj || typeof obj !== 'object') return false;
  
  // Check required fields
  if (typeof obj.layout_version !== 'number') return false;
  if (!obj.camera || typeof obj.camera !== 'object') return false;
  if (!Array.isArray(obj.crosshair_world) || obj.crosshair_world.length !== 3) return false;
  if (!Array.isArray(obj.layers)) return false;
  if (!Array.isArray(obj.viewport_size) || obj.viewport_size.length !== 2) return false;
  if (typeof obj.show_crosshair !== 'boolean') return false;
  
  // Validate camera
  const camera = obj.camera;
  if (!Array.isArray(camera.world_center) || camera.world_center.length !== 3) return false;
  if (typeof camera.fov_mm !== 'number') return false;
  if (!['Axial', 'Coronal', 'Sagittal'].includes(camera.orientation)) return false;
  
  // Validate layers
  for (const layer of obj.layers) {
    if (typeof layer.volume_id !== 'string') return false;
    if (typeof layer.opacity !== 'number') return false;
    if (typeof layer.colormap_id !== 'number') return false;
    if (!['Normal', 'Additive', 'Multiply', 'Maximum'].includes(layer.blend_mode)) return false;
    if (!Array.isArray(layer.intensity_window) || layer.intensity_window.length !== 2) return false;
    if (typeof layer.visible !== 'boolean') return false;
    
    // Validate threshold
    if (layer.threshold !== null) {
      if (!layer.threshold || typeof layer.threshold !== 'object') return false;
      if (!['Range', 'Absolute'].includes(layer.threshold.mode)) return false;
      if (!Array.isArray(layer.threshold.range) || layer.threshold.range.length !== 2) return false;
    }
  }
  
  return true;
}