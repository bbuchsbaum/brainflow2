/**
 * Atlas and Template types for the frontend
 * Based on the Rust types in core/atlases/src/types.rs
 */

import type { VolumeHandleInfo } from '@brainflow/api';
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
  data_type?: string; // "volume" or "surface"
  surf_type?: string; // "pial", "inflated", etc.
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
  volume_handle_info?: VolumeHandleInfo;
  error_message?: string;
}

export interface SurfaceAtlasLabelInfo {
  id: number;
  name: string;
  color?: [number, number, number]; // RGB 0-255
  hemisphere?: string; // "Left" | "Right"
  network?: string;
}

export interface SurfaceAtlasLoadResult {
  atlas_metadata: AtlasMetadata;
  labels_lh: number[]; // per-vertex labels, left hemisphere
  labels_rh: number[]; // per-vertex labels, right hemisphere
  label_info: SurfaceAtlasLabelInfo[];
  space: string; // e.g. "fsaverage"
  n_vertices_lh: number;
  n_vertices_rh: number;
}

export interface ParcellationReference {
  reference_id: string;
  source_name?: string;
  schema_version: string;
  atlas_id: string;
  atlas_name?: string;
  atlas_space?: string;
  atlas_class?: string;
  declared_parcel_count?: number;
  parcel_row_count: number;
  value_columns: string[];
  created_at_unix_ms: number;
}

export interface ParcelBindingCoveragePreview {
  reference_id: string;
  atlas_id: string;
  declared_parcel_count?: number;
  parcel_row_count: number;
  unique_parcel_id_count: number;
  matched_parcel_count: number;
  coverage_percent?: number;
  estimated_missing_count?: number;
  estimated_extra_count?: number;
  value_columns: string[];
}

export interface SurfaceLabelParcellationImportResult {
  reference: ParcellationReference;
  vertex_count: number;
  unique_label_count: number;
  nonzero_label_count: number;
  max_label: number;
  background_label: number;
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
