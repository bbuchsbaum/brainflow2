/**
 * Layer types for neuroimaging visualization
 */

export interface Layer {
  id: string;
  name: string;
  volumeId: string;
  type: 'anatomical' | 'functional' | 'mask' | 'label';
  visible: boolean;
  order: number;
  loading?: boolean;
  error?: string;
}

export interface LayerRender {
  opacity: number;
  intensity: [number, number];
  threshold: [number, number];
  colormap: string;
  interpolation: 'nearest' | 'linear';
}

export interface LayerState extends Layer {
  render: LayerRender;
}