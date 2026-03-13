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
