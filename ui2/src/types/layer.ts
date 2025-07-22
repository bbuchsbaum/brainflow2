/**
 * Layer types for the new React UI
 * Clean separation between UI state and render state
 */

export interface LayerRender {
  opacity: number;
  colormap: string;
  intensityMin: number;
  intensityMax: number;
  thresholdLow: number;
  thresholdHigh: number;
}

export interface LayerUI {
  id: string;
  name: string;
  volumeId: string; // Reference to the backend volume resource
  visible: boolean;
  isSelected: boolean;
  gpuStatus: 'unallocated' | 'allocating' | 'ready' | 'error';
  error?: string | null;
}

export interface Layer extends LayerUI {
  render: LayerRender;
}