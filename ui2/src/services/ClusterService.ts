import { invoke } from '@tauri-apps/api/core';
import type {
  AlphaMaskHandle,
  ClusterMaskParams,
  ComputeAlphaMaskResult,
} from '@/types/alphaMask';

class ClusterService {
  private static instance: ClusterService | null = null;

  static getInstance(): ClusterService {
    if (!ClusterService.instance) {
      ClusterService.instance = new ClusterService();
    }
    return ClusterService.instance;
  }

  async computeAlphaMask(
    layerId: string,
    params: ClusterMaskParams,
    kind: 'Cluster' | 'UserDefined' | { Other: string } = 'Cluster',
  ): Promise<ComputeAlphaMaskResult> {
    return invoke<ComputeAlphaMaskResult>('plugin:api-bridge|compute_alpha_mask', {
      layer_id: layerId,
      params,
      kind,
    });
  }

  async clearAlphaMask(layerId: string): Promise<void> {
    return invoke<void>('plugin:api-bridge|clear_alpha_mask', { layer_id: layerId });
  }
}

export const getClusterService = () => ClusterService.getInstance();
