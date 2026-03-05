/**
 * Shared type definitions for the atlas menu listener system.
 */

export interface AtlasPresetPayload {
  atlas_id: string;
  space?: string;
  resolution?: string;
  networks?: number;
  parcels?: number;
  data_type?: string;
  surf_type?: string;
}

export interface AtlasMenuActionEvent {
  action: 'load-atlas-preset' | 'load-atlas' | 'load-surface-atlas-preset';
  payload: AtlasPresetPayload;
}
