/**
 * ViewState - The single source of truth for the entire application
 * This is the core state that drives all rendering
 */

import type { ViewPlane, WorldCoordinates, ViewType } from "./coordinates";
import type { AtlasConfig } from "./atlas";
import type { AtlasPaletteKind } from "./atlasPalette";

export interface CrosshairState {
  world_mm: WorldCoordinates;
  visible: boolean;
}

export interface LayerOutlineConfig {
  enabled: boolean;
  selectedLabelId: number;
  color: [number, number, number, number];
  thicknessPx: number;
}

// Intensity-modulated alpha ("transparent thresholding"). When mode !== 'off',
// overlay opacity becomes a function of voxel magnitude, ramped across the
// visible intensity window above the threshold.
export type AlphaModMode = "off" | "linear" | "gamma";

export interface AlphaModConfig {
  mode: AlphaModMode;
  gamma: number; // exponent used when mode === 'gamma'
  center: number; // two-sided magnitude center (0 for signed/diverging maps)
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
  intensity: [number, number]; // [min, max]
  threshold: [number, number]; // [low, high]
  blendMode?: "alpha" | "additive" | "max" | "min";
  interpolation?: "nearest" | "linear"; // Texture sampling mode
  layerMode?: "scalar" | "label" | "mask";
  outline?: LayerOutlineConfig;
  alphaMod?: AlphaModConfig;
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
