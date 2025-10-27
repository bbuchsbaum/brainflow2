/**
 * Atlas and Template types for the frontend
 * Based on the Rust types in core/atlases/src/types.rs
 */

export enum AtlasSource {
  BuiltIn = "BuiltIn",
  TemplateFlow = "TemplateFlow",
  Custom = "Custom",
}

export enum AtlasDataType {
  Volume = "Volume",
  Surface = "Surface",
  Both = "Both",
}

export enum AtlasCategory {
  Cortical = "Cortical",
  Subcortical = "Subcortical",
  WholeBrain = "WholeBrain",
  Specialized = "Specialized",
  Template = "Template",
}

export interface SpaceInfo {
  id: string;
  name: string;
  description: string;
  data_type: AtlasDataType;
}

export interface ResolutionInfo {
  value: string; // "1mm", "2mm", etc.
  description: string;
}

export interface AtlasConfig {
  atlas_id: string;
  space: string;
  resolution: string;
  networks?: number; // For Schaefer: 7 or 17
  parcels?: number; // For Schaefer: 100-1000
  template_params?: Record<string, string>;
}

export interface AtlasCatalogEntry {
  id: string;
  name: string;
  description: string;
  source: AtlasSource;
  category: AtlasCategory;
  allowed_spaces: SpaceInfo[];
  resolutions: ResolutionInfo[];
  network_options?: number[];
  parcel_options?: number[];
  is_favorite: boolean;
  last_used?: string; // ISO date string
  citation?: string;
  is_cached: boolean;
  download_size_mb?: number;
}

export enum LoadingStage {
  CheckingCache = "CheckingCache",
  Downloading = "Downloading",
  Loading = "Loading",
  Processing = "Processing",
  Complete = "Complete",
  Error = "Error",
}

export enum AtlasLoadStatus {
  InProgress = "InProgress",
  Completed = "Completed",
  Failed = "Failed",
}

export interface AtlasLoadProgress {
  atlas_id: string;
  operation: string;
  status: AtlasLoadStatus;
  message: string;
  percent_complete: number; // 0-100
}

export interface AtlasMetadata {
  id: string;
  name: string;
  description: string;
  n_regions: number;
  space: string;
  resolution: string;
  citation?: string;
  bounds_mm?: [[number, number, number], [number, number, number]]; // [min, max]
  data_range?: [number, number];
}

export interface AtlasLoadResult {
  success: boolean;
  atlas_metadata?: AtlasMetadata;
  volume_handle?: string;
  error_message?: string;
}

export interface AtlasFilter {
  search_query?: string;
  category?: AtlasCategory;
  source?: AtlasSource;
  space?: string;
  data_type?: AtlasDataType;
  show_favorites_only: boolean;
  show_cached_only: boolean;
}

export interface AtlasStats {
  totalLayers: number;
  usedLayers: number;
  freeLayers: number;
  allocations: number;
  releases: number;
  highWatermark: number;
  fullEvents: number;
  is3D: boolean;
  lastAllocationMs?: number;
  lastReleaseMs?: number;
}

// Default filter for initializing the UI
export const createDefaultAtlasFilter = (): AtlasFilter => ({
  show_favorites_only: false,
  show_cached_only: false,
});

// Helper functions for UI display
export const getAtlasCategoryDisplayName = (category: AtlasCategory): string => {
  switch (category) {
    case AtlasCategory.Cortical:
      return "Cortical";
    case AtlasCategory.Subcortical:
      return "Subcortical";
    case AtlasCategory.WholeBrain:
      return "Whole Brain";
    case AtlasCategory.Specialized:
      return "Specialized";
    case AtlasCategory.Template:
      return "Template";
    default:
      return category;
  }
};

export const getAtlasSourceDisplayName = (source: AtlasSource): string => {
  switch (source) {
    case AtlasSource.BuiltIn:
      return "Built-in";
    case AtlasSource.TemplateFlow:
      return "TemplateFlow";
    case AtlasSource.Custom:
      return "Custom";
    default:
      return source;
  }
};

export const getDataTypeDisplayName = (dataType: AtlasDataType): string => {
  switch (dataType) {
    case AtlasDataType.Volume:
      return "Volume";
    case AtlasDataType.Surface:
      return "Surface";
    case AtlasDataType.Both:
      return "Volume + Surface";
    default:
      return dataType;
  }
};
