/**
 * Colormap utilities for mapping names to GPU colormap IDs
 */

// Map of colormap names to their GPU IDs
// Must match the BuiltinColormap enum in Rust
export const COLORMAP_IDS = {
  // Primary names
  grayscale: 0,
  viridis: 1,
  hot: 2,
  cool: 3,
  plasma: 4,
  inferno: 5,
  magma: 6,
  turbo: 7,
  petHotMetal: 8,
  fmriRedBlue: 9,
  jet: 10,
  parula: 11,
  hsv: 12,
  phase: 13,
  
  // Aliases
  grey: 0,
  gray: 0,
  pet: 8,
  fmri: 9,
  activation: 9,
} as const;

export type ColormapName = keyof typeof COLORMAP_IDS;
export type ColormapId = typeof COLORMAP_IDS[ColormapName];

/**
 * Get the numeric ID for a colormap name
 * @param name - The colormap name (case-insensitive)
 * @returns The numeric ID, or 0 (grayscale) if not found
 */
export function getColormapId(name: string): number {
  const normalized = name.toLowerCase().replace(/[-_\s]/g, '');
  
  // Check direct mapping
  if (normalized in COLORMAP_IDS) {
    return COLORMAP_IDS[normalized as ColormapName];
  }
  
  // Check common variations
  const variations: Record<string, number> = {
    'hotmetal': COLORMAP_IDS.petHotMetal,
    'redblue': COLORMAP_IDS.fmriRedBlue,
    'pethotmetal': COLORMAP_IDS.petHotMetal,
    'fmriredblue': COLORMAP_IDS.fmriRedBlue,
  };
  
  if (normalized in variations) {
    return variations[normalized];
  }
  
  // Default to grayscale
  console.warn(`Unknown colormap "${name}", using grayscale`);
  return COLORMAP_IDS.grayscale;
}

/**
 * Get the colormap name from an ID
 * @param id - The numeric colormap ID
 * @returns The colormap name
 */
export function getColormapName(id: number): string {
  const entry = Object.entries(COLORMAP_IDS).find(([_, value]) => value === id);
  return entry ? entry[0] : 'grayscale';
}

/**
 * List of available colormaps for UI selection
 */
export const COLORMAP_OPTIONS = [
  { label: 'Grayscale', value: 'grayscale', id: 0 },
  { label: 'Viridis', value: 'viridis', id: 1 },
  { label: 'Hot', value: 'hot', id: 2 },
  { label: 'Cool', value: 'cool', id: 3 },
  { label: 'Plasma', value: 'plasma', id: 4 },
  { label: 'Inferno', value: 'inferno', id: 5 },
  { label: 'Magma', value: 'magma', id: 6 },
  { label: 'Turbo', value: 'turbo', id: 7 },
  { label: 'PET Hot Metal', value: 'petHotMetal', id: 8 },
  { label: 'fMRI Red-Blue', value: 'fmriRedBlue', id: 9 },
  { label: 'Jet', value: 'jet', id: 10 },
  { label: 'Parula', value: 'parula', id: 11 },
  { label: 'HSV', value: 'hsv', id: 12 },
  { label: 'Phase', value: 'phase', id: 13 },
];

/**
 * Colormap categories for grouping in UI
 */
export const COLORMAP_CATEGORIES = {
  sequential: ['grayscale', 'viridis', 'plasma', 'inferno', 'magma', 'turbo', 'parula'],
  diverging: ['cool', 'fmriRedBlue'],
  qualitative: ['hsv', 'phase'],
  medical: ['hot', 'petHotMetal', 'jet'],
} as const;

/**
 * Get colormaps by category
 */
export function getColormapsByCategory(category: keyof typeof COLORMAP_CATEGORIES): typeof COLORMAP_OPTIONS {
  const names = COLORMAP_CATEGORIES[category];
  return COLORMAP_OPTIONS.filter(opt => names.includes(opt.value as any));
}