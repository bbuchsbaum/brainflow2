import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { AtlasService } from '../AtlasService';
import type { AtlasConfig } from '@/types/atlas';

describe('AtlasService.loadSurfaceAtlas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes non-volume resolution before invoking backend', async () => {
    const invokeMock = vi.mocked(invoke);
    const mockResult = {
      atlas_metadata: {
        id: 'schaefer2018',
        name: 'Schaefer 2018',
        description: 'surface',
        n_regions: 200,
        space: 'fsaverage',
        resolution: 'surface',
      },
      labels_lh: [1, 2],
      labels_rh: [2, 1],
      label_info: [
        { id: 1, name: 'A', color: [255, 0, 0], hemisphere: 'Left', network: 'Vis' },
        { id: 2, name: 'B', color: [0, 255, 0], hemisphere: 'Right', network: 'SomMot' },
      ],
      space: 'fsaverage',
      n_vertices_lh: 2,
      n_vertices_rh: 2,
    };
    invokeMock.mockResolvedValue(mockResult as never);

    const config: AtlasConfig = {
      atlas_id: 'schaefer2018',
      space: 'fsaverage',
      resolution: 'surface',
      networks: 7,
      parcels: 200,
      data_type: 'surface',
      surf_type: 'pial',
    };

    const result = await AtlasService.loadSurfaceAtlas(config);

    expect(result).toEqual(mockResult);
    expect(invokeMock).toHaveBeenCalledWith('plugin:api-bridge|load_surface_atlas', {
      config: expect.objectContaining({
        resolution: '1mm',
      }),
    });
  });
});

describe('AtlasService surface parcellation helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('imports dense surface labels as a parcellation reference', async () => {
    const invokeMock = vi.mocked(invoke);
    const mockResult = {
      reference: {
        reference_id: 'parcel_ref_1',
        schema_version: '1.0.0',
        atlas_id: 'schaefer2018',
        parcel_row_count: 200,
        value_columns: [],
        created_at_unix_ms: 1,
      },
      vertex_count: 32492,
      unique_label_count: 201,
      nonzero_label_count: 200,
      max_label: 200,
      background_label: 0,
    };
    invokeMock.mockResolvedValue(mockResult as never);

    const result = await AtlasService.importSurfaceLabelParcellation({
      dataHandle: 'overlay_handle_1',
      sourceName: 'lh.Schaefer2018.label.gii',
      atlasIdHint: 'schaefer2018',
      atlasSpaceHint: 'fsaverage',
      hemisphereHint: 'left',
    });

    expect(result).toEqual(mockResult);
    expect(invokeMock).toHaveBeenCalledWith(
      'plugin:api-bridge|import_surface_label_parcellation',
      expect.objectContaining({
        data_handle: 'overlay_handle_1',
        source_name: 'lh.Schaefer2018.label.gii',
        atlas_id_hint: 'schaefer2018',
      })
    );
  });

  it('requests palette for imported parcellation reference', async () => {
    const invokeMock = vi.mocked(invoke);
    const mockPalette = {
      lut: {
        max_label: 200,
        lut_rgb: [0, 0, 0, 255, 0, 0],
        background: [0, 0, 0],
        kind: 'maximin_view',
        seed: 7,
      },
      legend: [
        { label_id: 1, roi: 'ROI_1', color: [255, 0, 0], hemisphere: 'Left', network: null },
      ],
    };
    invokeMock.mockResolvedValue(mockPalette as never);

    const result = await AtlasService.getParcellationReferencePalette('parcel_ref_1', {
      kind: 'network_harmony',
      seed: 7,
    });

    expect(result).toEqual(mockPalette);
    expect(invokeMock).toHaveBeenCalledWith(
      'plugin:api-bridge|get_parcellation_reference_palette',
      expect.objectContaining({
        reference_id: 'parcel_ref_1',
        kind: 'network_harmony',
        seed: 7,
      })
    );
  });

  it('strips surface-only fields when requesting atlas palette', async () => {
    const invokeMock = vi.mocked(invoke);
    const mockPalette = {
      lut: {
        max_label: 200,
        lut_rgb: [0, 0, 0, 255, 0, 0],
        background: [0, 0, 0],
        kind: 'rule_hcl',
        seed: 3,
      },
      legend: [],
    };
    invokeMock.mockResolvedValue(mockPalette as never);

    await AtlasService.getAtlasPalette(
      {
        atlas_id: 'schaefer2018',
        space: 'fsaverage',
        resolution: 'surface',
        networks: 7,
        parcels: 200,
        data_type: 'surface',
        surf_type: 'inflated',
      },
      { kind: 'rule_hcl', seed: 3 }
    );

    expect(invokeMock).toHaveBeenCalledWith('plugin:api-bridge|get_atlas_palette', {
      config: expect.objectContaining({
        atlas_id: 'schaefer2018',
        space: 'fsaverage',
        resolution: '1mm',
        networks: 7,
        parcels: 200,
        data_type: undefined,
        surf_type: undefined,
      }),
      kind: 'rule_hcl',
      seed: 3,
    });
  });
});
