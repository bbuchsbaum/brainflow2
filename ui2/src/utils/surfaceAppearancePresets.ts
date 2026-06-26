import {
  DEFAULT_SURFACE_MATERIAL_SETTINGS,
  type SurfaceLightingSettings,
  type SurfaceMaterialSettings,
} from '@/stores/surfaceStore';

/**
 * Named appearance presets shared by the surface Inspector's core "Lighting
 * preset" / "Material" dropdowns and the detailed SurfaceGeometryControls panel,
 * so the two never drift. Each preset is a partial settings patch; selecting it
 * merges its values into the active view's settings.
 */
export interface SurfaceAppearancePreset<T> {
  name: string;
  values: T;
}

type LightingPresetValues = Pick<
  SurfaceLightingSettings,
  'ambientLightIntensity' | 'directionalLightIntensity' | 'fillLightIntensity'
>;

export const LIGHTING_PRESETS: Array<SurfaceAppearancePreset<LightingPresetValues>> = [
  {
    name: 'Bright',
    values: { ambientLightIntensity: 1.2, directionalLightIntensity: 1.5, fillLightIntensity: 0.7 },
  },
  {
    name: 'Soft',
    values: { ambientLightIntensity: 1.0, directionalLightIntensity: 0.8, fillLightIntensity: 0.6 },
  },
  {
    name: 'Dramatic',
    values: { ambientLightIntensity: 0.4, directionalLightIntensity: 2.0, fillLightIntensity: 0.1 },
  },
  {
    name: 'Dark',
    values: { ambientLightIntensity: 0.3, directionalLightIntensity: 0.5, fillLightIntensity: 0.2 },
  },
  {
    name: 'Clinical',
    values: { ambientLightIntensity: 1.1, directionalLightIntensity: 1.0, fillLightIntensity: 0.8 },
  },
  {
    name: 'Default',
    values: { ambientLightIntensity: 0.4, directionalLightIntensity: 1.0, fillLightIntensity: 0.5 },
  },
];

export const MATERIAL_PRESETS: Array<SurfaceAppearancePreset<SurfaceMaterialSettings>> = [
  {
    name: 'Matte',
    values: {
      surfaceColor: '#CCCCCC',
      shininess: 4,
      specularColor: '#1a1a1a',
      emissiveColor: '#000000',
      emissiveIntensity: 0,
    },
  },
  {
    // Mirrors the store default so the out-of-the-box material always reports
    // as this preset (and stays in sync if the default ever changes).
    name: 'Gray glossy',
    values: { ...DEFAULT_SURFACE_MATERIAL_SETTINGS },
  },
  {
    name: 'White matte',
    values: {
      surfaceColor: '#E6E6E6',
      shininess: 6,
      specularColor: '#222222',
      emissiveColor: '#000000',
      emissiveIntensity: 0,
    },
  },
];

const approxEqual = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const sameColor = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Name of the preset whose values match the given settings, or null ("Custom")
 * when the live settings don't correspond to any preset. Lighting matching
 * ignores light position — presets only adjust intensities.
 */
export function matchLightingPreset(settings: SurfaceLightingSettings): string | null {
  const match = LIGHTING_PRESETS.find(
    (preset) =>
      approxEqual(preset.values.ambientLightIntensity, settings.ambientLightIntensity) &&
      approxEqual(preset.values.directionalLightIntensity, settings.directionalLightIntensity) &&
      approxEqual(preset.values.fillLightIntensity ?? 0, settings.fillLightIntensity ?? 0),
  );
  return match?.name ?? null;
}

export function matchMaterialPreset(settings: SurfaceMaterialSettings): string | null {
  const match = MATERIAL_PRESETS.find(
    (preset) =>
      sameColor(preset.values.surfaceColor, settings.surfaceColor) &&
      approxEqual(preset.values.shininess, settings.shininess) &&
      sameColor(preset.values.specularColor, settings.specularColor) &&
      sameColor(preset.values.emissiveColor, settings.emissiveColor) &&
      approxEqual(preset.values.emissiveIntensity, settings.emissiveIntensity),
  );
  return match?.name ?? null;
}
