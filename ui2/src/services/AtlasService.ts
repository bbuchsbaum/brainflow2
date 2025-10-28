/**
 * Atlas Service - TypeScript wrapper for atlas Tauri commands
 */

import { invoke } from '@tauri-apps/api/core';
import { safeListen, safeUnlisten, type Unlisten } from '@/utils/eventUtils';
import type {
  AtlasCatalogEntry,
  AtlasConfig,
  AtlasFilter,
  AtlasLoadResult,
  AtlasLoadProgress,
} from '../types/atlas';

export type ProgressCallback = (progress: AtlasLoadProgress) => void;

export class AtlasService {
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
      
      if (error && typeof error === 'object') {
        if ('code' in error && error.code === 6008) {
          // This is the Internal error we're seeing
          const details = 'details' in error ? String(error.details) : 'Unknown internal error';
          
          if (details.includes('404') || details.includes('Not Found')) {
            errorMessage = `Atlas data unavailable: The required atlas files could not be downloaded. This may be due to server issues or changed URLs in the atlas data repository. Details: ${details}`;
          } else if (details.includes('HTTP error downloading')) {
            errorMessage = `Network error: Unable to download atlas data. Please check your internet connection and try again. Details: ${details}`;
          } else if (details.includes('Failed to load atlas data')) {
            errorMessage = `Atlas loading error: The atlas library failed to process the atlas data. This may be due to corrupted data or server issues. Details: ${details}`;
          } else {
            errorMessage = `Internal atlas error: ${details}`;
          }
        } else if (error.toString().includes('UnsupportedSpace')) {
          errorMessage = `Unsupported coordinate space: The requested space '${config.space}' is not available for atlas '${config.atlas_id}'`;
        } else if (error.toString().includes('UnsupportedResolution')) {
          errorMessage = `Unsupported resolution: The requested resolution '${config.resolution}' is not available for atlas '${config.atlas_id}'`;
        } else if (error.toString().includes('ValidationFailed')) {
          errorMessage = `Configuration validation failed: Please check your atlas configuration parameters`;
        } else {
          errorMessage = `Atlas loading failed: ${error.toString()}`;
        }
      } else {
        errorMessage = `Atlas loading failed: ${String(error)}`;
      }
      
      throw new Error(errorMessage);
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
