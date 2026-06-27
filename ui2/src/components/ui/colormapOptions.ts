export interface ColormapOption {
  name: string;
  label: string;
  gradient: string;
}

// Common neuroimaging colormaps - must match backend colormap names
export const colormaps: ColormapOption[] = [
  { name: 'gray', label: 'Grayscale', gradient: 'linear-gradient(to right, #000000, #ffffff)' },
  { name: 'viridis', label: 'Viridis', gradient: 'linear-gradient(to right, #440154, #31688e, #35b779, #fde725)' },
  { name: 'hot', label: 'Hot', gradient: 'linear-gradient(to right, #000000, #ff0000, #ffff00, #ffffff)' },
  { name: 'cool', label: 'Cool', gradient: 'linear-gradient(to right, #00ffff, #ff00ff)' },
  { name: 'plasma', label: 'Plasma', gradient: 'linear-gradient(to right, #0d0887, #7e03a8, #cc4778, #f89441, #f0f921)' },
  { name: 'inferno', label: 'Inferno', gradient: 'linear-gradient(to right, #000004, #721f81, #b73779, #fc9f07, #fcffa4)' },
  { name: 'magma', label: 'Magma', gradient: 'linear-gradient(to right, #000004, #711c81, #b63679, #fb8861, #fcfdbf)' },
  { name: 'turbo', label: 'Turbo', gradient: 'linear-gradient(to right, #30123b, #4454c4, #1fc9de, #72f91e, #fde725, #c42503)' },
  { name: 'pet', label: 'PET Hot Metal', gradient: 'linear-gradient(to right, #000000, #5a0000, #ff0000, #ffff00, #ffffff)' },
  { name: 'fmri', label: 'fMRI Red-Blue', gradient: 'linear-gradient(to right, #0000ff, #ffffff, #ff0000)' },
  { name: 'jet', label: 'Jet', gradient: 'linear-gradient(to right, #000080, #0000ff, #00ffff, #ffff00, #ff0000, #800000)' },
  { name: 'parula', label: 'Parula', gradient: 'linear-gradient(to right, #352a87, #0363e1, #1485d4, #06a7c6, #38b99e, #92bf73, #d9ba56, #fcce2e, #f9fb0e)' },
  { name: 'hsv', label: 'HSV', gradient: 'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)' },
  { name: 'phase', label: 'Phase', gradient: 'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)' },
];

// Map a colormap name to its backend BuiltinColormap discriminant.
// MUST stay in sync with core/colormap COLORMAP_NAMES / BuiltinColormap enum
// so that name-based and id-based render paths resolve to the same colormap.
const COLORMAP_NAME_TO_ID: Record<string, number> = {
  grayscale: 0,
  grey: 0,
  gray: 0,
  viridis: 1,
  hot: 2,
  cool: 3,
  plasma: 4,
  inferno: 5,
  magma: 6,
  turbo: 7,
  pet: 8,
  pet_hot_metal: 8,
  fmri: 9,
  activation: 9,
  jet: 10,
  parula: 11,
  hsv: 12,
  phase: 13,
};

/**
 * Resolve a colormap name to the backend numeric colormap id. Unknown names
 * fall back to Grayscale (0). Mirrors the Rust `colormap_by_name` resolver.
 */
export function colormapNameToId(name: string | null | undefined): number {
  if (!name) return 0;
  return COLORMAP_NAME_TO_ID[name.toLowerCase()] ?? 0;
}
