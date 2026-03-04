import { describe, expect, it } from 'vitest';
import {
  AtlasCategory,
  AtlasDataType,
  AtlasSource,
  type AtlasCatalogEntry,
  type AtlasConfig,
} from '@/types/atlas';
import type { AtlasPaletteResponse } from '@/types/atlasPalette';
import {
  buildLabelRgbaFromLabelInfo,
  buildLabelRgbaFromPalette,
  buildSurfacePaletteCandidates,
  fallbackColorForLabel,
  normalizePaletteResolution,
} from '../atlasSurfaceColorUtils';

describe('atlasSurfaceColorUtils', () => {
  it('uses deterministic fallback colors for positive labels missing label_info colors', () => {
    const labels = [0, 1, 2];
    const labelInfo = [{ id: 1, name: 'ROI 1', color: [10, 20, 30] as [number, number, number] }];

    const rgba = buildLabelRgbaFromLabelInfo(labels, labelInfo);

    expect(Array.from(rgba.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(rgba[4]).toBeCloseTo(10 / 255, 5);
    expect(rgba[5]).toBeCloseTo(20 / 255, 5);
    expect(rgba[6]).toBeCloseTo(30 / 255, 5);
    expect(rgba[7]).toBe(1);

    const fallback = fallbackColorForLabel(2);
    expect(rgba[8]).toBeCloseTo(fallback[0] / 255, 5);
    expect(rgba[9]).toBeCloseTo(fallback[1] / 255, 5);
    expect(rgba[10]).toBeCloseTo(fallback[2] / 255, 5);
    expect(rgba[11]).toBe(1);
  });

  it('maps labels through palette LUT and clamps labels above max_label', () => {
    const labels = [0, 1, 2, 3];
    const palette: AtlasPaletteResponse = {
      lut: {
        max_label: 2,
        lut_rgb: [
          0, 0, 0,       // label 0
          255, 0, 0,     // label 1
          0, 255, 0,     // label 2
        ],
        background: [0, 0, 0],
        kind: 'network_harmony',
        seed: 0,
      },
      legend: [],
    };

    const rgba = buildLabelRgbaFromPalette(labels, palette);

    expect(Array.from(rgba.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(Array.from(rgba.slice(4, 8))).toEqual([1, 0, 0, 1]);
    expect(Array.from(rgba.slice(8, 12))).toEqual([0, 1, 0, 1]);
    expect(Array.from(rgba.slice(12, 16))).toEqual([0, 1, 0, 1]);
  });

  it('accepts typed label arrays when mapping palette LUTs', () => {
    const labels = new Uint32Array([0, 1, 2]);
    const palette: AtlasPaletteResponse = {
      lut: {
        max_label: 2,
        lut_rgb: [0, 0, 0, 1, 2, 3, 4, 5, 6],
        background: [0, 0, 0],
        kind: 'maximin_view',
        seed: 0,
      },
      legend: [],
    };

    const rgba = buildLabelRgbaFromPalette(labels, palette);
    expect(Array.from(rgba.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(rgba[4]).toBeCloseTo(1 / 255, 6);
    expect(rgba[5]).toBeCloseTo(2 / 255, 6);
    expect(rgba[6]).toBeCloseTo(3 / 255, 6);
    expect(rgba[7]).toBe(1);
  });

  it('maps non-contiguous canonical surface labels via label_info colors', () => {
    const labels = [0, 1001, 2001, 1001];
    const labelInfo = [
      { id: 1001, name: 'LH_Region', color: [12, 34, 56] as [number, number, number] },
      { id: 2001, name: 'RH_Region', color: [210, 120, 30] as [number, number, number] },
    ];

    const rgba = buildLabelRgbaFromLabelInfo(labels, labelInfo);

    expect(Array.from(rgba.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(rgba[4]).toBeCloseTo(12 / 255, 5);
    expect(rgba[5]).toBeCloseTo(34 / 255, 5);
    expect(rgba[6]).toBeCloseTo(56 / 255, 5);
    expect(rgba[7]).toBe(1);
    expect(rgba[8]).toBeCloseTo(210 / 255, 5);
    expect(rgba[9]).toBeCloseTo(120 / 255, 5);
    expect(rgba[10]).toBeCloseTo(30 / 255, 5);
    expect(rgba[11]).toBe(1);
    expect(rgba[12]).toBeCloseTo(12 / 255, 5);
    expect(rgba[13]).toBeCloseTo(34 / 255, 5);
    expect(rgba[14]).toBeCloseTo(56 / 255, 5);
    expect(rgba[15]).toBe(1);
  });

  it('builds palette candidates with valid defaults and dedupes duplicates', () => {
    const config: AtlasConfig = {
      atlas_id: 'schaefer2018',
      space: 'fsaverage',
      resolution: '1mm',
      networks: 7,
      parcels: 400,
    };

    const atlasEntry: AtlasCatalogEntry = {
      id: 'schaefer2018',
      name: 'Schaefer 2018',
      description: 'test',
      source: AtlasSource.BuiltIn,
      category: AtlasCategory.Cortical,
      allowed_spaces: [
        { id: 'fsaverage', name: 'fsaverage', description: '', data_type: AtlasDataType.Both },
        { id: 'MNI152NLin2009cAsym', name: 'MNI', description: '', data_type: AtlasDataType.Volume },
      ],
      resolutions: [
        { value: '1mm', description: '' },
        { value: '2mm', description: '' },
      ],
      network_options: [7, 17],
      parcel_options: [100, 200, 400],
      is_favorite: false,
      is_cached: true,
    };

    const candidates = buildSurfacePaletteCandidates(config, 'surface', atlasEntry);
    const keys = candidates.map((c) => `${c.space}|${c.resolution}`);

    expect(keys[0]).toBe('fsaverage|1mm');
    expect(keys).toContain('fsaverage|2mm');
    expect(keys).toContain('MNI152NLin2009cAsym|1mm');
    expect(keys).toContain('MNI152NLin2009cAsym|2mm');
    expect(new Set(keys).size).toBe(keys.length);
    expect(candidates.every((c) => c.atlas_id === 'schaefer2018')).toBe(true);
    expect(candidates.every((c) => c.networks === 7 && c.parcels === 400)).toBe(true);
  });

  it('normalizes non-volume resolutions to 1mm', () => {
    expect(normalizePaletteResolution('surface')).toBe('1mm');
    expect(normalizePaletteResolution('')).toBe('1mm');
    expect(normalizePaletteResolution(undefined)).toBe('1mm');
    expect(normalizePaletteResolution('2mm')).toBe('2mm');
  });
});
