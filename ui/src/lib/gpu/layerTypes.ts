/**
 * Layer types for GPU rendering
 * These are simplified types that match what the GPU renderer expects
 */

import type { LayerSpec } from '@brainflow/api';

/**
 * Simplified volume layer for rendering
 */
export interface VolumeLayer {
    volume_id: string;
    opacity: number;
    colormap_id: number;
    window_level: number;
    window_width: number;
}

/**
 * Convert API LayerSpec to simplified VolumeLayer
 */
export function layerSpecToVolumeLayer(spec: LayerSpec): VolumeLayer | null {
    if ('Volume' in spec && spec.Volume) {
        const volumeSpec = spec.Volume;
        return {
            volume_id: volumeSpec.source_resource_id,
            opacity: volumeSpec.opacity ?? 1.0,
            colormap_id: volumeSpec.colormap_id ?? 0,
            window_level: volumeSpec.intensity_range ? 
                (volumeSpec.intensity_range[0] + volumeSpec.intensity_range[1]) / 2 : 500,
            window_width: volumeSpec.intensity_range ? 
                (volumeSpec.intensity_range[1] - volumeSpec.intensity_range[0]) : 1000
        };
    }
    return null;
}

/**
 * Convert VolumeLayer to API LayerSpec
 */
export function volumeLayerToLayerSpec(layer: VolumeLayer, layerId: string): LayerSpec {
    const intensityMin = layer.window_level - layer.window_width / 2;
    const intensityMax = layer.window_level + layer.window_width / 2;
    
    return {
        Volume: {
            id: layerId,
            source_resource_id: layer.volume_id,
            colormap: 'viridis', // Default colormap
            slice_axis: null,
            slice_index: null,
            intensity_range: [intensityMin, intensityMax],
            opacity: layer.opacity,
            colormap_id: layer.colormap_id,
            threshold_range: null,
            visible: true
        }
    };
}