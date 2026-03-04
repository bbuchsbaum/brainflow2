import type { BackendTransport } from '@/services/transport';
import { getTransport } from '@/services/transport';
import { isValidRustViewState } from '@/types/rustViewState';
import type { RustViewState } from '@/types/rustViewState';

export class BatchRenderService {
  private transport: BackendTransport;

  constructor(transport: BackendTransport = getTransport()) {
    this.transport = transport;
  }

  /**
   * Convert colormap name to ID
   */
  getColormapId(colormap: string): number {
    const colormapIds: Record<string, number> = {
      'gray': 0,
      'hot': 1,
      'cool': 2,
      'red-yellow': 3,
      'blue-lightblue': 4,
      'red': 5,
      'green': 6,
      'blue': 7,
      'yellow': 8,
      'cyan': 9,
      'magenta': 10,
      'warm': 11,
      'cool-warm': 12,
      'spectral': 13,
      'turbo': 14
    };
    return colormapIds[colormap] || 0;
  }

  /**
   * Batch render multiple slices for MosaicView
   */
  async batchRenderSlices(
    viewStates: any[],
    widthPerSlice: number,
    heightPerSlice: number
  ): Promise<ArrayBuffer> {
    console.log(`[BatchRenderService] batchRenderSlices called with ${viewStates.length} FrontendViewStates`);
    console.log('[BatchRenderService] First ViewState:', JSON.stringify(viewStates[0], null, 2));

    const transformedViewStates = viewStates.map((fvs, idx) => {
      if (!fvs.views || !fvs.crosshair || !fvs.layers) {
        throw new Error(`ViewState ${idx}: Missing required fields (views, crosshair, or layers)`);
      }

      const viewType = Object.keys(fvs.views)[0];
      const view = fvs.views[viewType];

      if (!view || !view.origin_mm || !view.u_mm || !view.v_mm) {
        throw new Error(`ViewState ${idx}: Invalid view structure for ${viewType}`);
      }

      const requestedView = fvs.requestedView;
      if (!requestedView) {
        throw new Error(`ViewState ${idx}: Missing requestedView`);
      }

      const colormapNameToId = (name: string): number => {
        const colormapMap: Record<string, number> = {
          'gray': 0,
          'hot': 1,
          'cool': 2,
          'jet': 3,
          'viridis': 4,
          'plasma': 5,
          'inferno': 6,
          'magma': 7,
          'turbo': 8,
          'rainbow': 9,
        };
        return colormapMap[name] || 0;
      };

      const transformedLayers = fvs.layers.map((layer: any, layerIdx: number) => {
        if (!layer.volumeId || !layer.intensity || layer.intensity.length !== 2) {
          throw new Error(`ViewState ${idx}, Layer ${layerIdx}: Invalid layer structure`);
        }

        const intensityMin = Number(layer.intensity[0]);
        const intensityMax = Number(layer.intensity[1]);

        if (isNaN(intensityMin) || isNaN(intensityMax)) {
          throw new Error(`ViewState ${idx}, Layer ${layerIdx}: Invalid intensity values`);
        }

        return {
          volume_id: layer.volumeId,
          opacity: layer.opacity || 1.0,
          colormap_id: colormapNameToId(layer.colormap || 'gray'),
          blend_mode: layer.blendMode === 'alpha' ? 'Normal' : 'Normal',
          intensity_window: [intensityMin, intensityMax],
          threshold: null,
          visible: layer.visible !== false
        };
      });

      const renderLoopViewState = {
        layout_version: 1,
        camera: {
          world_center: fvs.crosshair.world_mm,
          fov_mm: Math.max(
            Math.abs(requestedView.u_mm[0]) + Math.abs(requestedView.u_mm[1]) + Math.abs(requestedView.u_mm[2]),
            Math.abs(requestedView.v_mm[0]) + Math.abs(requestedView.v_mm[1]) + Math.abs(requestedView.v_mm[2])
          ),
          orientation: requestedView.type.charAt(0).toUpperCase() + requestedView.type.slice(1),
          frame_origin: requestedView.origin_mm.length === 3
            ? [...requestedView.origin_mm, 1.0]
            : requestedView.origin_mm,
          frame_u_vec: requestedView.u_mm,
          frame_v_vec: requestedView.v_mm
        },
        crosshair_world: fvs.crosshair.world_mm,
        layers: transformedLayers,
        viewport_size: [requestedView.width, requestedView.height],
        show_crosshair: false
      };

      console.log(`[BatchRenderService] Transformed ViewState ${idx}:`, JSON.stringify(renderLoopViewState, null, 2));

      if (!isValidRustViewState(renderLoopViewState)) {
        console.error('[BatchRenderService] Invalid ViewState structure:', renderLoopViewState);
        throw new Error(`ViewState ${idx} does not match Rust structure`);
      }

      return renderLoopViewState as RustViewState;
    });

    const viewStatesJson = JSON.stringify(transformedViewStates, (key, value) => {
      if (key === 'intensity_window' && Array.isArray(value) && value.length === 2) {
        return value;
      }
      return value;
    });

    console.log('[BatchRenderService] Batch render request with', transformedViewStates.length, 'slices');
    console.log('[BatchRenderService] Transformed ViewStates JSON preview:', viewStatesJson.substring(0, 500) + '...');

    try {
      const testParse = JSON.parse(viewStatesJson);
      console.log('[BatchRenderService] JSON validation passed. Structure:', {
        arrayLength: testParse.length,
        firstItem: testParse[0] ? {
          hasLayoutVersion: 'layout_version' in testParse[0],
          hasCamera: 'camera' in testParse[0],
          hasLayers: 'layers' in testParse[0],
          layersCount: testParse[0].layers?.length,
          firstLayer: testParse[0].layers?.[0] ? {
            hasThreshold: 'threshold' in testParse[0].layers[0],
            thresholdValue: testParse[0].layers[0].threshold,
            thresholdType: typeof testParse[0].layers[0].threshold
          } : null
        } : null
      });

      if (transformedViewStates.length <= 3) {
        console.log('[BatchRenderService] Full ViewStates JSON:', JSON.stringify(testParse, null, 2));
      }
    } catch (e) {
      console.error('[BatchRenderService] Invalid JSON generated:', e);
      console.error('[BatchRenderService] JSON string that failed:', viewStatesJson);
      throw new Error(`Failed to generate valid JSON: ${(e as Error).message}`);
    }

    const response = await this.transport.invoke<ArrayBuffer>('batch_render_slices', {
      batchRequest: {
        view_states_json: viewStatesJson,
        width_per_slice: widthPerSlice,
        height_per_slice: heightPerSlice
      }
    });

    return response;
  }
}

let instance: BatchRenderService | null = null;

export function getBatchRenderService(): BatchRenderService {
  if (!instance) {
    instance = new BatchRenderService();
  }
  return instance;
}
