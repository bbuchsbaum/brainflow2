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

/** "uniform": `color`; "lut": each region's table colour (alpha = color[3] x LUT alpha). */
export type OutlineColorMode = "uniform" | "lut";

export interface LayerOutlineConfig {
  enabled: boolean;
  selectedLabelId: number;
  color: [number, number, number, number];
  thicknessPx: number;
  /** Omitted: "uniform". */
  colorMode?: OutlineColorMode;
  /**
   * Dark halo width in screen pixels (0 or omitted: none) around the centred
   * outline: outside a selected region, on both sides when every boundary is
   * drawn. The renderer keeps line plus halo within about two voxels on screen.
   */
  haloPx?: number;
  haloColor?: [number, number, number, number];
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
  /** Label layers: regions filled, outlined, or both (utils/labelDisplay.ts). */
  labelDisplay?: "fill" | "outline" | "both";
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
