/**
 * Service for managing slice navigation in orthogonal views
 * Handles world-coordinate based slice positioning across layers
 */

import type { EventBus } from '../events/EventBus';
import { ViewType } from '../types/ViewType';
import type { VolumeLayerGpuInfo, LayerSpec } from '../api';
import { coreApi } from '../api';

export interface SliceNavigationServiceConfig {
	eventBus: EventBus;
}

export class SliceNavigationService {
	constructor(private config: SliceNavigationServiceConfig) {}

	/**
	 * Update slice position in world coordinates
	 * This maintains synchronization across layers with different resolutions
	 */
	async updateSlicePosition(
		layerId: string,
		worldPosition: number,
		viewType: ViewType,
		layerInfo: {
			source_resource_id: string;
			colormap?: string;
			gpu: VolumeLayerGpuInfo;
		}
	): Promise<void> {
		// Calculate the slice index for this world position
		const sliceIndex = this.calculateSliceIndexForLayer(
			worldPosition,
			viewType,
			layerInfo.gpu.world_to_voxel,
			layerInfo.gpu.dim
		);

		// Emit event for other components that need to know about slice changes
		this.config.eventBus.emit('slice.position.changed', {
			layerId,
			worldPosition,
			viewType,
			sliceIndex
		});

		// Reload the layer with the new slice
		await this.reloadLayerWithNewSlice(layerId, sliceIndex, viewType, layerInfo);
	}

	/**
	 * Reload layer GPU resources with a new slice index
	 */
	async reloadLayerWithNewSlice(
		layerId: string,
		sliceIndex: number,
		viewType: ViewType,
		layerInfo: {
			source_resource_id: string;
			colormap?: string;
		}
	): Promise<void> {
		console.log(`[SliceNavigationService] Reloading layer ${layerId} with slice ${sliceIndex}`);

		// Clear current render state
		await coreApi.clear_render_layers();

		// Release current GPU resources
		await coreApi.release_layer_gpu_resources(layerId);

		// Request new GPU resources with updated slice
		const layerSpec: LayerSpec = {
			Volume: {
				id: layerId,
				source_resource_id: layerInfo.source_resource_id,
				colormap: layerInfo.colormap || 'grayscale',
				slice_axis: viewType === 0 ? 'Axial' : viewType === 1 ? 'Coronal' : 'Sagittal',
				slice_index: { Fixed: sliceIndex }
			}
		};

		const newGpuResources = await coreApi.request_layer_gpu_resources(layerSpec);

		// Emit event to update layer GPU resources
		this.config.eventBus.emit('layer.gpu.updated', {
			layerId,
			gpu: newGpuResources
		});
	}

	/**
	 * Calculate the appropriate slice index for a layer at a world position
	 * This handles the conversion from continuous world space to discrete indices
	 */
	calculateSliceIndexForLayer(
		worldPos: number,
		viewType: ViewType,
		worldToVoxelMatrix: number[],
		volumeDimensions: [number, number, number]
	): number {
		// Create world coordinate based on view type
		let worldCoord: [number, number, number, number];
		switch (viewType) {
			case ViewType.Axial:
				worldCoord = [0, 0, worldPos, 1]; // Z slice
				break;
			case ViewType.Coronal:
				worldCoord = [0, worldPos, 0, 1]; // Y slice
				break;
			case ViewType.Sagittal:
				worldCoord = [worldPos, 0, 0, 1]; // X slice
				break;
		}

		// Transform to voxel space using the world_to_voxel matrix
		const m = worldToVoxelMatrix;
		const voxelX = m[0] * worldCoord[0] + m[4] * worldCoord[1] + m[8] * worldCoord[2] + m[12] * worldCoord[3];
		const voxelY = m[1] * worldCoord[0] + m[5] * worldCoord[1] + m[9] * worldCoord[2] + m[13] * worldCoord[3];
		const voxelZ = m[2] * worldCoord[0] + m[6] * worldCoord[1] + m[10] * worldCoord[2] + m[14] * worldCoord[3];
		const voxelW = m[3] * worldCoord[0] + m[7] * worldCoord[1] + m[11] * worldCoord[2] + m[15] * worldCoord[3];

		// Get the appropriate voxel index based on view type
		let voxelIndex: number;
		if (voxelW !== 0) {
			switch (viewType) {
				case ViewType.Axial:
					voxelIndex = voxelZ / voxelW;
					break;
				case ViewType.Coronal:
					voxelIndex = voxelY / voxelW;
					break;
				case ViewType.Sagittal:
					voxelIndex = voxelX / voxelW;
					break;
			}
		} else {
			switch (viewType) {
				case ViewType.Axial:
					voxelIndex = voxelZ;
					break;
				case ViewType.Coronal:
					voxelIndex = voxelY;
					break;
				case ViewType.Sagittal:
					voxelIndex = voxelX;
					break;
			}
		}

		// Clamp to valid range
		const maxIndex = volumeDimensions[viewType] - 1;
		return Math.max(0, Math.min(maxIndex, Math.round(voxelIndex)));
	}

	/**
	 * Future: Load a chunk of slices around the target position
	 * This will enable smooth interpolation without constant reloading
	 */
	async loadSliceChunk(
		layerId: string,
		centerSlice: number,
		radius: number,
		viewType: ViewType
	): Promise<void> {
		// TODO: Implement in Phase 2
		// This will load slices [centerSlice - radius, centerSlice + radius]
		// and enable continuous sampling in the shader
	}
}

export function createSliceNavigationService(
	config: SliceNavigationServiceConfig
): SliceNavigationService {
	return new SliceNavigationService(config);
}