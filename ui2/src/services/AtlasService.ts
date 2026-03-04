/**
 * Atlas Service - TypeScript wrapper for atlas Tauri commands
 */

import { invoke } from '@tauri-apps/api/core';
import { safeListen, safeUnlisten, type Unlisten } from '@/utils/eventUtils';
import { getVolumeLoadingService } from './VolumeLoadingService';
import { AtlasPaletteService } from './AtlasPaletteService';
import { formatTauriError } from '@/utils/formatTauriError';
import type { Layer } from '@/types/layers';
import type {
  AtlasCatalogEntry,
  AtlasConfig,
  AtlasFilter,
  AtlasLoadResult,
  AtlasLoadProgress,
  ParcelBindingCoveragePreview,
  ParcellationReference,
  SurfaceAtlasLoadResult,
  SurfaceLabelParcellationImportResult,
} from '../types/atlas';
import type { AtlasPaletteKind, AtlasPaletteResponse } from '@/types/atlasPalette';

export type ProgressCallback = (progress: AtlasLoadProgress) => void;

export class AtlasService {
  private static inFlightRequests = new Map<
    string,
    Promise<{ result: AtlasLoadResult; layer: Layer | null }>
  >();

  private static normalizePaletteResolution(resolution: string | undefined): string {
    return resolution === '1mm' || resolution === '2mm' ? resolution : '1mm';
  }

  private static normalizePaletteConfig(config: AtlasConfig): AtlasConfig {
    return {
      ...config,
      resolution: AtlasService.normalizePaletteResolution(config.resolution),
      // Palette generation is atlas-record based and independent of runtime data path.
      // Strip surface-only fields to avoid backend validation rejecting "surface" mode config.
      data_type: undefined,
      surf_type: undefined,
    };
  }
  /**
   * Get the complete atlas catalog
   */
  static async getCatalog(signal?: AbortSignal): Promise<AtlasCatalogEntry[]> {
    try {
      const result = await invoke('plugin:api-bridge|get_atlas_catalog');
      
      // Check if the operation was aborted
      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }
      
      return result;
    } catch (error) {
      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }
      console.error('Failed to get atlas catalog:', error);
      throw new Error(`Failed to get atlas catalog: ${error}`);
    }
  }

  /**
   * Get filtered atlas entries
   */
  static async getFilteredAtlases(filter: AtlasFilter, signal?: AbortSignal): Promise<AtlasCatalogEntry[]> {
    try {
      const result = await invoke('plugin:api-bridge|get_filtered_atlases', { filter });
      
      // Check if the operation was aborted
      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }
      
      return result;
    } catch (error) {
      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }
      console.error('Failed to get filtered atlases:', error);
      throw new Error(`Failed to get filtered atlases: ${error}`);
    }
  }

  /**
   * Get a specific atlas entry by ID
   */
  static async getAtlasEntry(atlasId: string, signal?: AbortSignal): Promise<AtlasCatalogEntry | null> {
    try {
      const result = await invoke('plugin:api-bridge|get_atlas_entry', { atlasId });
      
      // Check if the operation was aborted
      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }
      
      return result;
    } catch (error) {
      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }
      console.error('Failed to get atlas entry:', error);
      throw new Error(`Failed to get atlas entry: ${error}`);
    }
  }

  /**
   * Toggle favorite status for an atlas
   */
  static async toggleFavorite(atlasId: string, signal?: AbortSignal): Promise<boolean> {
    try {
      const result = await invoke('plugin:api-bridge|toggle_atlas_favorite', { atlasId });
      
      // Check if the operation was aborted
      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }
      
      return result;
    } catch (error) {
      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }
      console.error('Failed to toggle atlas favorite:', error);
      throw new Error(`Failed to toggle atlas favorite: ${error}`);
    }
  }

  /**
   * Get recently used atlases
   */
  static async getRecentAtlases(signal?: AbortSignal): Promise<AtlasCatalogEntry[]> {
    try {
      const result = await invoke('plugin:api-bridge|get_recent_atlases');
      
      // Check if the operation was aborted
      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }
      
      return result;
    } catch (error) {
      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }
      console.error('Failed to get recent atlases:', error);
      throw new Error(`Failed to get recent atlases: ${error}`);
    }
  }

  /**
   * Get favorite atlases
   */
  static async getFavoriteAtlases(signal?: AbortSignal): Promise<AtlasCatalogEntry[]> {
    try {
      const result = await invoke('plugin:api-bridge|get_favorite_atlases');
      
      // Check if the operation was aborted
      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }
      
      return result;
    } catch (error) {
      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }
      console.error('Failed to get favorite atlases:', error);
      throw new Error(`Failed to get favorite atlases: ${error}`);
    }
  }

  /**
   * Validate an atlas configuration
   */
  static async validateConfig(config: AtlasConfig, signal?: AbortSignal): Promise<boolean> {
    try {
      const result = await invoke('plugin:api-bridge|validate_atlas_config', { config });
      
      // Check if the operation was aborted
      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }
      
      return result;
    } catch (error) {
      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }
      console.error('Failed to validate atlas config:', error);
      throw new Error(`Failed to validate atlas config: ${error}`);
    }
  }

  static async getAtlasPalette(
    config: AtlasConfig,
    options?: { kind?: AtlasPaletteKind; seed?: number },
    signal?: AbortSignal
  ): Promise<AtlasPaletteResponse> {
    const normalizedConfig = AtlasService.normalizePaletteConfig(config);
    try {
      const result = await invoke<AtlasPaletteResponse>('plugin:api-bridge|get_atlas_palette', {
        config: normalizedConfig,
        kind: options?.kind,
        seed: options?.seed,
      });

      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }

      return result;
    } catch (error) {
      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }
      console.error('Failed to get atlas palette:', error);
      throw new Error(`Failed to get atlas palette: ${formatTauriError(error)}`);
    }
  }

  static async importParcelDataJson(
    parcelDataJson: string,
    sourceName?: string,
    signal?: AbortSignal
  ): Promise<ParcellationReference> {
    try {
      const result = await invoke<ParcellationReference>('plugin:api-bridge|import_parcel_data_json', {
        parcel_data_json: parcelDataJson,
        source_name: sourceName,
      });

      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }

      return result;
    } catch (error) {
      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }
      throw new Error(`Failed to import parcel data: ${formatTauriError(error)}`);
    }
  }

  static async listParcellationReferences(signal?: AbortSignal): Promise<ParcellationReference[]> {
    try {
      const result = await invoke<ParcellationReference[]>('plugin:api-bridge|list_parcellation_references');

      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }

      return result;
    } catch (error) {
      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }
      throw new Error(`Failed to list parcellation references: ${formatTauriError(error)}`);
    }
  }

  static async previewParcelBindingCoverage(
    referenceId: string,
    signal?: AbortSignal
  ): Promise<ParcelBindingCoveragePreview> {
    try {
      const result = await invoke<ParcelBindingCoveragePreview>(
        'plugin:api-bridge|preview_parcel_binding_coverage',
        { reference_id: referenceId }
      );

      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }

      return result;
    } catch (error) {
      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }
      throw new Error(`Failed to preview parcel binding coverage: ${formatTauriError(error)}`);
    }
  }

  static async importSurfaceLabelParcellation(
    args: {
      dataHandle: string;
      sourceName?: string;
      atlasIdHint?: string;
      atlasNameHint?: string;
      atlasSpaceHint?: string;
      hemisphereHint?: string;
    },
    signal?: AbortSignal
  ): Promise<SurfaceLabelParcellationImportResult> {
    try {
      const result = await invoke<SurfaceLabelParcellationImportResult>(
        'plugin:api-bridge|import_surface_label_parcellation',
        {
          data_handle: args.dataHandle,
          source_name: args.sourceName,
          atlas_id_hint: args.atlasIdHint,
          atlas_name_hint: args.atlasNameHint,
          atlas_space_hint: args.atlasSpaceHint,
          hemisphere_hint: args.hemisphereHint,
        }
      );

      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }

      return result;
    } catch (error) {
      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }
      throw new Error(`Failed to import surface label parcellation: ${formatTauriError(error)}`);
    }
  }

  static async getParcellationReferencePalette(
    referenceId: string,
    options?: { kind?: AtlasPaletteKind; seed?: number },
    signal?: AbortSignal
  ): Promise<AtlasPaletteResponse> {
    try {
      const result = await invoke<AtlasPaletteResponse>(
        'plugin:api-bridge|get_parcellation_reference_palette',
        {
          reference_id: referenceId,
          kind: options?.kind,
          seed: options?.seed,
        }
      );

      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }

      return result;
    } catch (error) {
      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }
      throw new Error(`Failed to get parcellation reference palette: ${formatTauriError(error)}`);
    }
  }

  /**
   * Load an atlas with the given configuration
   */
  static async loadAtlas(config: AtlasConfig, signal?: AbortSignal): Promise<AtlasLoadResult> {
    try {
      const result = await invoke('plugin:api-bridge|load_atlas', { config });
      
      // Check if the operation was aborted
      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }
      
      return result;
    } catch (error) {
      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }

      // Enhanced error logging and reporting
      console.error('Atlas loading failed:', {
        atlasId: config.atlas_id,
        space: config.space,
        resolution: config.resolution,
        networks: config.networks,
        parcels: config.parcels,
        error
      });
      
      // Provide more helpful error messages based on error type
      let errorMessage = 'Failed to load atlas';
      const err =
        typeof error === 'object' && error !== null
          ? (error as Record<string, unknown>)
          : null;
      const nestedError = err?.['error'];
      const nestedCode =
        typeof nestedError === 'object' && nestedError !== null
          ? (nestedError as Record<string, unknown>)['code']
          : undefined;
      const code: number | undefined =
        typeof err?.['code'] === 'number'
          ? (err['code'] as number)
          : typeof nestedCode === 'number'
          ? (nestedCode as number)
          : undefined;
      const details: string =
        (typeof err?.['details'] === 'string' && (err['details'] as string)) ||
        (typeof err?.['message'] === 'string' && (err['message'] as string)) ||
        (typeof err?.['error'] === 'string' && (err['error'] as string)) ||
        (() => {
          try {
            return JSON.stringify(err);
          } catch {
            return String(err);
          }
        })();

      if (typeof code === 'number' && code >= 6008 && code <= 6013) {
        // Internal atlas/bridge errors from backend
        if (details.includes('404') || details.includes('Not Found')) {
          errorMessage = `Atlas data unavailable: The required atlas files could not be downloaded. This may be due to server issues or changed URLs in the atlas data repository. Details: ${details}`;
        } else if (details.includes('HTTP error downloading')) {
          errorMessage = `Network error: Unable to download atlas data. Please check your internet connection and try again. Details: ${details}`;
        } else if (details.includes('NIfTI file not found')) {
          errorMessage = `Atlas volume not found in local cache. Try reloading the atlas or clearing atlas cache. Details: ${details}`;
        } else if (details.includes('Failed to load atlas data')) {
          errorMessage = `Atlas loading error: The atlas library failed to process the atlas data. This may be due to corrupted data or server issues. Details: ${details}`;
        } else {
          errorMessage = `Internal atlas error (code ${code}): ${details}`;
        }
      } else if (typeof err === 'object' && err !== null) {
        const asString = err.toString();
        if (asString.includes('UnsupportedSpace')) {
          errorMessage = `Unsupported coordinate space: The requested space '${config.space}' is not available for atlas '${config.atlas_id}'`;
        } else if (asString.includes('UnsupportedResolution')) {
          errorMessage = `Unsupported resolution: The requested resolution '${config.resolution}' is not available for atlas '${config.atlas_id}'`;
        } else if (asString.includes('ValidationFailed')) {
          errorMessage = `Configuration validation failed: Please check your atlas configuration parameters`;
        } else {
          errorMessage = `Atlas loading failed: ${details}`;
        }
      } else {
        errorMessage = `Atlas loading failed: ${String(error)}`;
      }
      
      throw new Error(errorMessage);
    }
  }

  /**
   * Load a surface atlas (per-vertex labels on fsaverage mesh)
   */
  static async loadSurfaceAtlas(
    config: AtlasConfig,
    signal?: AbortSignal
  ): Promise<SurfaceAtlasLoadResult> {
    const normalizedConfig = AtlasService.normalizePaletteConfig(config);
    try {
      const result = await invoke<SurfaceAtlasLoadResult>(
        'plugin:api-bridge|load_surface_atlas',
        { config: normalizedConfig }
      );

      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }

      return result;
    } catch (error) {
      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }
      console.error('Failed to load surface atlas:', {
        atlasId: normalizedConfig.atlas_id,
        space: normalizedConfig.space,
        resolution: normalizedConfig.resolution,
        surfType: normalizedConfig.surf_type,
        networks: normalizedConfig.networks,
        parcels: normalizedConfig.parcels,
        error,
      });
      throw new Error(`Failed to load surface atlas: ${formatTauriError(error)}`);
    }
  }

  /**
   * Convenience helper: load an atlas via the backend and immediately
   * create a corresponding volume layer via VolumeLoadingService.
   *
   * This centralises the "AtlasLoadResult → VolumeHandle → Layer" logic
   * so callers don't duplicate it (and accidentally create duplicate layers).
   */
  static async loadAtlasAndCreateLayer(
    config: AtlasConfig,
    signal?: AbortSignal
  ): Promise<{ result: AtlasLoadResult; layer: Layer | null }> {
    const keyParts = [
      config.atlas_id,
      config.space,
      config.resolution,
      config.parcels ?? 'none',
      config.networks ?? 'none',
    ];
    const key = keyParts.join('|');

    const existing = AtlasService.inFlightRequests.get(key);
    if (existing) {
      console.log('[AtlasService] Reusing in-flight atlas request for key:', key);
      return existing;
    }

    const promise = (async () => {
      const result = await AtlasService.loadAtlas(config, signal);

      if (!result.success || !result.volume_handle_info || !result.atlas_metadata) {
        return { result, layer: null };
      }

      const volumeInfo = result.volume_handle_info;
      const volumeHandle: {
        id: string;
        name: string;
        dims: [number, number, number];
        dtype: string;
        volume_type: string;
        current_timepoint: number;
        num_timepoints?: number;
        time_series_info?: unknown;
        path: string;
      } = {
        id: volumeInfo.id,
        name: volumeInfo.name,
        dims: volumeInfo.dims as [number, number, number],
        dtype: volumeInfo.dtype,
        volume_type: volumeInfo.volume_type,
        current_timepoint: volumeInfo.current_timepoint ?? 0,
        num_timepoints: volumeInfo.num_timepoints,
        time_series_info: volumeInfo.time_series_info,
        path: `atlas:${result.atlas_metadata.id}`,
      };

      const volumeLoadingService = getVolumeLoadingService();
      const layer = await volumeLoadingService.loadVolume({
        volumeHandle,
        displayName: result.atlas_metadata.name,
        source: 'atlas',
        sourcePath: `atlas:${result.atlas_metadata.id}`,
        layerType: 'label',
        visible: true,
        atlasMetadata: result.atlas_metadata,
      });

      // Prefer categorical atlas palettes for label atlases (volumes) by default.
      // This keeps volume and surface atlas behaviors consistent.
      try {
        await AtlasPaletteService.applyToVolumeLayer(layer.id, config);
      } catch (error) {
        console.warn('[AtlasService] Failed to apply atlas categorical palette (non-fatal):', error);
      }

      return { result, layer };
    })();

    AtlasService.inFlightRequests.set(key, promise);

    try {
      return await promise;
    } finally {
      AtlasService.inFlightRequests.delete(key);
    }
  }

  /**
   * Start monitoring atlas loading progress
   * Returns a cleanup function to stop monitoring
   */
  static async startProgressMonitoring(callback: ProgressCallback): Promise<Unlisten> {
    try {
      // Start the backend progress monitoring
      await invoke('plugin:api-bridge|start_atlas_progress_monitoring');
      
      // Listen for progress events
      const unlisten = await safeListen<AtlasLoadProgress>('atlas-progress', (event) => {
        callback(event.payload);
      });
      
      // Return cleanup function
      return () => safeUnlisten(unlisten);
    } catch (error) {
      console.error('Failed to start atlas progress monitoring:', error);
      throw new Error(`Failed to start progress monitoring: ${error}`);
    }
  }

  /**
   * Create a subscription to atlas loading progress events
   * Note: Deprecated - use startProgressMonitoring instead
   */
  static onLoadProgress(callback: ProgressCallback): () => void {
    void callback;
    console.warn('AtlasService.onLoadProgress is deprecated. Use startProgressMonitoring instead.');
    // Return a no-op for backward compatibility
    return () => {};
  }

  /**
   * Get the current number of active progress subscriptions for debugging
   */
  static async getSubscriptionCount(): Promise<number> {
    try {
      return await invoke('plugin:api-bridge|get_atlas_subscription_count');
    } catch (error) {
      console.error('Failed to get subscription count:', error);
      throw new Error(`Failed to get subscription count: ${error}`);
    }
  }
}
