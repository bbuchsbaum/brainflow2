import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SURFACE_LIGHTING_SETTINGS,
  DEFAULT_SURFACE_MATERIAL_SETTINGS,
} from '@/stores/surfaceStore';
import {
  LIGHTING_PRESETS,
  MATERIAL_PRESETS,
  matchLightingPreset,
  matchMaterialPreset,
} from '../surfaceAppearancePresets';

describe('surfaceAppearancePresets', () => {
  it('exposes the expected preset names', () => {
    expect(LIGHTING_PRESETS.map((p) => p.name)).toContain('Clinical');
    expect(MATERIAL_PRESETS.map((p) => p.name)).toEqual(['Matte', 'Gray glossy', 'White matte']);
  });

  it('matches the default lighting settings to the Default preset', () => {
    expect(matchLightingPreset(DEFAULT_SURFACE_LIGHTING_SETTINGS)).toBe('Default');
  });

  it('matches a named lighting preset by intensities, ignoring light position', () => {
    const clinical = LIGHTING_PRESETS.find((p) => p.name === 'Clinical')!;
    expect(
      matchLightingPreset({
        ...clinical.values,
        lightPosition: [3, 4, 5],
      }),
    ).toBe('Clinical');
  });

  it('returns null for lighting that matches no preset', () => {
    expect(
      matchLightingPreset({
        ambientLightIntensity: 0.123,
        directionalLightIntensity: 0.456,
        fillLightIntensity: 0.789,
        lightPosition: [0, 0, 1],
      }),
    ).toBeNull();
  });

  it('matches the default material to Gray glossy', () => {
    expect(matchMaterialPreset(DEFAULT_SURFACE_MATERIAL_SETTINGS)).toBe('Gray glossy');
  });

  it('matches material case-insensitively on colors', () => {
    const grayGlossy = MATERIAL_PRESETS.find((p) => p.name === 'Gray glossy')!;
    expect(
      matchMaterialPreset({
        ...grayGlossy.values,
        surfaceColor: grayGlossy.values.surfaceColor.toUpperCase(),
        specularColor: grayGlossy.values.specularColor.toUpperCase(),
      }),
    ).toBe('Gray glossy');
  });

  it('returns null for material that matches no preset', () => {
    expect(
      matchMaterialPreset({
        surfaceColor: '#123456',
        shininess: 99,
        specularColor: '#abcdef',
        emissiveColor: '#fedcba',
        emissiveIntensity: 0.5,
      }),
    ).toBeNull();
  });
});
