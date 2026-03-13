/**
 * Layer types for neuroimaging visualization
 */

import type { AtlasConfig } from './atlas';
import type { AtlasPaletteKind } from './atlasPalette';

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
  colormapId?: number;
  interpolation: 'nearest' | 'linear';
  atlasConfig?: AtlasConfig;
  atlasPaletteKind?: AtlasPaletteKind;
  atlasPaletteSeed?: number;
  atlasMaxLabel?: number;
}

export interface LayerState extends Layer {
  render: LayerRender;
}
