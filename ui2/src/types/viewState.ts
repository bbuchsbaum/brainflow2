/**
 * ViewState - The single source of truth for the entire application
 * This is the core state that drives all rendering
 */

import type { ViewPlane, WorldCoordinates, ViewType } from './coordinates';
import type { AtlasConfig } from './atlas';
import type { AtlasPaletteKind } from './atlasPalette';

export interface CrosshairState {
  world_mm: WorldCoordinates;
  visible: boolean;
}

// Layer render properties that match backend expectations
export interface ViewLayer {
  id: string;
  name: string;
  volumeId: string;
  visible: boolean;
  order?: number;
  opacity: number;
  colormap: string;
  colormapId?: number;
  intensity: [number, number];  // [min, max]
  threshold: [number, number];  // [low, high]
  blendMode?: 'alpha' | 'additive' | 'max' | 'min';
  interpolation?: 'nearest' | 'linear';  // Texture sampling mode
  atlasConfig?: AtlasConfig;
  atlasPaletteKind?: AtlasPaletteKind;
  atlasPaletteSeed?: number;
  atlasMaxLabel?: number;
}

export interface ViewState {
  // View geometry - frontend owns this completely
  views: Record<ViewType, ViewPlane>;
  
  // Crosshair state
  crosshair: CrosshairState;
  
  // Layer stack with render properties
  layers: ViewLayer[];
  
  // Current timepoint for 4D volumes (0-indexed)
  // Only used when displaying 4D time series data
  timepoint?: number;
}

export interface ViewStateRevisions {
  state: number;
  layers: number;
  crosshair: number;
  timepoint: number;
  views: Record<ViewType, number>;
}
