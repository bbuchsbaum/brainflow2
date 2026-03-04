/**
 * Hook for Volume-to-Surface Projection
 *
 * Provides easy access to the projection service with state management
 * for loading states and error handling.
 */

import { useState, useCallback } from 'react';
import { useLayers } from '@/stores/layerStore';
import { useSurfaceStore } from '@/stores/surfaceStore';
import {
  getVolumeSurfaceProjectionService,
  type VolToSurfProjectionParams,
  type VolToSurfProjectionResult,
  type SamplerInfo,
} from '@/services/VolumeSurfaceProjectionService';

export interface UseVolToSurfProjectionReturn {
  /** Whether both a volume and surface are loaded and projection is possible */
  canProject: boolean;
  /** Available volume IDs */
  volumeIds: string[];
  /** Available surface IDs */
  surfaceIds: string[];
  /** Whether GPU projection is currently enabled */
  useGPUProjection: boolean;
  /** Project a volume onto a surface */
  projectVolume: (
    volumeId: string,
    surfaceId: string,
    name: string,
    options?: {
      pialSurfaceId?: string;
      params?: Partial<VolToSurfProjectionParams>;
      timepoint?: number;
      colormap?: string;
      opacity?: number;
      /** Override the global GPU projection setting for this call */
      useGPUProjection?: boolean;
    }
  ) => Promise<VolToSurfProjectionResult | null>;
  /** Create a sampler for efficient 4D projection */
  createSampler: (
    surfaceId: string,
    volumeId: string,
    options?: {
      pialSurfaceId?: string;
      params?: Partial<VolToSurfProjectionParams>;
    }
  ) => Promise<SamplerInfo | null>;
  /** Apply an existing sampler to a volume */
  applySampler: (
    samplerHandle: string,
    volumeId: string,
    timepoint?: number
  ) => Promise<VolToSurfProjectionResult | null>;
  /** Whether a projection operation is in progress */
  isProjecting: boolean;
  /** Last error from a projection operation */
  error: Error | null;
  /** Clear the error state */
  clearError: () => void;
}

/**
 * Hook for volume-to-surface projection operations
 *
 * @example
 * ```tsx
 * const { canProject, volumeIds, surfaceIds, projectVolume, isProjecting } = useVolToSurfProjection();
 *
 * const handleProject = async () => {
 *   if (canProject && volumeIds[0] && surfaceIds[0]) {
 *     await projectVolume(volumeIds[0], surfaceIds[0], 'My Projection', {
 *       colormap: 'viridis',
 *       params: { knn: 8, sigma: 4.0 }
 *     });
 *   }
 * };
 * ```
 */
export function useVolToSurfProjection(): UseVolToSurfProjectionReturn {
  const [isProjecting, setIsProjecting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Get loaded volumes from layer store
  const layers = useLayers();
  const volumeIds = layers.filter((l) => l.type === 'volume').map((l) => l.volumeId || l.id);

  // Get loaded surfaces from surface store
  const surfaces = useSurfaceStore((state) => state.surfaces);
  const surfaceIds = Object.keys(surfaces);

  // Get GPU projection setting from surface store
  const useGPUProjection = useSurfaceStore((state) => state.renderSettings.useGPUProjection);

  // Can project if we have at least one volume and one surface
  const canProject = volumeIds.length > 0 && surfaceIds.length > 0;

  const service = getVolumeSurfaceProjectionService();

  const projectVolume = useCallback(
    async (
      volumeId: string,
      surfaceId: string,
      name: string,
      options?: {
        pialSurfaceId?: string;
        params?: Partial<VolToSurfProjectionParams>;
        timepoint?: number;
        colormap?: string;
        opacity?: number;
        useGPUProjection?: boolean;
      }
    ): Promise<VolToSurfProjectionResult | null> => {
      setError(null);
      setIsProjecting(true);

      try {
        // Determine whether to use GPU projection:
        // 1. If explicitly specified in options, use that
        // 2. Otherwise, use the global setting from surface store
        const shouldUseGPU = options?.useGPUProjection ?? useGPUProjection;

        // Use projectAndDisplay to also add to surface store
        const layer = await service.projectAndDisplay(volumeId, surfaceId, name, {
          ...options,
          useGPUProjection: shouldUseGPU,
        });

        // Return the projection result info
        return {
          data_handle: { id: layer.dataHandle },
          surface_handle: { id: layer.surfaceId },
          volume_id: volumeId,
          valid_vertex_count: 0, // Not available from layer
          total_vertex_count: 0,
          coverage_percent: 100,
          data_range: { min: layer.range[0], max: layer.range[1] },
          params: service['DEFAULT_PROJECTION_PARAMS'],
          timepoint: options?.timepoint,
        } as VolToSurfProjectionResult;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        console.error('[useVolToSurfProjection] Projection failed:', error);
        return null;
      } finally {
        setIsProjecting(false);
      }
    },
    [service, useGPUProjection]
  );

  const createSampler = useCallback(
    async (
      surfaceId: string,
      volumeId: string,
      options?: {
        pialSurfaceId?: string;
        params?: Partial<VolToSurfProjectionParams>;
      }
    ): Promise<SamplerInfo | null> => {
      setError(null);
      setIsProjecting(true);

      try {
        return await service.createSampler(
          surfaceId,
          volumeId,
          options?.pialSurfaceId,
          options?.params
        );
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        console.error('[useVolToSurfProjection] Sampler creation failed:', error);
        return null;
      } finally {
        setIsProjecting(false);
      }
    },
    [service]
  );

  const applySampler = useCallback(
    async (
      samplerHandle: string,
      volumeId: string,
      timepoint?: number
    ): Promise<VolToSurfProjectionResult | null> => {
      setError(null);
      setIsProjecting(true);

      try {
        return await service.applySampler(samplerHandle, volumeId, timepoint);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        console.error('[useVolToSurfProjection] Sampler application failed:', error);
        return null;
      } finally {
        setIsProjecting(false);
      }
    },
    [service]
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    canProject,
    volumeIds,
    surfaceIds,
    useGPUProjection,
    projectVolume,
    createSampler,
    applySampler,
    isProjecting,
    error,
    clearError,
  };
}
