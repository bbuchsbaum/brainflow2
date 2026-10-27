import { describe, expect, it } from 'vitest';
import { BaseLayer, MultiLayerNeuroSurface, SurfaceGeometry, THREE, VolumeProjectionLayer } from 'neurosurface';
import {
  applyLayerUpdate,
  applySurfaceRenderSettings,
  buildLayerInstance,
} from '../../../../../../packages/visualization/src/surface/surfaceRuntime';
import {
  DEFAULT_NEURO_SURFACE_DISPLAY_SETTINGS,
  DEFAULT_NEURO_SURFACE_MATERIAL_SETTINGS,
  type RenderableLayerSpec,
} from '../../../../../../packages/visualization/src/surface/types';

const geometry = () => new SurfaceGeometry(
  new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  new Uint32Array([0, 1, 2]),
  'left',
);

describe('SurfView 3 runtime integration', () => {
  it('changes the base layer without tinting opaque quantitative colors', () => {
    const surface = new MultiLayerNeuroSurface(geometry(), { baseColor: 0xffffff });
    surface.addLayer(buildLayerInstance({
      id: 'values', kind: 'data', values: new Float32Array([0.2, 0.5, 0.8]),
      colormap: 'viridis', range: [0, 1], threshold: [0, 0], opacity: 1,
    }));
    try {
      const before = Array.from(surface.compositeBuffer);
      applySurfaceRenderSettings(surface, DEFAULT_NEURO_SURFACE_DISPLAY_SETTINGS, {
        ...DEFAULT_NEURO_SURFACE_MATERIAL_SETTINGS, surfaceColor: '#ff0000',
      });
      expect((surface.getLayer('base') as BaseLayer).getColor()).toBe(0xff0000);
      expect(Array.from(surface.compositeBuffer)).toEqual(before);
      expect((surface.mesh!.material as THREE.MeshPhongMaterial).color.getHex()).toBe(0xffffff);
    } finally {
      surface.dispose();
    }
  });

  it('samples a known linear volume ramp between voxel centers, including after update', () => {
    const data = new Float32Array([0, 1, 0, 1, 0, 1, 0, 1]);
    const spec: RenderableLayerSpec = {
      id: 'volume', kind: 'volume', volumeData: data.buffer,
      volumeDims: [2, 2, 2], range: [0, 2], threshold: [0, 0],
      colormap: 'gray', opacity: 1,
    };
    const surface = new MultiLayerNeuroSurface(geometry());
    const layer = buildLayerInstance(spec) as VolumeProjectionLayer;
    surface.addLayer(layer);
    try {
      // Nearest sampling would give 0 here; the continuous ramp gives x = 0.25.
      const point = new THREE.Vector3(0.25, 0.5, 0.5);
      expect(layer.sampleValueAtWorld(point)).toBeCloseTo(0.25, 7);
      expect(layer.getSamplingMode()).toBe('linear');
      expect(layer.getVolumeTexture().getFilter()).toBe('linear');
      const palette = layer.getColormapTexture().image.data;
      for (let i = 0; i < palette.length; i += 4) {
        expect(palette[i]).toBe(palette[i + 1]);
        expect(palette[i]).toBe(palette[i + 2]);
      }
      applyLayerUpdate(surface, {
        ...spec, volumeData: new Float32Array([0, 2, 0, 2, 0, 2, 0, 2]).buffer,
        colormap: 'grey',
      });
      expect(layer.sampleValueAtWorld(point)).toBeCloseTo(0.5, 7);
      expect(layer.sampleValueAtWorld(new THREE.Vector3(0, 0, 0))).toBe(0);
      expect(layer.getVolumeTexture().getFilter()).toBe('linear');
      const updatedPalette = layer.getColormapTexture().image.data;
      expect(Array.from(updatedPalette)).toEqual(Array.from(palette));
    } finally {
      surface.dispose();
    }
  });
});
